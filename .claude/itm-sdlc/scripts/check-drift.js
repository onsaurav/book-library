#!/usr/bin/env node
'use strict';

/**
 * check-drift.js — has the implementation quietly diverged from the record?
 *
 * PDF §07: uncaptured verbal scope is how the model degrades in month three.
 * Nobody notices in the moment; it shows up as a record nobody trusts.
 *
 * Reports three things:
 *
 *   A  stale @covers        an annotation pinned to a version that is no
 *                           longer current. SOURCED FROM check-traceability.js
 *                           (class C) — not recomputed here. Two independent
 *                           implementations of the same fact could disagree,
 *                           so this module cites G3's own verdict rather than
 *                           re-deriving it.
 *   B  uncaptured change    a requirement's version incremented with no
 *                           CHG-NNNN mentioned anywhere in its history.
 *                           REUSED from metrics.js's own computation, for the
 *                           same reason.
 *   C  missing annotation   an 'agreed'-or-later requirement with no @covers
 *                           annotation anywhere in the codebase, EXCLUDING any
 *                           id check-traceability's own 'uncovered-requirement'
 *                           finding already reports (its floor is
 *                           'in_progress'; this only ever adds the 'agreed'
 *                           requirements that floor does not reach)
 *
 * Advisory only. This never fails a build on its own — wire it as an advisory
 * job, same as the secret scan.
 *
 * Usage:
 *   node scripts/check-drift.js [options]
 *
 * Options:
 *   --project <path>       project to check (default: cwd)
 *   --requirements <glob>  requirement files, repeatable
 *                          (default: .brain/requirements/*.yaml)
 *   --advisory             report everything, always exit 0   (default)
 *   --strict               exit 1 if any drift is found
 *   --json                 machine-readable output
 *   -h, --help             this message
 *
 * Exit codes:
 *   0  clean, or advisory mode
 *   1  strict mode with at least one finding
 *   2  the tool itself could not run
 */

const path = require('node:path');

const { DEFAULT_PATTERNS, loadRequirementFiles, flatten, statusAtLeast } = require('./lib/requirements');
const { loadAdapters, detectAdapters } = require('./lib/adapters');
const traceability = require('./check-traceability');
const { computeUncapturedChange, collectAnnotations } = require('./metrics');

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_TOOL_ERROR = 2;

/** The floor check-traceability's own coverage check does NOT reach — see class C's note above. */
const MISSING_ANNOTATION_FLOOR = 'agreed';

// --------------------------------------------------------------------------
// The three classes
// --------------------------------------------------------------------------

/** A — cited from check-traceability's own class C, not recomputed. */
function staleCoversFrom(traceabilityResult) {
  return traceabilityResult.findings
    .filter((f) => f.code === 'stale-version')
    .map((f) => ({ id: f.id, file: f.file, line: f.line, message: f.message, source: 'G3 (check-traceability)' }));
}

/** C — an id already reported by check-traceability's class A is excluded, not duplicated. */
function missingAnnotations(entries, annotationsById, traceabilityResult) {
  const alreadyFlagged = new Set(
    traceabilityResult.findings.filter((f) => f.code === 'uncovered-requirement').map((f) => f.id),
  );

  return entries
    .filter(({ requirement }) => statusAtLeast(requirement.status, MISSING_ANNOTATION_FLOOR))
    .filter(({ requirement }) => !alreadyFlagged.has(requirement.id))
    .filter(({ requirement }) => !annotationsById.has(requirement.id))
    .map(({ requirement, file }) => ({ id: requirement.id, status: requirement.status, file }));
}

// --------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------

