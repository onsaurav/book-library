#!/usr/bin/env node
'use strict';

/**
 * run-golden-set.js
 *
 * Applies each deliberately defective change in tests/golden-set/, runs the
 * gauntlet against it, and reports which were caught.
 *
 * The premise, from the operating model:
 *
 *   "If the gauntlet cannot catch a known-bad change, it is theatre and should
 *    be treated as such until it is fixed."
 *
 * A gauntlet only ever run against good changes has demonstrated nothing. Every
 * gate is green — and green is also what a gate that checks nothing looks like.
 *
 * Each case is materialised into a temporary git repository: base tree
 * committed, head tree committed on a branch. Nothing in this repository is
 * touched.
 *
 * Usage:
 *   node scripts/run-golden-set.js [options]
 *
 * Options:
 *   --set <dir>           case directory (default: tests/golden-set)
 *   --case <id>           run one case
 *   --min-detection <n>   exit 1 if the detection rate falls below n (0-1)
 *   --invoker <command>   reviewer command, or $ITM_SDLC_REVIEWER_CMD
 *   --json                machine-readable output
 *   --keep                leave the scratch repositories in place
 *   -h, --help            this message
 *
 * Exit codes:
 *   0  ran, and the detection rate met the threshold (or none was given)
 *   1  detection rate below the threshold
 *   2  the runner could not run
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TOOLKIT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SET = path.join(TOOLKIT_ROOT, 'tests', 'golden-set');

const EXIT_OK = 0;
const EXIT_BELOW_THRESHOLD = 1;
const EXIT_RUNNER_ERROR = 2;

const SEVERITY_ORDER = ['observation', 'minor', 'major', 'blocking'];

class RunnerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RunnerError';
  }
}

// --------------------------------------------------------------------------
// Materialising a case
// --------------------------------------------------------------------------

const git = (repo, args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function copyTree(from, to) {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
}

/**
 * Build a scratch git repository holding the case: base committed on `main`,
 * head committed on a branch, requirements in `.brain/requirements/`.
 */
function materialise(caseDir, keep) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'itm-golden-'));

  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'golden-set@example.invalid']);
  git(repo, ['config', 'user.name', 'Golden Set']);
  git(repo, ['config', 'commit.gpgsign', 'false']);

  copyTree(path.join(caseDir, 'base'), repo);
  fs.mkdirSync(path.join(repo, '.brain', 'requirements'), { recursive: true });
  copyTree(path.join(caseDir, 'requirements'), path.join(repo, '.brain', 'requirements'));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);

  git(repo, ['checkout', '-q', '-b', 'change']);
  copyTree(path.join(caseDir, 'head'), repo);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'the change under test']);

  return {
    repo,
    cleanup: () => {
      if (!keep) fs.rmSync(repo, { recursive: true, force: true });
    },
  };
}

// --------------------------------------------------------------------------
// Detection
// --------------------------------------------------------------------------

/** G3: the traceability checker must report a finding with the named code. */
function detectByTraceability(repo, check) {
  const { check: runCheck } = require('./check-traceability');

  const result = runCheck({
    project: repo,
    requirements: ['.brain/requirements/*.yaml'],
    strict: true,
    json: true,
  });

  const matches = result.findings.filter(
    (f) => f.code === check.code && (!check.id || f.id === check.id),
  );

  return {
    caught: matches.length > 0,
    detail: matches.length > 0
      ? `${matches[0].code} — ${matches[0].message}`
      : `no ${check.code} finding. Reported: ${result.findings.map((f) => f.code).join(', ') || 'nothing'}`,
    evidence: matches,
  };
}

