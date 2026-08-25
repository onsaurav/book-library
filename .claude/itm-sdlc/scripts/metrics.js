#!/usr/bin/env node
'use strict';

/**
 * metrics.js — governance metrics, computed from the repository alone (PDF §10).
 *
 * Everything here is read from files already in the project: requirement YAML,
 * test annotations, the golden set, and — if the documented log exists — a gate
 * decision history. There is no product database, no external service, and
 * nothing here writes anything.
 *
 * Five numbers, and the honest answer where a number cannot be produced:
 *
 *   requirement coverage      agreed-or-later requirements with verified_by or
 *                             a matching @covers annotation
 *   uncaptured change         requirements whose version incremented with no
 *                             CHG-NNNN mentioned anywhere in their history
 *   open ambiguities          requirements past draft that still carry an open
 *                             ambiguity — must be zero; CONVENTIONS.md §6 blocks
 *                             draft -> agreed on this, so a non-zero count here
 *                             means a requirement reached 'agreed' some other way
 *   golden set                reused from run-golden-set.js, including its
 *                             refusal to print a headline rate when fewer than
 *                             half the cases were judged (PF-014)
 *   gate false-positive rate  read from --gate-log if that file exists and has
 *                             usable records; otherwise "unmeasured" — this
 *                             script never prints a rate it cannot back up
 *
 * The golden set ships only with the toolkit repository itself — an installed
 * project's vendored .claude/itm-sdlc/ does not carry tests/, so metrics run
 * inside a client project reports the golden set as unavailable rather than
 * failing. That is expected, not an error.
 *
 * The gate findings log (--gate-log) is a documented, optional path. Nothing in
 * this toolkit writes it yet — it is somewhere for a project to record, per
 * finding, whether a human judged an advisory-gate finding a true or false
 * positive, once it has a place to do that. Its format:
 *
 *   [
 *     { "gate": "G7", "outcome": "true-positive" },
 *     { "gate": "G7", "outcome": "false-positive" },
 *     { "gate": "G5", "outcome": "true-positive" }
 *   ]
 *
 * Usage:
 *   node scripts/metrics.js [options]
 *
 * Options:
 *   --project <path>        project to measure (default: cwd)
 *   --requirements <glob>   requirement files, repeatable
 *                           (default: .brain/requirements/*.yaml)
 *   --golden-set <dir>      case directory (default: the toolkit's own
 *                           tests/golden-set, if this is a checkout of it)
 *   --skip-golden-set       do not run the golden set (faster; still reported)
 *   --invoker <command>     reviewer command for golden-set G7 cases, or
 *                           $ITM_SDLC_REVIEWER_CMD
 *   --gate-log <file>       gate findings log (default:
 *                           .brain/metrics/gate-findings-log.json, relative to
 *                           --project unless absolute)
 *   --strict                exit 1 if any requirement past draft carries an
 *                           open ambiguity
 *   --json                  machine-readable output
 *   -h, --help              this message
 *
 * Exit codes:
 *   0  reported (the default: advisory, always 0)
 *   1  --strict and an open ambiguity was found on a non-draft requirement
 *   2  the tool itself could not run
 */

const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_PATTERNS, loadRequirementFiles, flatten, statusAtLeast } = require('./lib/requirements');
const { loadAdapters, detectAdapters, testFiles } = require('./lib/adapters');
const { scanFile } = require('./check-traceability');
const goldenSetLib = require('./run-golden-set');

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_TOOL_ERROR = 2;

/** Requirement coverage counts from 'agreed', not 'in_progress' (check-traceability's floor) — this is the client-facing question, "did we agree to build this and can we prove it." */
const COVERAGE_FLOOR = 'agreed';

const DEFAULT_GOLDEN_SET = path.join(__dirname, '..', 'tests', 'golden-set');
const DEFAULT_GATE_LOG = path.join('.brain', 'metrics', 'gate-findings-log.json');
const CHG_PATTERN = /\bCHG-\d{4}\b/;
const VALID_OUTCOMES = new Set(['true-positive', 'false-positive']);

// --------------------------------------------------------------------------
// Requirement coverage
// --------------------------------------------------------------------------

/** Every @covers annotation across every detected adapter's test files. */
function collectAnnotations(projectDir, adapters) {
  const annotations = [];
  for (const adapter of adapters) {
    for (const file of testFiles(projectDir, adapter)) {
      annotations.push(...scanFile(file, adapter));
    }
  }
  return annotations;
}

