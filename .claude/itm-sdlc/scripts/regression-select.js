#!/usr/bin/env node
'use strict';

/**
 * regression-select.js — what should be re-run for this change?
 *
 * PDF §06: derived regression scope is what keeps pipeline duration flat as
 * the suite grows.
 *
 * G2 and G4 now use this, under four conditions that must ALL hold — any one
 * failing means the full suite runs, which is the safe answer and the default:
 *
 *   1. the pull request declares REQ- or CHG- ids (the same scan G0 does)
 *   2. this selector runs without error
 *   3. it returns a non-empty file list
 *   4. the adapter declares `commands.testFiles` — a way to run named files
 *      that is honest for that stack. `dotnet test` selects by test name, not
 *      by path, so the csharp adapter omits it and gets the full suite.
 *
 * The failure mode being avoided is a scoped run that silently misses tests
 * and reports green. A slow suite is a cost; a fast one that checked less than
 * it claimed is a lie. Every job says which path it took and why.
 *
 * Input is a CHG- id, or one or more REQ- ids:
 *
 *   node scripts/regression-select.js CHG-0012
 *   node scripts/regression-select.js REQ-SAMPLE-001 REQ-SAMPLE-004
 *
 * A CHG- id resolves to the requirement ids named in its `affects:` field
 * (YAML) or `**Affects:**` line (Markdown) — both shapes exist across this
 * toolkit's own documentation, so both are read.
 *
 * From the starting ids, this walks `depends_on` in the REVERSE direction:
 * not what the changed requirement depends on, but every requirement that
 * depends on it, transitively. Those are the ones whose own behaviour may
 * have relied on something that just changed. It then collects every test
 * file carrying an `@covers` annotation for any id in that expanded set.
 *
 * Usage:
 *   node scripts/regression-select.js <CHG-NNNN | REQ-... [REQ-... ...]> [options]
 *
 * Options:
 *   --project <path>          project to scan (default: cwd)
 *   --requirements-glob <g>   requirement files, repeatable
 *                             (default: .brain/requirements/*.yaml)
 *   --changes-glob <g>        change record files, repeatable
 *                             (default: .brain/changes/*.yaml, *.yml, *.md)
 *   --json                    machine-readable output
 *   --files                   the selected test paths, one per line, and nothing
 *                             else. What CI reads to build a scoped run
 *   -h, --help                this message
 *
 * Exit codes:
 *   0  selected (an empty result is still a valid, reported outcome)
 *   2  the tool could not run (bad input, unknown id, no change record found)
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const { DEFAULT_PATTERNS, loadRequirementFiles, flatten, resolveFiles } = require('./lib/requirements');
const { loadAdapters, detectAdapters, testFiles } = require('./lib/adapters');
const { scanFile } = require('./check-traceability');
const { extractRequirementIds } = require('./review-change');

const EXIT_OK = 0;
const EXIT_TOOL_ERROR = 2;

const CHG_ID = /^CHG-\d{4}$/;
const REQ_ID = /^REQ-[A-Z]{3,8}-\d{3}$/;
const DEFAULT_CHANGES_GLOBS = ['.brain/changes/*.yaml', '.brain/changes/*.yml', '.brain/changes/*.md'];
const YAML_OPTIONS = { schema: yaml.CORE_SCHEMA };

class RegressionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegressionError';
  }
}

// --------------------------------------------------------------------------
// Resolving a CHG- id to the requirement ids it affects
// --------------------------------------------------------------------------

function findChangeFile(projectDir, chgId, changesGlobs) {
  const files = resolveFiles(changesGlobs, projectDir);
  return files.find((f) => path.basename(f).startsWith(chgId)) ?? null;
}

/**
 * Every REQ id a change record names as affected.
 *
 * Two shapes are read because both exist in this toolkit's own documentation:
 * templates/brain-scaffold/changes/README.md shows Markdown with an
 * `**Affects:**` line; skills/change-record/SKILL.md shows YAML with an
 * `affects:` array. A `.yaml`/`.yml` file is parsed as YAML first; anything
 * else — including a YAML file whose shape does not match — falls back to
 * scanning for an "affects" line, and failing that, the whole file.
 */
function extractAffectedIds(content, filePath) {
  if (/\.ya?ml$/i.test(filePath)) {
    try {
      const parsed = yaml.load(content, YAML_OPTIONS);
      if (parsed && Array.isArray(parsed.affects)) {
        const ids = parsed.affects.filter((x) => typeof x === 'string').flatMap((x) => extractRequirementIds(x));
        return [...new Set(ids)].sort();
      }
    } catch {
      // Not the expected shape — fall through to the text scan below.
    }
  }

  const affectsLine = /^\s*[-*]?\s*\*{0,2}affects\*{0,2}\s*:\s*(.+)$/im.exec(content);
  return extractRequirementIds(affectsLine ? affectsLine[1] : content);
}