/** G7: the reviewer must return a finding at or above the named severity. */
function detectByReviewer(repo, check, invoker, requirements) {
  if (!invoker) {
    return {
      caught: null,
      detail: 'no reviewer configured (--invoker or $ITM_SDLC_REVIEWER_CMD); this case could not be judged',
      evidence: [],
    };
  }

  const { review } = require('./review-change');

  let result;
  try {
    result = review({
      base: 'main',
      head: 'change',
      repo,
      requirements,
      prDescription: null,
      requirementsGlob: ['.brain/requirements/*.yaml'],
      out: path.join(repo, 'review-findings.json'),
      invoker,
      promptOnly: false,
    });
  } catch (err) {
    // A broken reviewer command is a configuration fault, not a gate that
    // failed to notice. Recording it as MISSED would understate the detection
    // rate and send someone hunting a reviewer prompt that is working fine.
    return {
      caught: null,
      detail: `the reviewer could not be run, so this case was not judged: ${err.message.split('\n')[0]}`,
      evidence: [],
    };
  }

  const floor = SEVERITY_ORDER.indexOf(check.minSeverity ?? 'blocking');
  const matches = (result.findings ?? []).filter((f) => {
    const rank = SEVERITY_ORDER.indexOf(f.severity);
    if (rank < floor) return false;
    return !check.file || String(f.file ?? '').endsWith(check.file);
  });

  return {
    caught: matches.length > 0,
    detail: matches.length > 0
      ? `${matches[0].severity} at ${matches[0].file}:${matches[0].line}`
      : `no finding at or above '${check.minSeverity}'${check.file ? ` in ${check.file}` : ''}. Returned ${result.findings.length} finding(s).`,
    evidence: matches,
  };
}

/** A secret scan over the changed tree. Language-neutral, so no adapter needed. */
function detectBySecretScan(repo, check) {
  const { scan } = require('./check-secrets');

  // The case lives in a scratch repo, so the toolkit's own golden-set exclude
  // does not apply here — which is the point. It must be caught when run.
  const result = scan({ project: repo, excludes: [], advisory: true });

  const matches = result.findings.filter(
    (f) => (!check.rule || f.rule === check.rule) && (!check.file || String(f.file).endsWith(check.file)),
  );

  return {
    caught: matches.length > 0,
    detail: matches.length > 0
      ? `${matches[0].rule} at ${matches[0].file}:${matches[0].line}`
      : `no secret finding${check.file ? ` in ${check.file}` : ''}. Scanned ${result.scannedFileCount} file(s).`,
    evidence: matches,
  };
}

/** Declared as caught by nothing. Verified as such, not assumed. */
function detectUnguarded(check) {
  return {
    caught: false,
    expectedUndetected: true,
    detail: check.reason ?? 'no gate covers this class of defect',
    evidence: [],
  };
}

function runCase(caseDir, options) {
  const definition = JSON.parse(fs.readFileSync(path.join(caseDir, 'case.json'), 'utf8'));
  const { gate, check } = definition.detectedBy;

  if (check.type === 'unguarded') {
    return { ...definition, gate, ...detectUnguarded(check) };
  }

  const { repo, cleanup } = materialise(caseDir, options.keep);
  try {
    const outcome =
      check.type === 'traceability'
        ? detectByTraceability(repo, check)
        : check.type === 'secret-scan'
          ? detectBySecretScan(repo, check)
          : detectByReviewer(repo, check, options.invoker, definition.requirements);
    return { ...definition, gate, ...outcome, repo: options.keep ? repo : undefined };
  } finally {
    cleanup();
  }
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    set: DEFAULT_SET,
    only: null,
    minDetection: null,
    invoker: process.env.ITM_SDLC_REVIEWER_CMD || null,
    baseline: null,
    updateBaseline: false,
    json: false,
    keep: false,
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
      case '--set': options.set = path.resolve(value()); break;
      case '--case': options.only = value(); break;
      case '--min-detection': options.minDetection = Number.parseFloat(value()); break;
      case '--invoker': options.invoker = value(); break;
      case '--baseline': options.baseline = path.resolve(value()); break;
      case '--update-baseline': options.updateBaseline = true; break;
      case '--json': options.json = true; break;
      case '--keep': options.keep = true; break;
      case '-h': case '--help': options.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }

  if (options.minDetection !== null && !(options.minDetection >= 0 && options.minDetection <= 1)) {
    throw new Error('--min-detection takes a number between 0 and 1');
  }
  return options;
}

function discoverCases(dir, only) {
  if (!fs.existsSync(dir)) throw new RunnerError(`golden set not found: ${dir}`);

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name))
    .filter((d) => fs.existsSync(path.join(d, 'case.json')))
    .filter((d) => !only || path.basename(d) === only)
    .sort();
}

