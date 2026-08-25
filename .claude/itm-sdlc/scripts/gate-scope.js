#!/usr/bin/env node
'use strict';

/**
 * gate-scope.js — gate G8.
 *
 * Turns the output of G1-G7 into the smallest possible list of things a human
 * must actually look at.
 *
 * The point is subtraction. A reviewer asked to read everything reads nothing
 * carefully. A reviewer handed the few things the machines could not settle
 * spends their judgement where judgement is the only thing that works.
 *
 * It also emits the record from which a false-positive rate can later be
 * computed: every advisory finding is listed with a checkbox, and the
 * accept/override decision made against it is what the gate promotion policy
 * needs before any advisory gate becomes blocking.
 *
 * Usage:
 *   node scripts/gate-scope.js <findings-dir> [comment-out]
 *
 * Reads G1..G4 job results from the environment variables G1, G2, G3, G4.
 */

const fs = require('node:fs');
const path = require('node:path');

const HARD_GATES = [
  ['G1', 'lint + build'],
  ['G2', 'unit tests'],
  ['G3', 'traceability'],
  ['G4', 'integration'],
];

const ADVISORY_GATES = ['g5', 'g6', 'g7'];

/** Statuses that mean the gate checked nothing at all. */
const DID_NOT_RUN = new Set(['not-configured', 'not-installed']);

const escapeCell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function readAdvisory(dir) {
  const reports = [];
  for (const gate of ADVISORY_GATES) {
    const file = path.join(dir, `${gate}.json`);
    if (!fs.existsSync(file)) {
      reports.push({ gate: gate.toUpperCase(), status: 'missing', findings: [] });
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      reports.push({ gate: parsed.gate ?? gate.toUpperCase(), status: parsed.status ?? 'unknown', findings: parsed.findings ?? [] });
    } catch {
      reports.push({ gate: gate.toUpperCase(), status: 'unreadable', findings: [] });
    }
  }
  return reports;
}

function buildScope({ hardResults, advisory }) {
  const failedHard = HARD_GATES.filter(([id]) => hardResults[id] === 'failure');
  const flagged = advisory.flatMap((report) => (report.findings ?? []).map((f) => ({ gate: report.gate, ...f })));
  const silent = advisory.filter((report) => DID_NOT_RUN.has(report.status) || report.status === 'missing' || report.status === 'unreadable');

  const lines = [];
  lines.push('## G8 — what needs a human');
  lines.push('');

  if (failedHard.length > 0) {
    lines.push('### Blocking gates failed');
    lines.push('');
    for (const [id, name] of failedHard) {
      lines.push(`- **${id} ${name}** — fix before review. A reviewer should not spend attention on a change that does not pass its own gates.`);
    }
    lines.push('');
  }

  if (flagged.length === 0) {
    lines.push('### Advisory gates flagged nothing');
    lines.push('');
    lines.push('Review is scoped to intent and design judgement — the things no gate can check.');
  } else {
    lines.push(`### ${flagged.length} advisory finding${flagged.length === 1 ? '' : 's'} to judge`);
    lines.push('');
    lines.push('Tick a box to accept the finding; leave it unticked and say why to override it.');
    lines.push('That accept/override decision is the only source of a false-positive rate,');
    lines.push('and no advisory gate is promoted to blocking without one.');
    lines.push('');
    lines.push('| | Gate | Severity | Location | Finding |');
    lines.push('|---|---|---|---|---|');
    for (const finding of flagged) {
      const where = finding.file ? `\`${finding.file}${finding.line ? `:${finding.line}` : ''}\`` : '—';
      lines.push(`| [ ] | ${finding.gate} | ${finding.severity ?? 'advisory'} | ${where} | ${escapeCell(finding.message).slice(0, 300)} |`);
    }
  }

  if (silent.length > 0) {
    lines.push('');
    lines.push('### Gates that checked nothing');
    lines.push('');
    for (const report of silent) {
      lines.push(`- **${report.gate}** — \`${report.status}\`. Do not read its silence as a pass.`);
    }
  }

  return {
    comment: lines.join('\n') + '\n',
    record: {
      gate: 'G8',
      hardGateResults: hardResults,
      advisoryFindingCount: flagged.length,
      gatesThatDidNotRun: silent.map((r) => ({ gate: r.gate, status: r.status })),
      findings: flagged,
    },
  };
}

function main(argv) {
  const dir = argv[0] ?? 'gate-findings';
  const commentOut = argv[1] ?? 'g8-comment.md';

  const hardResults = Object.fromEntries(HARD_GATES.map(([id]) => [id, process.env[id] ?? 'unknown']));
  const { comment, record } = buildScope({ hardResults, advisory: readAdvisory(dir) });

  fs.writeFileSync(commentOut, comment, 'utf8');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'g8-scope.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, comment);
  } else {
    process.stdout.write(comment);
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { buildScope, readAdvisory, HARD_GATES, ADVISORY_GATES, main };