function computeRequirementCoverage(entries, annotationsById) {
  const requiring = entries.filter(({ requirement }) => statusAtLeast(requirement.status, COVERAGE_FLOOR));
  const uncovered = [];
  let covered = 0;

  for (const { requirement, file } of requiring) {
    const hasVerifiedBy = Array.isArray(requirement.verified_by) && requirement.verified_by.length > 0;
    const hasAnnotation = annotationsById.has(requirement.id);

    if (hasVerifiedBy || hasAnnotation) {
      covered += 1;
    } else {
      uncovered.push({ id: requirement.id, status: requirement.status, file });
    }
  }

  return {
    requiringCoverage: requiring.length,
    covered,
    uncovered,
    rate: requiring.length === 0 ? null : covered / requiring.length,
  };
}

// --------------------------------------------------------------------------
// Uncaptured change
// --------------------------------------------------------------------------

/** Whether ANY history entry, in any field, mentions a change record. */
function historyMentionsChange(history) {
  return (history ?? []).some((entry) => CHG_PATTERN.test(JSON.stringify(entry ?? {})));
}

function computeUncapturedChange(entries) {
  const changed = entries.filter(({ requirement }) => Number(requirement.version) > 1);
  const items = changed
    .filter(({ requirement }) => !historyMentionsChange(requirement.history))
    .map(({ requirement, file }) => ({ id: requirement.id, version: requirement.version, file }));

  return { total: changed.length, uncaptured: items.length, items };
}

// --------------------------------------------------------------------------
// Open ambiguities on a non-draft requirement
// --------------------------------------------------------------------------

function computeOpenAmbiguities(entries) {
  const items = entries
    .filter(({ requirement }) => requirement.status !== 'draft')
    .filter(({ requirement }) => Array.isArray(requirement.ambiguities) && requirement.ambiguities.length > 0)
    .map(({ requirement, file }) => ({
      id: requirement.id,
      status: requirement.status,
      count: requirement.ambiguities.length,
      file,
    }));

  return { total: items.length, items, ok: items.length === 0 };
}

// --------------------------------------------------------------------------
// Golden set — reused, not reimplemented
// --------------------------------------------------------------------------

function computeGoldenSet({ dir, skip, invoker }, lib = goldenSetLib) {
  if (skip) {
    return { available: false, skipped: true, reason: 'skipped (--skip-golden-set)', summary: null };
  }

  if (!fs.existsSync(dir)) {
    return {
      available: false,
      skipped: false,
      reason: `no golden set at ${dir} — expected outside the toolkit repository itself; the set is not vendored into an installed project`,
      summary: null,
    };
  }

  let cases;
  try {
    cases = lib.discoverCases(dir, null);
  } catch (err) {
    return { available: false, skipped: false, reason: err.message, summary: null };
  }

  if (cases.length === 0) {
    return { available: false, skipped: false, reason: `no cases found in ${dir}`, summary: null };
  }

  const results = cases.map((caseDir) => lib.runCase(caseDir, { invoker, keep: false }));
  return { available: true, skipped: false, reason: null, summary: lib.summarise(results) };
}

// --------------------------------------------------------------------------
// Gate false-positive rate — read the documented log, or say "unmeasured"
// --------------------------------------------------------------------------

function computeGateFalsePositiveRate(logFile, displayPath) {
  const unmeasured = (note) => ({ measured: false, logFile: displayPath, note, overall: null, byGate: {} });

  if (!fs.existsSync(logFile)) {
    return unmeasured(
      `no gate findings log at ${displayPath}. See the header of scripts/metrics.js for the documented format — ` +
        'nothing in this toolkit writes it yet, so this is expected until a project starts recording gate decisions.',
    );
  }

  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  } catch (err) {
    return unmeasured(`${displayPath} is not readable JSON: ${err.message}`);
  }

  if (!Array.isArray(entries)) {
    return unmeasured(`${displayPath} must be a JSON array of {gate, outcome} records`);
  }

  const valid = entries.filter(
    (e) => e && typeof e.gate === 'string' && VALID_OUTCOMES.has(e.outcome),
  );

  if (valid.length === 0) {
    return unmeasured(`${displayPath} has no usable {gate, outcome} records yet`);
  }

  const byGate = {};
  for (const entry of valid) {
    const bucket = byGate[entry.gate] ?? (byGate[entry.gate] = { total: 0, falsePositives: 0 });
    bucket.total += 1;
    if (entry.outcome === 'false-positive') bucket.falsePositives += 1;
  }
  for (const gate of Object.keys(byGate)) byGate[gate].rate = byGate[gate].falsePositives / byGate[gate].total;

  const falsePositives = valid.filter((e) => e.outcome === 'false-positive').length;

  return {
    measured: true,
    logFile: displayPath,
    note: null,
    overall: { total: valid.length, falsePositives, rate: falsePositives / valid.length },
    byGate,
  };
}