// --------------------------------------------------------------------------
// Walking depends_on in reverse: what depends on the changed requirement(s)
// --------------------------------------------------------------------------

/**
 * The starting ids, plus every requirement that transitively depends on one
 * of them. NOT what the starting requirements themselves depend on — a
 * requirement's own dependencies have not changed just because it did.
 */
function expandDependents(startIds, entries) {
  const dependentsOf = new Map();
  for (const { requirement } of entries) {
    for (const dep of requirement.depends_on ?? []) {
      if (!dependentsOf.has(dep)) dependentsOf.set(dep, new Set());
      dependentsOf.get(dep).add(requirement.id);
    }
  }

  const impacted = new Set(startIds);
  const queue = [...startIds];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependent of dependentsOf.get(current) ?? []) {
      if (impacted.has(dependent)) continue;
      impacted.add(dependent);
      queue.push(dependent);
    }
  }

  return impacted;
}

// --------------------------------------------------------------------------
// Walking @covers: which test files name an impacted requirement
// --------------------------------------------------------------------------

function collectAnnotations(projectDir, adapters) {
  const annotations = [];
  for (const adapter of adapters) {
    for (const file of testFiles(projectDir, adapter)) {
      annotations.push(...scanFile(file, adapter));
    }
  }
  return annotations;
}

function relativeTo(root, file) {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : file;
}

// --------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------

function selectRegression(options, deps = {}) {
  const projectDir = path.resolve(options.project);

  const { documents } = loadRequirementFiles(options.requirementsGlob, projectDir);
  const entries = flatten(documents).filter(({ requirement }) => requirement && typeof requirement.id === 'string');

  const requirementIds = new Set(entries.map(({ requirement }) => requirement.id));

  let startIds;
  let source;

  if (options.chgId) {
    const file = findChangeFile(projectDir, options.chgId, options.changesGlob);
    if (!file) {
      throw new RegressionError(
        `no change record found for ${options.chgId} under ${options.changesGlob.join(', ')}`,
      );
    }

    startIds = extractAffectedIds(fs.readFileSync(file, 'utf8'), file);
    if (startIds.length === 0) {
      throw new RegressionError(`${relativeTo(projectDir, file)} names no REQ- id in its affects field`);
    }

    source = { type: 'chg', id: options.chgId, file: relativeTo(projectDir, file) };
  } else {
    startIds = options.reqIds;
    source = { type: 'requirements' };
  }

  const missing = startIds.filter((id) => !requirementIds.has(id));
  if (missing.length > 0) {
    throw new RegressionError(
      `unknown requirement id(s): ${missing.join(', ')}. Either the id is wrong, or the requirement was never written.`,
    );
  }

  const impactedIds = expandDependents(startIds, entries);

  const adapters = detectAdapters(projectDir, deps.adapters ?? loadAdapters());
  const annotations = (deps.collectAnnotations ?? collectAnnotations)(projectDir, adapters);
  const tests = [...new Set(
    annotations.filter((a) => impactedIds.has(a.id)).map((a) => relativeTo(projectDir, a.file)),
  )].sort();

  return {
    project: projectDir,
    source,
    startIds: [...startIds].sort(),
    impactedIds: [...impactedIds].sort(),
    addedByDependency: [...impactedIds].filter((id) => !startIds.includes(id)).sort(),
    tests,
    adapters: adapters.map((a) => ({
      id: a.id,
      name: a.displayName,
      testCommand: a.commands.test,
      // Present only when the stack can honestly run a named subset. Absent is
      // a supported answer: G2 and G4 fall back to the full suite rather than
      // approximating one, because a scoped run that silently misses tests is
      // worse than a slow one.
      testFilesCommand: a.commands.testFiles ?? null,
      integrationFilesCommand: a.commands.integrationFiles ?? null,
    })),
    scopable: adapters.some((a) => a.commands.testFiles),
  };
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    requirementsGlob: [],
    changesGlob: [],
    chgId: null,
    reqIds: [],
    json: false,
    files: false,
    help: false,
  };

  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} requires a value`);
      return argv[i];
    };

    switch (arg) {
      case '--project': options.project = value(); break;
      case '--requirements-glob': options.requirementsGlob.push(value()); break;
      case '--changes-glob': options.changesGlob.push(value()); break;
      case '--json': options.json = true; break;
      case '--files': options.files = true; break;
      case '-h': case '--help': options.help = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
        positionals.push(arg);
    }
  }

  if (options.requirementsGlob.length === 0) options.requirementsGlob = [...DEFAULT_PATTERNS];
  if (options.changesGlob.length === 0) options.changesGlob = [...DEFAULT_CHANGES_GLOBS];

  if (options.help) return options;

  if (positionals.length === 0) {
    throw new Error('give a CHG- id, or one or more REQ- ids');
  }

  const chgIds = positionals.filter((p) => CHG_ID.test(p));
  const reqIds = positionals.filter((p) => REQ_ID.test(p));
  const unrecognised = positionals.filter((p) => !CHG_ID.test(p) && !REQ_ID.test(p));

  if (unrecognised.length > 0) {
    throw new Error(`not a CHG- or REQ- id: ${unrecognised.join(', ')}`);
  }
  if (chgIds.length > 0 && reqIds.length > 0) {
    throw new Error('cannot mix a CHG- id with REQ- ids — give one CHG- id, or one or more REQ- ids');
  }
  if (chgIds.length > 1) {
    throw new Error(`only one CHG- id at a time: ${chgIds.join(', ')}`);
  }

  if (chgIds.length === 1) options.chgId = chgIds[0];
  else options.reqIds = [...new Set(reqIds)].sort();

  return options;
}

const USAGE = `
Usage: node scripts/regression-select.js <CHG-NNNN | REQ-... [REQ-... ...]> [options]

  Derives the test files worth re-running for a change: walks depends_on in
  reverse from the given requirement(s) to find everything that may have
  relied on what changed, then collects every @covers annotation naming one
  of them.

  Reports only. G2 and G4 still run the adapter's full test command — nothing
  here changes that.

