#!/usr/bin/env node
'use strict';

/**
 * check-constraints.js — are the recorded constraints still true?
 *
 * A constraint is something reality imposed: a vendor rate limit, a browser
 * behaviour, a legacy schema that cannot change. They expire. Rate limits get
 * raised, browsers ship the missing feature, the legacy system is retired.
 *
 * A brain full of constraints that stopped being true is WORSE than no record,
 * because it silently rules out approaches that would now work perfectly well,
 * and nobody re-checks a thing the record states as fact.
 *
 * Every constraint therefore carries a review-by date, and this reports the ones
 * that have passed it — or never had one.
 *
 * Usage:
 *   node scripts/check-constraints.js [options]
 *
 * Options:
 *   --project <path>   project to check (default: cwd)
 *   --within <days>    also report constraints expiring soon (default: 30)
 *   --today <date>     treat this ISO date as today, for testing
 *   --strict           exit 1 if any constraint is expired or undated
 *   --json             machine-readable
 *   -h, --help         this message
 *
 * Exit codes:
 *   0  clean, or advisory
 *   1  strict mode with expired or undated constraints
 *   2  the tool could not run
 */

const fs = require('node:fs');
const path = require('node:path');

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_TOOL_ERROR = 2;

/** Matches the field the constraints template mandates. */
const REVIEW_BY = /^\s*[-*]?\s*\*\*Review by:\*\*\s*(\d{4}-\d{2}-\d{2})/im;
const DISCOVERED = /^\s*[-*]?\s*\*\*Discovered:\*\*\s*(\d{4}-\d{2}-\d{2})/im;
const TITLE = /^#\s+(.+)$/m;

const DAY = 24 * 60 * 60 * 1000;

function finding(level, code, message, context = {}) {
  return { level, code, message, file: null, ...context };
}

/** Every constraint file, parsed. README.md is guidance, not a constraint. */
function readConstraints(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md')
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      const text = fs.readFileSync(file, 'utf8');
      const reviewBy = REVIEW_BY.exec(text)?.[1] ?? null;

      return {
        file,
        name,
        title: TITLE.exec(text)?.[1]?.trim() ?? name,
        discovered: DISCOVERED.exec(text)?.[1] ?? null,
        reviewBy,
      };
    });
}

function check(options) {
  const dir = path.join(path.resolve(options.project), '.brain', 'constraints');
  const constraints = readConstraints(dir);

  const today = new Date(`${options.today}T00:00:00Z`);
  if (Number.isNaN(today.getTime())) throw new Error(`--today is not a date: ${options.today}`);

  const findings = [];

  for (const constraint of constraints) {
    if (!constraint.reviewBy) {
      findings.push(
        finding('expired', 'no-review-date', 'has no **Review by:** date. A constraint with no expiry is never re-checked, and quietly becomes a fact nobody questions.', {
          file: constraint.file,
          title: constraint.title,
        }),
      );
      continue;
    }

    const due = new Date(`${constraint.reviewBy}T00:00:00Z`);
    if (Number.isNaN(due.getTime())) {
      findings.push(
        finding('expired', 'unreadable-date', `**Review by:** is not a usable date: ${constraint.reviewBy}`, {
          file: constraint.file,
          title: constraint.title,
        }),
      );
      continue;
    }

    const days = Math.round((due - today) / DAY);

    if (days < 0) {
      findings.push(
        finding('expired', 'expired', `review-by date passed ${Math.abs(days)} day(s) ago (${constraint.reviewBy}). Re-check it, then extend the date or delete the file. If anything was built around it, that belongs in rejected/.`, {
          file: constraint.file,
          title: constraint.title,
          reviewBy: constraint.reviewBy,
          days,
        }),
      );
    } else if (days <= options.within) {
      findings.push(
        finding('due-soon', 'due-soon', `review-by date is ${days} day(s) away (${constraint.reviewBy}).`, {
          file: constraint.file,
          title: constraint.title,
          reviewBy: constraint.reviewBy,
          days,
        }),
      );
    }
  }

  const expired = findings.filter((f) => f.level === 'expired');

  return {
    ok: expired.length === 0,
    mode: options.strict ? 'strict' : 'advisory',
    project: path.resolve(options.project),
    total: constraints.length,
    expiredCount: expired.length,
    dueSoonCount: findings.length - expired.length,
    findings,
  };
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

const USAGE = `
Usage: node scripts/check-constraints.js [options]

  Reports constraints whose review-by date has passed, and constraints that
  never had one.

Options:
  --project <path>   project to check (default: current directory)
  --within <days>    also report constraints expiring soon (default: 30)
  --today <date>     treat this ISO date as today, for testing
  --strict           exit 1 if any constraint is expired or undated
  --json             machine-readable output
  -h, --help         show this message

Exit codes: 0 clean or advisory, 1 expired in strict mode, 2 the tool failed.
`;

function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    within: 30,
    today: new Date().toISOString().slice(0, 10),
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
      case '--within': options.within = Number.parseInt(value(), 10); break;
      case '--today': options.today = value(); break;
      case '--strict': options.strict = true; break;
      case '--json': options.json = true; break;
      case '-h': case '--help': options.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }

  if (!Number.isInteger(options.within) || options.within < 0) {
    throw new Error('--within takes a whole number of days');
  }
  return options;
}

function report(result) {
  const rel = (f) => path.relative(result.project, f).split(path.sep).join('/');
  const out = ['', 'itm-sdlc | constraint expiry', ''];

  out.push(`  constraints  ${result.total}`);
  out.push('');

  for (const level of ['expired', 'due-soon']) {
    const group = result.findings.filter((f) => f.level === level);
    if (group.length === 0) continue;

    out.push(`  ${level === 'expired' ? 'EXPIRED' : 'DUE SOON'} (${group.length})`);
    for (const item of group) {
      out.push(`      ${item.title}`);
      out.push(`          ${rel(item.file)} — ${item.message}`);
    }
    out.push('');
  }

  out.push('  ' + '-'.repeat(66));
  out.push(`  ${result.expiredCount} expired, ${result.dueSoonCount} due soon  |  mode: ${result.mode}`);

  if (result.total === 0) {
    out.push('  No constraints recorded yet. That is normal early, and a problem later:');
    out.push('  a project that discovered no limits probably did not write them down.');
  } else if (result.ok) {
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
    process.stderr.write(`check-constraints: ${err.message}\n${USAGE}`);
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
    process.stderr.write(`check-constraints: ${err.message}\n`);
    return EXIT_TOOL_ERROR;
  }

  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else report(result);

  return options.strict && !result.ok ? EXIT_VIOLATION : EXIT_OK;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { check, readConstraints, parseArgs, main };
