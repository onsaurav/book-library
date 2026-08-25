#!/usr/bin/env node
'use strict';

/**
 * client-report.js — the traceability matrix a client can actually be shown.
 *
 * PDF §03 calls this "the client-facing dividend": a live matrix of every
 * requirement, its status, and the evidence behind it — the artefact that
 * makes milestone invoicing defensible.
 *
 * Deliberately narrow. This reads ONLY:
 *   - .brain/requirements/*.yaml  (id, title, status, version, verified_by,
 *     ambiguities)
 *   - test files, for a matching @covers annotation
 *
 * It never reads .brain/rejected/, .brain/sessions/, install-state.json, or
 * anything that carries implementation reasoning. A client reads why a
 * requirement is not yet verified; they do not read why an approach was
 * abandoned, what a session note says, or which files this toolkit installed.
 * Those are internal record, not the client's business.
 *
 * Usage:
 *   node scripts/client-report.js [options]
 *
 * Options:
 *   --project <path>        project to report on (default: cwd)
 *   --requirements <glob>   requirement files, repeatable
 *                           (default: .brain/requirements/*.yaml)
 *   --title <text>          report title (default: "<project> — requirement status")
 *   --format md|html|both   default: md
 *   --out <file>            write to this file instead of stdout. With
 *                           --format both, this is a base path and both
 *                           <out>.md and <out>.html are written
 *   --json                  emit the underlying matrix as JSON instead of a
 *                           rendered report
 *   -h, --help              this message
 *
 * Exit codes:
 *   0  reported
 *   2  the tool itself could not run
 */

const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_PATTERNS, loadRequirementFiles, flatten, STATUS_ORDER } = require('./lib/requirements');
const { loadAdapters, detectAdapters, testFiles } = require('./lib/adapters');
const { scanFile } = require('./check-traceability');

const EXIT_OK = 0;
const EXIT_TOOL_ERROR = 2;

// --------------------------------------------------------------------------
// Evidence — verified_by, plus a matching @covers annotation
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
  if (!file) return '';
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : file;
}

/** Evidence strings for one requirement: declared verified_by, plus any @covers location not already named by it. */
function evidenceFor(requirement, annotationsById, projectDir) {
  const declared = (requirement.verified_by ?? []).map((p) => p.split(path.sep).join('/'));
  const seen = new Set(declared);
  const items = [...declared];

  for (const annotation of annotationsById.get(requirement.id) ?? []) {
    const loc = `${relativeTo(projectDir, annotation.file)}:${annotation.line}`;
    if (seen.has(relativeTo(projectDir, annotation.file))) continue;
    if (!items.includes(loc)) items.push(loc);
  }

  return items;
}

// --------------------------------------------------------------------------
// Building the matrix
// --------------------------------------------------------------------------

function computeReport(options) {
  const projectDir = path.resolve(options.project);
  const { documents } = loadRequirementFiles(options.requirements, projectDir);

  const parseErrors = documents.filter((d) => d.error).map((d) => ({ file: d.file, error: d.error }));
  const entries = flatten(documents)
    .filter(({ requirement }) => requirement && typeof requirement.id === 'string')
    .sort((a, b) => a.requirement.id.localeCompare(b.requirement.id));

  const adapters = detectAdapters(projectDir, loadAdapters());
  const annotations = collectAnnotations(projectDir, adapters);
  const annotationsById = new Map();
  for (const annotation of annotations) {
    if (!annotationsById.has(annotation.id)) annotationsById.set(annotation.id, []);
    annotationsById.get(annotation.id).push(annotation);
  }

  const rows = entries.map(({ requirement }) => ({
    id: requirement.id,
    title: requirement.title,
    status: requirement.status,
    version: requirement.version,
    evidence: evidenceFor(requirement, annotationsById, projectDir),
    openQuestions: [...(requirement.ambiguities ?? [])],
  }));

  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
  for (const row of rows) if (byStatus[row.status] !== undefined) byStatus[row.status] += 1;

  return {
    project: projectDir,
    generatedAt: new Date().toISOString(),
    summary: { total: rows.length, byStatus },
    rows,
    parseErrors,
  };
}

// --------------------------------------------------------------------------
// Rendering — Markdown and HTML from the same computed report
// --------------------------------------------------------------------------

const escapeMd = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const escapeHtml = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function defaultTitle(report) {
  return `${path.basename(report.project)} — requirement status`;
}

function renderMarkdown(report, { title } = {}) {
  const out = [];
  out.push(`# ${title ?? defaultTitle(report)}`);
  out.push('');
  out.push(
    `Generated ${report.generatedAt} from the project's requirement record. This is a live snapshot — status may have moved since it was generated.`,
  );
  out.push('');

  const s = report.summary;
  out.push(
    `**${s.total} requirement(s):** ` +
      STATUS_ORDER.map((st) => `${s.byStatus[st]} ${st}`).join(', '),
  );
  out.push('');

  out.push('| REQ | Title | Status | Version | Evidence | Open questions |');
  out.push('|---|---|---|---|---|---|');

  for (const row of report.rows) {
    const evidence = row.evidence.length > 0 ? row.evidence.map(escapeMd).join('<br>') : '—';
    const questions = row.openQuestions.length > 0 ? row.openQuestions.map(escapeMd).join('<br>') : '—';
    out.push(
      `| ${row.id} | ${escapeMd(row.title)} | ${row.status} | ${row.version} | ${evidence} | ${questions} |`,
    );
  }

  out.push('');
  return out.join('\n') + '\n';
}