// --------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------

function computeMetrics(options, deps = {}) {
  const projectDir = path.resolve(options.project);

  const { documents } = loadRequirementFiles(options.requirements, projectDir);
  const parseErrors = documents.filter((d) => d.error).map((d) => ({ file: d.file, error: d.error }));
  const entries = flatten(documents).filter(({ requirement }) => requirement && typeof requirement.id === 'string');

  const adapters = detectAdapters(projectDir, deps.adapters ?? loadAdapters());
  const annotations = collectAnnotations(projectDir, adapters);
  const annotationsById = new Map();
  for (const annotation of annotations) {
    if (!annotationsById.has(annotation.id)) annotationsById.set(annotation.id, []);
    annotationsById.get(annotation.id).push(annotation);
  }

  const goldenSetDir = path.resolve(options.goldenSet);
  const gateLogFile = path.isAbsolute(options.gateLog) ? options.gateLog : path.join(projectDir, options.gateLog);
  const gateLogDisplay = path.isAbsolute(options.gateLog) ? options.gateLog : options.gateLog.split(path.sep).join('/');

  return {
    project: projectDir,
    generatedAt: new Date().toISOString(),
    requirementCount: entries.length,
    parseErrors,
    requirementCoverage: computeRequirementCoverage(entries, annotationsById),
    uncapturedChange: computeUncapturedChange(entries),
    openAmbiguities: computeOpenAmbiguities(entries),
    goldenSet: computeGoldenSet({ dir: goldenSetDir, skip: options.skipGoldenSet, invoker: options.invoker }, deps.goldenSet),
    gateFalsePositive: computeGateFalsePositiveRate(gateLogFile, gateLogDisplay),
  };
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    requirements: [],
    goldenSet: DEFAULT_GOLDEN_SET,
    skipGoldenSet: false,
    invoker: process.env.ITM_SDLC_REVIEWER_CMD || null,
    gateLog: DEFAULT_GATE_LOG,
    strict: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} requires a value`);
      return argv[i];
    };

    switch (arg) {
      case '--project': options.project = value(); break;
      case '--requirements': options.requirements.push(value()); break;
      case '--golden-set': options.goldenSet = path.resolve(value()); break;
      case '--skip-golden-set': options.skipGoldenSet = true; break;
      case '--invoker': options.invoker = value(); break;
      case '--gate-log': options.gateLog = value(); break;
      case '--strict': options.strict = true; break;
      case '--json': options.json = true; break;
      case '-h': case '--help': options.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }

  if (options.requirements.length === 0) options.requirements = [...DEFAULT_PATTERNS];
  return options;
}

const USAGE = `
Usage: node scripts/metrics.js [options]

  Governance metrics, computed from the repository alone. Never invents a
  number it cannot back up with a file in the project.

Options:
  --project <path>        project to measure (default: current directory)
  --requirements <glob>   requirement files, repeatable
                          (default: ${DEFAULT_PATTERNS.join(', ')})
  --golden-set <dir>      case directory (default: this toolkit's own set,
                          if this is a checkout of it)
  --skip-golden-set       do not run the golden set
  --invoker <command>     reviewer command for golden-set G7 cases
                          (or set $ITM_SDLC_REVIEWER_CMD)
  --gate-log <file>       default: ${DEFAULT_GATE_LOG.split(path.sep).join('/')}
                          (relative to --project unless absolute)
  --strict                exit 1 if a non-draft requirement has an open
                          ambiguity
  --json                  machine-readable output
  -h, --help              show this message

