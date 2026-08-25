#!/usr/bin/env node
'use strict';

/**
 * check-pr-declaration.js
 *
 * Rejects a pull request whose description declares neither the requirements it
 * covers nor an exempt label.
 *
 * A change nobody can trace to a requirement cannot be verified against
 * anything, and never reaches the traceability report the client signs. This
 * check is cheap and runs before every other gate, so an undeclared change is
 * refused in seconds rather than after a full build.
 *
 * Accepts either:
 *
 *   Covers: REQ-SAMPLE-003@v1, REQ-SAMPLE-004@v1
 *
 *   Label: chore          (or the `chore` label applied to the pull request)
 *
 * Usage:
 *   node scripts/check-pr-declaration.js [--body-file <f> | --body <text>] [options]
 *
 * Options:
 *   --body-file <file>       read the description from a file
 *   --body <text>            the description itself
 *   --labels <json|csv>      labels applied to the pull request
 *   --exempt <csv>           labels that waive the requirement (default: chore)
 *   --requirements-glob <g>  verify declared ids exist (default: .brain/requirements/*.yaml)
 *   --no-verify-exist        skip the existence check
 *   --json                   machine-readable output
 *   -h, --help               this message
 *
 * Exit codes:
 *   0  declared correctly
 *   1  not declared, or declared badly
 *   2  the check could not run
 */

const fs = require('node:fs');

const { DEFAULT_PATTERNS, loadRequirementFiles, flatten } = require('./lib/requirements');

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_TOOL_ERROR = 2;

const COVERS_LINE = /^[ \t>*-]*covers\s*:\s*(.+)$/im;
const LABEL_LINE = /^[ \t>*-]*label\s*:\s*(.+)$/im;
const PINNED_ID = /REQ-[A-Z]{3,8}-\d{3}@v\d+/g;
const UNPINNED_ID = /REQ-[A-Z]{3,8}-\d{3}(?!@v)/g;
const DEFAULT_EXEMPT = ['chore'];

/** Strip HTML comments so the template's own instructions never count as a declaration. */
const stripComments = (text) => String(text ?? '').replace(/<!--[\s\S]*?-->/g, '');

function parseLabels(raw) {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed).map((l) => String(typeof l === 'string' ? l : l.name).toLowerCase());
    } catch {
      return [];
    }
  }
  return trimmed.split(',').map((l) => l.trim().toLowerCase()).filter(Boolean);
}

/**
 * Assess a pull request description.
 *
 * @returns {{ok: boolean, mode: string|null, covers: string[], problems: string[]}}
 */
function checkDeclaration({ body, labels = [], exempt = DEFAULT_EXEMPT, knownIds = null }) {
  const text = stripComments(body);
  const problems = [];

  const exemptSet = new Set(exempt.map((e) => e.toLowerCase()));
  const applied = labels.map((l) => l.toLowerCase());

  const labelMatch = LABEL_LINE.exec(text);
  const declaredLabel = labelMatch ? labelMatch[1].trim().toLowerCase().replace(/[.,;]$/, '') : null;

  const exemptBy = applied.find((l) => exemptSet.has(l)) ?? (declaredLabel && exemptSet.has(declaredLabel) ? declaredLabel : null);

  const coversMatch = COVERS_LINE.exec(text);

  if (!coversMatch && exemptBy) {
    return { ok: true, mode: `exempt:${exemptBy}`, covers: [], problems: [] };
  }

  if (!coversMatch) {
    problems.push(
      'the description declares nothing. Add a line naming what this change covers:\n' +
        '      Covers: REQ-SAMPLE-003@v1\n' +
        `    or, if it genuinely satisfies no requirement, "Label: ${[...exemptSet][0]}" and apply that label.`,
    );
    return { ok: false, mode: null, covers: [], problems };
  }

  const declared = coversMatch[1];
  const pinned = [...new Set(declared.match(PINNED_ID) ?? [])].sort();
  const unpinned = [...new Set(declared.match(UNPINNED_ID) ?? [])].sort();

  if (pinned.length === 0 && unpinned.length === 0) {
    problems.push(`the Covers line names no requirement id: "${declared.trim()}"`);
  }

  if (unpinned.length > 0) {
    problems.push(
      `every id must carry its version (CONVENTIONS.md §5). Unpinned: ${unpinned.join(', ')}. ` +
        `Write ${unpinned[0]}@v1, using the requirement's current version.`,
    );
  }

  if (knownIds) {
    const missing = pinned.map((p) => p.split('@')[0]).filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      problems.push(
        `declared requirement(s) that do not exist: ${missing.join(', ')}. ` +
          'Either the id is wrong, or the requirement was never written.',
      );
    }
  }

  return { ok: problems.length === 0, mode: 'covers', covers: pinned, problems };
}