/**
 * Compare a run against the recorded baseline.
 *
 * A bare detection RATE is not enough to detect a regression. The rate rises
 * when a case stops being judged, and it rises when a case is deleted — both of
 * which mean less is being checked, not more. So the baseline pins four things,
 * and any of them moving the wrong way is a regression.
 */
function compareToBaseline(summary, baseline, currentGaps) {
  const problems = [];

  if (summary.caught < baseline.caught) {
    problems.push(`cases caught fell from ${baseline.caught} to ${summary.caught}. A defect the gauntlet used to catch now gets through.`);
  }

  if (summary.judged < baseline.judged) {
    problems.push(`judged cases fell from ${baseline.judged} to ${summary.judged}. Fewer cases could be evaluated, so the rate below is computed from less evidence.`);
  }

  if (summary.total < baseline.total) {
    problems.push(`the set shrank from ${baseline.total} to ${summary.total} cases. Deleting a case raises the rate without changing what gets through.`);
  }

  const newGaps = currentGaps.filter((g) => !(baseline.knownGaps ?? []).includes(g));
  if (newGaps.length > 0) {
    problems.push(`new unguarded defect class(es): ${newGaps.join(', ')}.`);
  }

  if (
    summary.detectionRate !== null &&
    baseline.detectionRate !== null &&
    summary.detectionRate < baseline.detectionRate
  ) {
    problems.push(
      `detection rate fell from ${(baseline.detectionRate * 100).toFixed(0)}% to ${(summary.detectionRate * 100).toFixed(0)}%.`,
    );
  }

  return { regressed: problems.length > 0, problems };
}

/**
 * Whether a headline rate computed from `judged`/`total` is worth printing at
 * all. PF-014: a rate computed from a small minority of the set reads as
 * confident and gets quoted as though it meant more than it does — three of
 * five cases unjudged and the number still says "100%". Below half judged,
 * the counts are the honest answer and the rate is not.
 */
function headlineReportable(judged, total) {
  return total > 0 && judged / total >= 0.5;
}

function summarise(results) {
  const judged = results.filter((r) => r.caught !== null && !r.expectedUndetected);
  const caught = judged.filter((r) => r.caught);
  const total = results.length;
  return {
    total,
    judged: judged.length,
    caught: caught.length,
    notCaught: judged.length - caught.length,
    notRunnable: results.filter((r) => r.caught === null).length,
    knownGaps: results.filter((r) => r.expectedUndetected).length,
    detectionRate: judged.length === 0 ? null : caught.length / judged.length,
    headlineReportable: headlineReportable(judged.length, total),
  };
}

function report(results, summary, options) {
  const out = [];
  out.push('');
  out.push('itm-sdlc | golden set');
  out.push('');

  for (const r of results) {
    const mark = r.expectedUndetected ? 'GAP  ' : r.caught === null ? '?    ' : r.caught ? 'CAUGHT' : 'MISSED';
    out.push(`  ${mark.padEnd(7)} ${r.id}   [${r.gate}]`);
    out.push(`          ${r.defect}`);
    out.push(`          ${r.detail}`);
    out.push('');
  }

  out.push('  ' + '-'.repeat(66));
  out.push(
    `  ${summary.total} case(s): ${summary.judged} judged, ${summary.notRunnable} unjudged, ${summary.knownGaps} known gap(s)`,
  );
  out.push(`  ${summary.caught}/${summary.judged} judged case(s) caught`);

  if (!summary.headlineReportable) {
    out.push(
      `  NO HEADLINE RATE — only ${summary.judged}/${summary.total} case(s) were judged (below half of the set).`,
    );
    out.push('  A rate computed from this little evidence would read as more settled than it is.');
  } else if (summary.detectionRate !== null) {
    out.push(`  detection rate: ${(summary.detectionRate * 100).toFixed(0)}%`);
  }

  if (summary.notRunnable > 0) out.push(`  ${summary.notRunnable} case(s) could not be judged — no reviewer configured`);
  if (summary.knownGaps > 0) out.push(`  ${summary.knownGaps} case(s) are known gaps with no gate at all`);

  if (options.minDetection !== null) {
    const met = summary.detectionRate !== null && summary.detectionRate >= options.minDetection;
    out.push(`  threshold ${(options.minDetection * 100).toFixed(0)}%: ${met ? 'MET' : 'NOT MET'}`);
  }
  out.push('');

  process.stdout.write(out.join('\n') + '\n');
}

