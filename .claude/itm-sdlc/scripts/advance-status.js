#!/usr/bin/env node
'use strict';

/**
 * advance-status.js — move named requirements one step along the lifecycle.
 *
 * CONVENTIONS.md §6 makes the lifecycle forward-only and gated. Until now the
 * gates were enforced *after the fact* by validate-requirements.js, and the
 * transition itself was a hand edit to YAML that the walkthrough asked for and
 * pr-prepare's checklist then told the developer to take back out (PF-018).
 *
 * A hand edit cannot be gated, cannot be audited, and reformats whatever the
 * editor felt like reformatting. This applies the same rules the validator
 * enforces, before the edit rather than after, and writes back surgically — one
 * line changed per field, so the pull request shows the transition and nothing
 * else.
 *
 * Usage:
 *   node advance-status.js --to <status> REQ-BOOK-001 [REQ-BOOK-002 ...]
 *
 * Options:
 *   --to <status>        agreed | in_progress | verified   (required)
 *   --project <path>     project root (default: cwd)
 *   --requirements <glob>  repeatable; defaults to .brain/requirements/*.yaml
 *   --dry-run            report what would change and write nothing
 *   --json               machine-readable output
 *   -h, --help           this message
 *
 * Exit codes:
 *   0  every named requirement is now at the target status
 *   1  at least one was refused
 *   2  bad usage
 *
 * It will not move anything to `signed_off`. That is a client's act on a
 * delivered increment, not a state a script may assert.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_PATTERNS,
  STATUS_ORDER,
  loadRequirementFiles,
  flatten,
} = require('./lib/requirements');

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;

/** The only transitions this script performs. `signed_off` is deliberately absent. */
const ADVANCEABLE = ['agreed', 'in_progress', 'verified'];

const USAGE = `
Usage: node advance-status.js --to <status> REQ-ID [REQ-ID ...]

  Moves each named requirement exactly one step along the lifecycle in
  CONVENTIONS.md §6, applying the same gates validate-requirements.js enforces:

    draft        -> agreed        the ambiguity list must be empty
    agreed       -> in_progress   no further gate
    in_progress  -> verified      a test must annotate it at its CURRENT version;
                                  verified_by is rewritten to those files

Options:
  --to <status>          agreed | in_progress | verified   (required)
  --project <path>       project root (default: current directory)
  --requirements <glob>  repeatable (default: ${DEFAULT_PATTERNS.join(', ')})
  --dry-run              report and write nothing
  --json                 machine-readable output
  -h, --help             this message

  signed_off is never written by this script. It is a client's act on a
  delivered increment, not a state a tool may assert on their behalf.

Exit codes: 0 all moved (or already there), 1 something was refused, 2 bad usage.
`;

// ---------------------------------------------------------------------------
// Surgical YAML editing
//
// js-yaml round-tripping would reflow the whole file and drop every comment,
// turning a one-word status change into a diff nobody can review. These
// functions change the lines that must change and leave the rest byte-identical.
// ---------------------------------------------------------------------------

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * The line range of one requirement within a file, and the indent its fields sit at.
 *
 * @returns {{start: number, end: number, fieldIndent: number}|null}
 */
function locate(lines, id) {
  const opensAnItem = (line) => /^\s*-\s+\S/.test(line);
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idLine = new RegExp(`^\\s*-\\s+id:\\s*["']?${escaped}["']?\\s*(#.*)?$`);

  const start = lines.findIndex((line) => idLine.test(line));
  if (start === -1) return null;

  const markerIndent = indentOf(lines[start]);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (opensAnItem(lines[i]) && indentOf(lines[i]) <= markerIndent) {
      end = i;
      break;
    }
  }

  return { start, end, fieldIndent: markerIndent + 2 };
}

/** Index of `key:` within a requirement block, or -1. */
function findKey(lines, block, key) {
  const pattern = new RegExp(`^\\s{${block.fieldIndent}}${key}:`);
  for (let i = block.start; i < block.end; i += 1) {
    if (pattern.test(lines[i])) return i;
  }
  return -1;
}