/** Ids present in the requirement record, or null when it cannot be read. */
function knownRequirementIds(patterns, cwd = process.cwd()) {
  try {
    const { documents } = loadRequirementFiles(patterns, cwd);
    const ids = new Set();
    for (const { requirement } of flatten(documents)) {
      if (requirement && typeof requirement.id === 'string') ids.add(requirement.id);
    }
    return ids.size > 0 ? ids : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    body: null,
    bodyFile: null,
    labels: [],
    exempt: [...DEFAULT_EXEMPT],
    requirementsGlob: [...DEFAULT_PATTERNS],
    verifyExist: true,
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
      case '--body': options.body = value(); break;
      case '--body-file': options.bodyFile = value(); break;
      case '--labels': options.labels = parseLabels(value()); break;
      case '--exempt': options.exempt = value().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--requirements-glob': options.requirementsGlob = [value()]; break;
      case '--no-verify-exist': options.verifyExist = false; break;
      case '--json': options.json = true; break;
      case '-h': case '--help': options.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }

  return options;
}

const USAGE = `
Usage: node scripts/check-pr-declaration.js [--body-file <f> | --body <text>] [options]

  Rejects a pull request that declares neither the requirements it covers nor an
  exempt label.

Options:
  --body-file <file>       read the description from a file
  --body <text>            the description itself
  --labels <json|csv>      labels applied to the pull request
  --exempt <csv>           labels that waive the requirement (default: ${DEFAULT_EXEMPT.join(',')})
  --requirements-glob <g>  default: ${DEFAULT_PATTERNS[0]}
  --no-verify-exist        do not check that declared ids exist
  --json                   machine-readable output
  -h, --help               show this message

Exit codes: 0 declared, 1 not declared or declared badly, 2 the check failed to run.
`;

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`check-pr-declaration: ${err.message}\n${USAGE}`);
    return EXIT_TOOL_ERROR;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  let body = options.body;
  if (body === null && options.bodyFile) {
    try {
      body = fs.readFileSync(options.bodyFile, 'utf8');
    } catch (err) {
      process.stderr.write(`check-pr-declaration: cannot read ${options.bodyFile}: ${err.message}\n`);
      return EXIT_TOOL_ERROR;
    }
  }

  const result = checkDeclaration({
    body: body ?? '',
    labels: options.labels,
    exempt: options.exempt,
    knownIds: options.verifyExist ? knownRequirementIds(options.requirementsGlob) : null,
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? EXIT_OK : EXIT_VIOLATION;
  }

  if (result.ok) {
    process.stdout.write(
      result.mode === 'covers'
        ? `PASS  this change declares: ${result.covers.join(', ')}\n`
        : `PASS  no requirement declared, waived by ${result.mode.replace('exempt:', 'label ')}\n`,
    );
    return EXIT_OK;
  }

  process.stderr.write('FAIL  this pull request does not declare what it covers.\n\n');
  for (const problem of result.problems) process.stderr.write(`  - ${problem}\n`);
  process.stderr.write('\n');
  return EXIT_VIOLATION;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { checkDeclaration, parseLabels, stripComments, knownRequirementIds, main, DEFAULT_EXEMPT };