const USAGE = `
Usage: node scripts/run-golden-set.js [options]

  Runs each deliberately defective change in the golden set through the gauntlet
  and reports which were caught.

Options:
  --set <dir>           case directory (default: tests/golden-set)
  --case <id>           run one case
  --min-detection <n>   exit 1 if the detection rate falls below n (0-1)
  --invoker <command>   reviewer command, or $ITM_SDLC_REVIEWER_CMD
  --baseline <file>     compare against a recorded baseline and fail on regression
  --update-baseline     rewrite the baseline from this run (deliberate act)
  --json                machine-readable output
  --keep                leave the scratch repositories in place
  -h, --help            show this message

Exit codes: 0 met, 1 below threshold or regressed against the baseline, 2 the runner failed.
`;

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`run-golden-set: ${err.message}\n${USAGE}`);
    return EXIT_RUNNER_ERROR;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  let results;
  try {
    const cases = discoverCases(options.set, options.only);
    if (cases.length === 0) throw new RunnerError(`no cases found in ${options.set}`);
    results = cases.map((dir) => runCase(dir, options));
  } catch (err) {
    process.stderr.write(`run-golden-set: ${err.message}\n`);
    return EXIT_RUNNER_ERROR;
  }

  const summary = summarise(results);
  const gaps = results.filter((r) => r.expectedUndetected).map((r) => r.id).sort();

  let comparison = null;
  if (options.baseline && !options.updateBaseline) {
    if (!fs.existsSync(options.baseline)) {
      process.stderr.write(`run-golden-set: baseline not found: ${options.baseline}\n`);
      return EXIT_RUNNER_ERROR;
    }
    try {
      comparison = compareToBaseline(summary, JSON.parse(fs.readFileSync(options.baseline, 'utf8')), gaps);
    } catch (err) {
      process.stderr.write(`run-golden-set: baseline is not readable JSON: ${err.message}\n`);
      return EXIT_RUNNER_ERROR;
    }
  }

  if (options.updateBaseline) {
    if (!options.baseline) {
      process.stderr.write('run-golden-set: --update-baseline needs --baseline <file>\n');
      return EXIT_RUNNER_ERROR;
    }
    fs.writeFileSync(
      options.baseline,
      JSON.stringify({ ...summary, knownGaps: gaps, recordedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8',
    );
    process.stdout.write(`baseline written to ${options.baseline}\n`);
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ summary, comparison, results }, null, 2) + '\n');
  } else {
    report(results, summary, options);

    if (comparison?.regressed) {
      const loud = [
        '',
        '  ################################################################',
        '  #  DETECTION HAS REGRESSED                                     #',
        '  ################################################################',
        '',
      ];
      for (const problem of comparison.problems) loud.push(`      ${problem}`);
      loud.push('');
      loud.push('  The gauntlet catches less than it did. Something changed in an agent');
      loud.push('  prompt, a model version, or a gate. Find out what before merging.');
      loud.push('');
      loud.push('  If the drop is legitimate and understood, record why, then re-run with');
      loud.push('  --update-baseline. Never update the baseline to make a run go green.');
      loud.push('');
      process.stdout.write(loud.join('\n') + '\n');
    }
  }

  if (comparison?.regressed) return EXIT_BELOW_THRESHOLD;

  if (options.minDetection !== null) {
    const met = summary.detectionRate !== null && summary.detectionRate >= options.minDetection;
    return met ? EXIT_OK : EXIT_BELOW_THRESHOLD;
  }
  return EXIT_OK;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  discoverCases,
  materialise,
  runCase,
  summarise,
  headlineReportable,
  compareToBaseline,
  parseArgs,
  main,
  RunnerError,
};