function renderHtml(report, { title } = {}) {
  const heading = escapeHtml(title ?? defaultTitle(report));
  const s = report.summary;
  const summaryLine = STATUS_ORDER.map((st) => `${s.byStatus[st]} ${st}`).join(', ');

  const rows = report.rows
    .map((row) => {
      const evidence = row.evidence.length > 0
        ? `<ul>${row.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
        : '—';
      const questions = row.openQuestions.length > 0
        ? `<ul>${row.openQuestions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}</ul>`
        : '—';
      return [
        '<tr>',
        `<td>${escapeHtml(row.id)}</td>`,
        `<td>${escapeHtml(row.title)}</td>`,
        `<td>${escapeHtml(row.status)}</td>`,
        `<td>${escapeHtml(row.version)}</td>`,
        `<td>${evidence}</td>`,
        `<td>${questions}</td>`,
        '</tr>',
      ].join('');
    })
    .join('\n');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${heading}</title>`,
    '<style>',
    'body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;}',
    'table{border-collapse:collapse;width:100%;}',
    'th,td{border:1px solid #ccc;padding:0.5rem 0.75rem;text-align:left;vertical-align:top;}',
    'th{background:#f2f2f2;}',
    'ul{margin:0;padding-left:1.1rem;}',
    '.summary{color:#444;}',
    '</style>',
    '</head>',
    '<body>',
    `<h1>${heading}</h1>`,
    `<p class="summary">Generated ${escapeHtml(report.generatedAt)} from the project's requirement record. This is a live snapshot — status may have moved since it was generated.</p>`,
    `<p><strong>${s.total} requirement(s):</strong> ${escapeHtml(summaryLine)}</p>`,
    '<table>',
    '<thead><tr><th>REQ</th><th>Title</th><th>Status</th><th>Version</th><th>Evidence</th><th>Open questions</th></tr></thead>',
    `<tbody>${rows}</tbody>`,
    '</table>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

const FORMATS = ['md', 'html', 'both'];

function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    requirements: [],
    title: null,
    format: 'md',
    out: null,
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
      case '--title': options.title = value(); break;
      case '--format': options.format = value(); break;
      case '--out': options.out = value(); break;
      case '--json': options.json = true; break;
      case '-h': case '--help': options.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }

  if (options.requirements.length === 0) options.requirements = [...DEFAULT_PATTERNS];

  if (!FORMATS.includes(options.format)) {
    throw new Error(`--format must be one of: ${FORMATS.join(', ')}`);
  }
  if (options.format === 'both' && !options.out && !options.json && !options.help) {
    throw new Error('--format both needs --out <path> — stdout can only hold one document');
  }

  return options;
}

const USAGE = `
Usage: node scripts/client-report.js [options]

  A live traceability matrix, client-facing only: REQ id, title, status,
  version, evidence, open questions. Never reads rejected/, sessions/,
  installer state, or anything carrying implementation reasoning.

Options:
  --project <path>        project to report on (default: current directory)
  --requirements <glob>   requirement files, repeatable
                          (default: ${DEFAULT_PATTERNS.join(', ')})
  --title <text>          report title (default: "<project> — requirement status")
  --format md|html|both   default: md
  --out <file>            write to this file instead of stdout. With
                          --format both, this is a base path and both
                          <out>.md and <out>.html are written
  --json                  emit the underlying matrix as JSON, not a report
  -h, --help              show this message

Exit codes: 0 reported, 2 the tool could not run.
`;

function writeOutput(content, out) {
  if (out) fs.writeFileSync(out, content, 'utf8');
  else process.stdout.write(content);
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`client-report: ${err.message}\n${USAGE}`);
    return EXIT_TOOL_ERROR;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  let report;
  try {
    report = computeReport(options);
  } catch (err) {
    process.stderr.write(`client-report: ${err.message}\n`);
    return EXIT_TOOL_ERROR;
  }

  if (options.json) {
    writeOutput(JSON.stringify(report, null, 2) + '\n', options.out);
    return EXIT_OK;
  }

  const renderOpts = { title: options.title };

  if (options.format === 'both') {
    fs.writeFileSync(`${options.out}.md`, renderMarkdown(report, renderOpts), 'utf8');
    fs.writeFileSync(`${options.out}.html`, renderHtml(report, renderOpts), 'utf8');
    process.stderr.write(`written: ${options.out}.md, ${options.out}.html\n`);
    return EXIT_OK;
  }

  const content = options.format === 'html' ? renderHtml(report, renderOpts) : renderMarkdown(report, renderOpts);
  writeOutput(content, options.out);
  return EXIT_OK;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  computeReport,
  renderMarkdown,
  renderHtml,
  evidenceFor,
  collectAnnotations,
  parseArgs,
  main,
};
