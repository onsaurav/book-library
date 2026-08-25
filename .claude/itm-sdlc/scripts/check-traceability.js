#!/usr/bin/env node
'use strict';

/**
 * check-traceability.js — gate G3.
 *
 * Reports orphans in BOTH directions between requirements and the tests that
 * claim to cover them:
 *
 *   A  uncovered-requirement  a requirement being built or claimed verified that
 *                             no test annotates
 *   B  unknown-requirement    an annotation naming a requirement that does not exist
 *   C  stale-version          an annotation pinned to a version that is no longer current
 *   D  missing-version        an annotation with no @v at all (CONVENTIONS.md §5)
 *
 * This script contains no file extension, no annotation syntax and no build
 * command. All three come from the adapters detected in the target project, so
 * adding a language requires no change here.
 *
 * Usage:
 *   node scripts/check-traceability.js [options]
 *
 * Options:
 *   --project <path>       project to scan (default: cwd)
 *   --requirements <glob>  requirement files, repeatable
 *                          (default: .brain/requirements/*.yaml)
 *   --advisory             report everything, always exit 0   (default)
 *   --strict               exit 1 if any orphan is found
 *   --json                 machine-readable output
 *   -h, --help             this message
 *
 * Exit codes:
 *   0  clean, or advisory mode
 *   1  strict mode with at least one finding
 *   2  the tool itself could not run
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_PATTERNS,
  loadRequirementFiles,
  flatten,
  statusAtLeast,
} = require('./lib/requirements');

const {
  loadAdapters,
  detectAdapters,
  annotationRegex,
  testFiles,
  AdapterError,
} = require('./lib/adapters');

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_TOOL_ERROR = 2;

/**
 * A requirement at or beyond this status is being built, so something must
 * already be annotating it. Anything earlier is legitimately uncovered.
 */
const COVERAGE_REQUIRED_FROM = 'in_progress';

// --------------------------------------------------------------------------
// Argument parsing
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
      case '--strict':
        options.strict = true;
        break;
      case '--advisory':
        options.strict = false;
        break;
      case '--json':
        options.json = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--project':
        i += 1;
        if (argv[i] === undefined) throw new Error('--project requires a path');
        options.project = path.resolve(argv[i]);
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

// --------------------------------------------------------------------------
// Annotation scanning
// --------------------------------------------------------------------------

/** Byte offset -> 1-based line number, without re-scanning the file per match. */
function lineIndexer(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }

  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

/** Every @covers annotation in one file, per the adapter's own pattern. */
function scanFile(file, adapter) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }

  const lineOf = lineIndexer(text);
  const found = [];

  for (const match of text.matchAll(annotationRegex(adapter))) {
    found.push({
      id: match[1],
      version: match[2] ? Number.parseInt(match[2], 10) : null,
      file,
      line: lineOf(match.index),
      adapter: adapter.id,
    });
  }

  return found;
}

/** Every annotation across every test file of every detected adapter. */
function collectAnnotations(projectDir, adapters) {
  const annotations = [];
  const scanned = [];

  for (const adapter of adapters) {
    for (const file of testFiles(projectDir, adapter)) {
      scanned.push(file);
      annotations.push(...scanFile(file, adapter));
    }
  }

  return { annotations, scannedFiles: [...new Set(scanned)] };
}

// --------------------------------------------------------------------------
// Findings
// --------------------------------------------------------------------------

function finding(level, code, message, context = {}) {
  return { level, code, message, file: null, line: null, id: null, ...context };
}

const orphan = (code, message, context) => finding('orphan', code, message, context);
const warning = (code, message, context) => finding('warning', code, message, context);

/** A: a requirement being built that nothing annotates. */
function checkUncoveredRequirements(entries, annotationsById) {
  const findings = [];

  for (const { requirement, file } of entries) {
    if (!statusAtLeast(requirement.status, COVERAGE_REQUIRED_FROM)) continue;
    if (annotationsById.has(requirement.id)) continue;

    findings.push(
      orphan('uncovered-requirement', `status is '${requirement.status}' but no test annotates it. Either a test is missing, or the status is ahead of reality.`, {
        file,
        id: requirement.id,
      }),
    );
  }

  return findings;
}

/** B, C and D: annotations that do not line up with the requirement record. */
function checkAnnotations(annotations, requirementsById) {
  const findings = [];

  for (const annotation of annotations) {
    const requirement = requirementsById.get(annotation.id);

    if (!requirement) {
      findings.push(
        orphan('unknown-requirement', `annotates ${annotation.id}, which does not exist in any requirement file. The requirement was renamed, deleted, or never written.`, {
          file: annotation.file,
          line: annotation.line,
          id: annotation.id,
        }),
      );
      continue;
    }

    if (annotation.version === null) {
      findings.push(
        orphan('missing-version', `annotates ${annotation.id} with no @v. The version is mandatory (CONVENTIONS.md §5); write @covers ${annotation.id}@v${requirement.version}.`, {
          file: annotation.file,
          line: annotation.line,
          id: annotation.id,
        }),
      );
      continue;
    }

    if (annotation.version !== requirement.version) {
      findings.push(
        orphan('stale-version', `annotates ${annotation.id}@v${annotation.version} but the current version is v${requirement.version}. The test was written against text that has since changed and must be re-read before the pin is moved.`, {
          file: annotation.file,
          line: annotation.line,
          id: annotation.id,
        }),
      );
    }
  }

  return findings;
}