/** Replace the scalar value of `key:` in place, preserving any trailing comment. */
function setScalar(lines, block, key, value) {
  const at = findKey(lines, block, key);
  if (at === -1) return false;

  const comment = /(\s+#.*)$/.exec(lines[at]);
  lines[at] = `${' '.repeat(block.fieldIndent)}${key}: ${value}${comment ? comment[1] : ''}`;
  return true;
}

/**
 * Replace `verified_by:` and its list with `files`, or insert it after `status:`.
 *
 * Both the block form and the inline `verified_by: []` form appear in real
 * files, and either may be followed by a comment that belongs to the NEXT key —
 * so only list items indented deeper than the key are consumed.
 */
function setVerifiedBy(lines, block, files, projectDir) {
  const pad = ' '.repeat(block.fieldIndent);
  const rendered = [
    `${pad}verified_by:`,
    ...files.map((f) => `${pad}  - ${toPosix(path.relative(projectDir, f))}`),
  ];

  const at = findKey(lines, block, 'verified_by');
  if (at === -1) {
    const statusAt = findKey(lines, block, 'status');
    const insertAt = statusAt === -1 ? block.start + 1 : statusAt + 1;
    lines.splice(insertAt, 0, ...rendered);
    return rendered.length;
  }

  let last = at;
  for (let i = at + 1; i < block.end; i += 1) {
    if (/^\s*-\s/.test(lines[i]) && indentOf(lines[i]) > block.fieldIndent) last = i;
    else break;
  }

  lines.splice(at, last - at + 1, ...rendered);
  return rendered.length - (last - at + 1);
}

const toPosix = (p) => p.split(path.sep).join('/');

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

/**
 * Tests annotating `id` at exactly `version`, using the project's own adapters.
 *
 * Loaded lazily: the adapter library needs glob and ajv, and a caller only
 * reaches this path when actually advancing something to `verified`.
 *
 * @returns {{files: string[], scanned: number, adapters: string[]}}
 */
function coveringTests(projectDir, id, version) {
  const { detectAdapters, testFiles } = require('./lib/adapters');
  const { scanFile } = require('./check-traceability');

  const adapters = detectAdapters(projectDir);
  const files = new Set();
  let scanned = 0;

  for (const adapter of adapters) {
    for (const file of testFiles(projectDir, adapter)) {
      scanned += 1;
      for (const found of scanFile(file, adapter)) {
        if (found.id === id && found.version === version) files.add(path.resolve(file));
      }
    }
  }

  return { files: [...files].sort(), scanned, adapters: adapters.map((a) => a.id) };
}

/**
 * Whether one requirement may move to `to`, and what else must change with it.
 *
 * @returns {{ok: boolean, reason?: string, note?: string, verifiedBy?: string[]}}
 */
function gate(requirement, to, projectDir) {
  const from = requirement.status;
  const fromIndex = STATUS_ORDER.indexOf(from);
  const toIndex = STATUS_ORDER.indexOf(to);

  if (fromIndex === -1) {
    return { ok: false, reason: `current status '${from}' is not one of: ${STATUS_ORDER.join(', ')}` };
  }
  if (from === to) {
    return { ok: true, note: `already at '${to}'` };
  }
  if (toIndex < fromIndex) {
    return { ok: false, reason: `already at '${from}'. The lifecycle is forward-only (CONVENTIONS.md §6); go back by incrementing version instead.` };
  }
  if (toIndex !== fromIndex + 1) {
    return { ok: false, reason: `at '${from}', so '${to}' would skip ${STATUS_ORDER.slice(fromIndex + 1, toIndex).join(', ')}. Transitions may not skip a step.` };
  }

  if (to === 'agreed') {
    const open = Array.isArray(requirement.ambiguities) ? requirement.ambiguities : [];
    if (open.length > 0) {
      const plural = open.length === 1 ? 'ambiguity is' : 'ambiguities are';
      return {
        ok: false,
        reason: `${open.length} ${plural} still open. An ambiguity is closed by the client answering it, never by a tool choosing a reading (CONVENTIONS.md §6). Run /resolve-ambiguities once they have.`,
      };
    }
  }

  if (to === 'verified') {
    const version = requirement.version;
    const { files, scanned, adapters } = coveringTests(projectDir, requirement.id, version);

    if (adapters.length === 0) {
      return { ok: false, reason: 'no language adapter matched this project, so no test file was scanned. Nothing can be verified against evidence that was never read.' };
    }
    if (files.length === 0) {
      return {
        ok: false,
        reason: `no test annotates it at its current version. Add @covers ${requirement.id}@v${version} to the test that proves it, then try again. (${scanned} test file(s) scanned via ${adapters.join(', ')}.)`,
      };
    }
    return { ok: true, verifiedBy: files };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/**
 * Advance every named requirement to `to`.
 *
 * @returns {{ok: boolean, to: string, moved: object[], refused: object[], unchanged: object[]}}
 */
function advance({ ids, to, project = process.cwd(), patterns = DEFAULT_PATTERNS, dryRun = false }) {
  const projectDir = path.resolve(project);

  if (!ADVANCEABLE.includes(to)) {
    throw new Error(
      to === 'signed_off'
        ? 'signed_off is not written by this script. It records a client accepting a delivered increment, and a tool asserting it on their behalf is exactly the claim the record exists to prevent.'
        : `--to must be one of: ${ADVANCEABLE.join(', ')}`,
    );
  }

  const { documents, missingPatterns } = loadRequirementFiles(patterns, projectDir);
  if (missingPatterns.length > 0) {
    throw new Error(`no requirement file matched ${missingPatterns.join(', ')} under ${projectDir}`);
  }

  const unreadable = documents.filter((d) => d.error);
  if (unreadable.length > 0) {
    throw new Error(`cannot read the requirement record: ${unreadable.map((d) => `${d.file}: ${d.error}`).join('; ')}`);
  }

  const all = flatten(documents);
  const moved = [];
  const refused = [];
  const unchanged = [];
  const edits = new Map(); // file -> [{id, to, verifiedBy}]

  for (const id of ids) {
    const entry = all.find((r) => r.requirement?.id === id);
    if (!entry) {
      refused.push({ id, reason: `not found in ${patterns.join(', ')}` });
      continue;
    }

    const verdict = gate(entry.requirement, to, projectDir);
    if (!verdict.ok) {
      refused.push({ id, from: entry.requirement.status, reason: verdict.reason });
      continue;
    }
    if (verdict.note) {
      unchanged.push({ id, status: to, note: verdict.note });
      continue;
    }

    if (!edits.has(entry.file)) edits.set(entry.file, []);
    edits.get(entry.file).push({ id, verifiedBy: verdict.verifiedBy });
    moved.push({
      id,
      from: entry.requirement.status,
      to,
      file: toPosix(path.relative(projectDir, entry.file)),
      verifiedBy: (verdict.verifiedBy ?? []).map((f) => toPosix(path.relative(projectDir, f))),
    });
  }

  if (!dryRun) {
    for (const [file, items] of edits) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');

      for (const item of items) {
        const block = locate(lines, item.id);
        if (!block) {
          throw new Error(`${item.id} parsed from ${file} but its block could not be located for editing. The file was not modified.`);
        }
        if (!setScalar(lines, block, 'status', to)) {
          throw new Error(`${item.id} has no status: line in ${file}. The file was not modified.`);
        }
        if (item.verifiedBy) {
          const refreshed = locate(lines, item.id);
          setVerifiedBy(lines, refreshed, item.verifiedBy, projectDir);
        }
      }

      fs.writeFileSync(file, lines.join('\n'), 'utf8');
    }
  }

  return { ok: refused.length === 0, to, moved, refused, unchanged, dryRun };
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { ids: [], to: null, project: process.cwd(), patterns: [], dryRun: false, json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--to':
        i += 1;
        if (argv[i] === undefined) throw new Error('--to requires a status');
        options.to = argv[i];
        break;
      case '--project':
        i += 1;
        if (argv[i] === undefined) throw new Error('--project requires a path');
        options.project = path.resolve(argv[i]);
        break;
      case '--requirements':
        i += 1;
        if (argv[i] === undefined) throw new Error('--requirements requires a glob');
        options.patterns.push(argv[i]);
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
        options.ids.push(arg);
    }
  }

  if (options.help) return options;
  if (!options.to) throw new Error('--to is required');
  if (options.ids.length === 0) throw new Error('name at least one requirement id');
  if (options.patterns.length === 0) options.patterns = DEFAULT_PATTERNS;
  return options;
}

function report(result) {
  const out = [''];
  out.push(`itm-sdlc | status${result.dryRun ? '  (DRY RUN - nothing was written)' : ''}`);
  out.push('');

  for (const item of result.moved) {
    out.push(`  ok    ${item.id}  ${item.from} -> ${item.to}`);
    for (const file of item.verifiedBy) out.push(`          verified_by  ${file}`);
  }
  for (const item of result.unchanged) out.push(`  --    ${item.id}  ${item.note}`);
  for (const item of result.refused) {
    out.push(`  FAIL  ${item.id}${item.from ? `  (${item.from})` : ''}`);
    out.push(`          ${item.reason}`);
  }

  out.push('');
  out.push('  ' + '-'.repeat(66));
  out.push(`  ${result.moved.length} moved, ${result.unchanged.length} already there, ${result.refused.length} refused`);
  out.push(result.ok ? `  ${result.dryRun ? 'DRY RUN - no changes made' : 'OK'}` : '  REFUSED - the record was not changed for those requirements.');
  out.push('');

  process.stdout.write(out.join('\n') + '\n');
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`advance-status: ${err.message}\n${USAGE}`);
    return EXIT_USAGE;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  let result;
  try {
    result = advance(options);
  } catch (err) {
    process.stderr.write(`advance-status: ${err.message}\n`);
    return EXIT_USAGE;
  }

  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else report(result);

  return result.ok ? EXIT_OK : EXIT_REFUSED;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { advance, gate, locate, parseArgs, main, ADVANCEABLE };