function check(options, deps = {}) {
  const projectDir = path.resolve(options.project);

  const { documents } = loadRequirementFiles(options.requirements, projectDir);
  const entries = flatten(documents).filter(({ requirement }) => requirement && typeof requirement.id === 'string');

  const traceabilityCheck = deps.traceabilityCheck ?? traceability.check;
  const traceabilityResult = traceabilityCheck({
    project: projectDir,
    requirements: options.requirements,
    strict: false,
    json: false,
  });

  const adapters = detectAdapters(projectDir, deps.adapters ?? loadAdapters());
  const annotations = (deps.collectAnnotations ?? collectAnnotations)(projectDir, adapters);
  const annotationsById = new Set(annotations.map((a) => a.id));

  const staleVersions = staleCoversFrom(traceabilityResult);
  const uncapturedChange = (deps.computeUncapturedChange ?? computeUncapturedChange)(entries);
  const missing = missingAnnotations(entries, annotationsById, traceabilityResult);

  const total = staleVersions.length + uncapturedChange.uncaptured + missing.length;

  return {
    ok: total === 0,
    mode: options.strict ? 'strict' : 'advisory',
    project: projectDir,
    total,
    staleVersions,
    uncapturedChange,
    missingAnnotations: missing,
  };
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    requirements: [],
    strict: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--strict': options.strict = true; break;
      case '--advisory': options.strict = false; break;
      case '--json': options.json = true; break;
      case '-h': case '--help': options.help = true; break;
      case '--project':
        i += 1;
        if (argv[i] === undefined) throw new Error('--project requires a path');
        options.project = argv[i];
        break;
      case '--requirements':
        i += 1;
        if (argv[i] === undefined) throw new Error('--requirements requires a glob');
        options.requirements.push(argv[i]);
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  if (options.requirements.length === 0) options.requirements = [...DEFAULT_PATTERNS];
  return options;
}

const USAGE = `
Usage: node scripts/check-drift.js [options]

  Reports drift between the requirement record and the codebase: stale
  @covers versions (cited from check-traceability, not recomputed), version
  bumps with no CHG-NNNN in history, and 'agreed'-or-later requirements with
  no implementation annotation that check-traceability's own floor does not
  already flag.

Options:
  --project <path>       project to check (default: current directory)
  --requirements <glob>  requirement files, repeatable
                         (default: ${DEFAULT_PATTERNS.join(', ')})
  --advisory             report everything, always exit 0 (default)
  --strict               exit 1 if any drift is found
  --json                 machine-readable output
  -h, --help             show this message

Exit codes: 0 clean or advisory, 1 drift found in strict mode, 2 the tool could not run.
`;

function relative(root, file) {
  if (!file) return '';
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : file;
}

function report(result) {
  const rel = (f) => relative(result.project, f);
  const out = ['', 'itm-sdlc | change drift', ''];
  out.push(`  project    ${result.project}`);
  out.push('');

  out.push(`  A  stale @covers versions — cited from check-traceability (G3), not recomputed  (${result.staleVersions.length})`);
  for (const item of result.staleVersions) {
    out.push(`      ${item.id}  ${rel(item.file)}${item.line ? `:${item.line}` : ''}`);
    out.push(`          ${item.message}`);
  }
  out.push('');

  const uc = result.uncapturedChange;
  out.push(`  B  uncaptured change — version bumped, no CHG- in history  (${uc.uncaptured})`);
  for (const item of uc.items) out.push(`      ${item.id}@v${item.version}  ${rel(item.file)}`);
  out.push('');

  out.push(`  C  missing annotation — agreed-or-later, not already flagged by G3  (${result.missingAnnotations.length})`);
  for (const item of result.missingAnnotations) out.push(`      ${item.id} (${item.status})  ${rel(item.file)}`);
  out.push('');

  out.push('  ' + '-'.repeat(66));
  out.push(`  ${result.total} finding(s)  |  mode: ${result.mode}`);

  if (result.total === 0) {
    out.push('  PASS');
  } else if (result.mode === 'advisory') {
    out.push('  ADVISORY - reported, build not failed.');
  } else {
    out.push('  FAIL');
  }
  out.push('');

  process.stdout.write(out.join('\n') + '\n');
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`check-drift: ${err.message}\n${USAGE}`);
    return EXIT_TOOL_ERROR;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  let result;
  try {
    result = check(options);
  } catch (err) {
    process.stderr.write(`check-drift: ${err.message}\n`);
    return EXIT_TOOL_ERROR;
  }

  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else report(result);

  return options.strict && !result.ok ? EXIT_VIOLATION : EXIT_OK;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  check,
  staleCoversFrom,
  missingAnnotations,
  parseArgs,
  main,
  MISSING_ANNOTATION_FLOOR,
};