Options:
  --project <path>         project to scan (default: current directory)
  --requirements-glob <g>  requirement files, repeatable
                           (default: ${DEFAULT_PATTERNS.join(', ')})
  --changes-glob <g>       change record files, repeatable
                           (default: ${DEFAULT_CHANGES_GLOBS.join(', ')})
  --json                   machine-readable output
  --files                  selected test paths, one per line (what CI reads)
  -h, --help               show this message

Exit codes: 0 selected (an empty result is still valid), 2 the tool could not run.
`;

function report(result) {
  const out = ['', 'itm-sdlc | regression select', ''];
  out.push(`  project    ${result.project}`);

  if (result.source.type === 'chg') {
    out.push(`  input      ${result.source.id}  (${result.source.file})`);
  } else {
    out.push(`  input      ${result.startIds.join(', ')}`);
  }
  out.push('');

  out.push(`  IMPACTED REQUIREMENTS  (${result.impactedIds.length}, ${result.addedByDependency.length} added via depends_on)`);
  for (const id of result.impactedIds) {
    out.push(`      ${id}${result.addedByDependency.includes(id) ? '  (via depends_on)' : ''}`);
  }
  out.push('');

  out.push(`  DERIVED TEST LIST  (${result.tests.length} file(s))`);
  if (result.tests.length === 0) {
    out.push('      none — no @covers annotation names any impacted requirement yet');
  } else {
    for (const file of result.tests) out.push(`      ${file}`);
  }
  out.push('');

  out.push('  ADAPTER TEST COMMAND(S)  (informational — not wired into G2/G4; runs the whole suite today)');
  if (result.adapters.length === 0) {
    out.push('      none detected');
  } else {
    for (const adapter of result.adapters) out.push(`      ${adapter.name}: ${adapter.testCommand}`);
  }
  out.push('');

  out.push('  ' + '-'.repeat(66));
  out.push(`  ${result.tests.length} test file(s) selected from ${result.impactedIds.length} impacted requirement(s)`);
  out.push('');

  process.stdout.write(out.join('\n') + '\n');
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`regression-select: ${err.message}\n${USAGE}`);
    return EXIT_TOOL_ERROR;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  let result;
  try {
    result = selectRegression(options);
  } catch (err) {
    process.stderr.write(`regression-select: ${err.message}\n`);
    return EXIT_TOOL_ERROR;
  }

  // --files is the shell-consumable form: one path per line and nothing else,
  // so a CI job can read it without a JSON parser. Empty output is a valid
  // answer meaning "nothing was derived" — the caller runs the full suite.
  if (options.files) process.stdout.write(result.tests.join('\n') + (result.tests.length ? '\n' : ''));
  else if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else report(result);

  return EXIT_OK;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  selectRegression,
  expandDependents,
  extractAffectedIds,
  findChangeFile,
  collectAnnotations,
  parseArgs,
  main,
  RegressionError,
  DEFAULT_CHANGES_GLOBS,
};