// --------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------

function check(options, adapterList = undefined) {
  const adapters = detectAdapters(options.project, adapterList ?? loadAdapters());
  const { documents } = loadRequirementFiles(options.requirements, options.project);

  const entries = flatten(documents).filter(
    ({ requirement }) => requirement && typeof requirement.id === 'string',
  );

  const requirementsById = new Map();
  for (const { requirement } of entries) {
    if (!requirementsById.has(requirement.id)) requirementsById.set(requirement.id, requirement);
  }

  const { annotations, scannedFiles } = collectAnnotations(options.project, adapters);

  const annotationsById = new Map();
  for (const annotation of annotations) {
    if (!annotationsById.has(annotation.id)) annotationsById.set(annotation.id, []);
    annotationsById.get(annotation.id).push(annotation);
  }

  const findings = [];

  if (adapters.length === 0) {
    findings.push(
      warning('no-adapters', `no language adapter matched ${options.project}. No test file was scanned, so this result proves nothing.`),
    );
  }

  if (entries.length === 0) {
    findings.push(
      warning('no-requirements', `no requirements found under ${options.requirements.join(', ')}. Nothing to trace.`),
    );
  }

  findings.push(...checkUncoveredRequirements(entries, annotationsById));
  findings.push(...checkAnnotations(annotations, requirementsById));

  const orphans = findings.filter((f) => f.level === 'orphan');

  const tracked = entries.filter(({ requirement }) =>
    statusAtLeast(requirement.status, COVERAGE_REQUIRED_FROM),
  );
  const covered = tracked.filter(({ requirement }) => annotationsById.has(requirement.id));

  return {
    ok: orphans.length === 0,
    mode: options.strict ? 'strict' : 'advisory',
    project: options.project,
    adapters: adapters.map((a) => a.id),
    scannedFileCount: scannedFiles.length,
    requirementCount: entries.length,
    annotationCount: annotations.length,
    coverage: {
      requiringCoverage: tracked.length,
      covered: covered.length,
    },
    findings,
    orphanCount: orphans.length,
    warningCount: findings.length - orphans.length,
  };
}

// --------------------------------------------------------------------------
// Reporting
// --------------------------------------------------------------------------

const CLASS_LABELS = {
  'uncovered-requirement': 'A  requirements with no test',
  'unknown-requirement': 'B  annotations naming a requirement that does not exist',
  'stale-version': 'C  annotations pinned to a superseded version',
  'missing-version': 'D  annotations with no @v version',
};

function relative(root, file) {
  if (!file) return '';
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : file;
}

function printHumanReport(result) {
  const lines = [];
  lines.push('');
  lines.push('itm-sdlc | traceability (gate G3)');
  lines.push('');
  lines.push(`  project    ${result.project}`);
  lines.push(`  adapters   ${result.adapters.join(', ') || '(none detected)'}`);
  lines.push(`  scanned    ${result.scannedFileCount} test file(s), ${result.annotationCount} annotation(s)`);
  lines.push(`  coverage   ${result.coverage.covered}/${result.coverage.requiringCoverage} requirement(s) at '${COVERAGE_REQUIRED_FROM}' or beyond are annotated`);
  lines.push('');

  for (const [code, label] of Object.entries(CLASS_LABELS)) {
    const group = result.findings.filter((f) => f.code === code);
    if (group.length === 0) continue;

    lines.push(`  ${label}  (${group.length})`);
    for (const item of group) {
      const where = item.line
        ? `${relative(result.project, item.file)}:${item.line}`
        : relative(result.project, item.file);
      lines.push(`      ${item.id}  ${where}`);
      lines.push(`          ${item.message}`);
    }
    lines.push('');
  }

  for (const item of result.findings.filter((f) => f.level === 'warning')) {
    lines.push(`  WARNING  [${item.code}]  ${item.message}`);
  }
  if (result.warningCount > 0) lines.push('');

  lines.push('  ' + '-'.repeat(66));
  lines.push(`  ${result.orphanCount} orphan(s), ${result.warningCount} warning(s)  |  mode: ${result.mode}`);

  if (result.orphanCount === 0) {
    lines.push('  PASS');
  } else if (result.mode === 'advisory') {
    lines.push('  ADVISORY - findings reported, build not failed.');
    lines.push('  This gate blocks nothing until its false-positive rate has been measured.');
  } else {
    lines.push('  FAIL');
  }
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');
}

const USAGE = `
Usage: node scripts/check-traceability.js [options]

  Gate G3. Reports requirements with no test, and tests naming requirements that
  do not exist or that have moved on to a later version.

Options:
  --project <path>       project to scan (default: current directory)
  --requirements <glob>  requirement files, repeatable
                         (default: ${DEFAULT_PATTERNS.join(', ')})
  --advisory             report everything, always exit 0 (default)
  --strict               exit 1 if any orphan is found
  --json                 machine-readable output
  -h, --help             show this message

Exit codes: 0 clean or advisory, 1 orphans in strict mode, 2 the tool could not run.
`;

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n${USAGE}`);
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
    const detail = err instanceof AdapterError ? err.message : err.message;
    process.stderr.write(`check-traceability: ${detail}\n`);
    return EXIT_TOOL_ERROR;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printHumanReport(result);
  }

  return options.strict && !result.ok ? EXIT_VIOLATION : EXIT_OK;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { check, parseArgs, scanFile, lineIndexer, main, COVERAGE_REQUIRED_FROM };