Exit codes: 0 reported, 1 --strict violation, 2 the tool could not run.
`;

function pct(rate) {
  return `${(rate * 100).toFixed(0)}%`;
}

function relativeTo(root, file) {
  if (!file) return '';
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : file;
}

function report(metrics) {
  const rel = (f) => relativeTo(metrics.project, f);
  const out = [];
  out.push('');
  out.push('itm-sdlc | metrics');
  out.push('');
  out.push(`  project     ${metrics.project}`);
  out.push(`  generated   ${metrics.generatedAt}`);
  out.push(`  requirements ${metrics.requirementCount}`);
  if (metrics.parseErrors.length > 0) {
    out.push(`  ${metrics.parseErrors.length} requirement file(s) could not be parsed:`);
    for (const e of metrics.parseErrors) out.push(`      ${rel(e.file)} — ${e.error}`);
  }
  out.push('');

  const rc = metrics.requirementCoverage;
  out.push(`  REQUIREMENT COVERAGE (${COVERAGE_FLOOR} or later)`);
  out.push(`    ${rc.covered}/${rc.requiringCoverage}` + (rc.rate === null ? ' (nothing at this floor yet)' : `  ${pct(rc.rate)}`));
  for (const item of rc.uncovered) out.push(`      uncovered  ${item.id} (${item.status})  ${rel(item.file)}`);
  out.push('');

  const uc = metrics.uncapturedChange;
  out.push('  UNCAPTURED CHANGE (version > 1, no CHG- in history)');
  out.push(`    ${uc.uncaptured}/${uc.total} version-bumped requirement(s)`);
  for (const item of uc.items) out.push(`      uncaptured  ${item.id}@v${item.version}  ${rel(item.file)}`);
  out.push('');

  const oa = metrics.openAmbiguities;
  out.push('  OPEN AMBIGUITIES on a non-draft requirement (must be zero)');
  out.push(`    ${oa.total}` + (oa.ok ? '  — clean' : ''));
  for (const item of oa.items) out.push(`      ${item.id} (${item.status})  ${item.count} open  ${rel(item.file)}`);
  out.push('');

  const gs = metrics.goldenSet;
  out.push('  GOLDEN SET');
  if (!gs.available) {
    out.push(`    not available — ${gs.reason}`);
  } else {
    const s = gs.summary;
    out.push(`    ${s.total} case(s): ${s.judged} judged, ${s.notRunnable} unjudged, ${s.knownGaps} known gap(s)`);
    out.push(`    ${s.caught}/${s.judged} judged case(s) caught`);
    out.push(
      s.headlineReportable
        ? `    detection rate: ${pct(s.detectionRate)}`
        : `    NO HEADLINE RATE — fewer than half the cases were judged`,
    );
  }
  out.push('');

  const fp = metrics.gateFalsePositive;
  out.push('  GATE FALSE-POSITIVE RATE');
  if (!fp.measured) {
    out.push(`    unmeasured — ${fp.note}`);
  } else {
    out.push(`    overall  ${fp.overall.falsePositives}/${fp.overall.total}  ${pct(fp.overall.rate)}`);
    for (const [gate, stats] of Object.entries(fp.byGate)) {
      out.push(`      ${gate}  ${stats.falsePositives}/${stats.total}  ${pct(stats.rate)}`);
    }
  }
  out.push('');

  out.push('  ' + '-'.repeat(66));
  out.push('  read-only report. Nothing here blocks a merge.');
  out.push('');

  process.stdout.write(out.join('\n') + '\n');
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`metrics: ${err.message}\n${USAGE}`);
    return EXIT_TOOL_ERROR;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  let metrics;
  try {
    metrics = computeMetrics(options);
  } catch (err) {
    process.stderr.write(`metrics: ${err.message}\n`);
    return EXIT_TOOL_ERROR;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(metrics, null, 2) + '\n');
  } else {
    report(metrics);
  }

  return options.strict && !metrics.openAmbiguities.ok ? EXIT_VIOLATION : EXIT_OK;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  computeMetrics,
  computeRequirementCoverage,
  computeUncapturedChange,
  computeOpenAmbiguities,
  computeGoldenSet,
  computeGateFalsePositiveRate,
  collectAnnotations,
  parseArgs,
  main,
  DEFAULT_GOLDEN_SET,
  DEFAULT_GATE_LOG,
  COVERAGE_FLOOR,
};
