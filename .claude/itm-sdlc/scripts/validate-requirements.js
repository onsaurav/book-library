#!/usr/bin/env node
'use strict';

/**
 * validate-requirements.js
 *
 * Validates requirement YAML files against schema/requirement.schema.json and
 * against the cross-file rules that a JSON Schema cannot express.
 *
 * Usage:
 *   node scripts/validate-requirements.js [glob...] [options]
 *
 * Options:
 *   --json              machine-readable output on stdout
 *   --schema <path>     override the schema location
 *   --cwd <path>        resolve globs relative to this directory
 *   -h, --help          this message
 *
 * Exit codes:
 *   0  no errors
 *   1  at least one error
 *   2  the tool itself could not run (missing schema, bad arguments)
 */

const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const {
  DEFAULT_PATTERNS,
  loadRequirementFiles,
  flatten,
  statusAtLeast,
  moduleOf,
} = require('./lib/requirements');

const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'requirement.schema.json');

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_TOOL_ERROR = 2;

// --------------------------------------------------------------------------
// Argument parsing
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    patterns: [],
    json: false,
    help: false,
    schemaPath: DEFAULT_SCHEMA_PATH,
    cwd: process.cwd(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--json':
        options.json = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--schema':
        i += 1;
        if (argv[i] === undefined) throw new Error('--schema requires a path');
        options.schemaPath = path.resolve(argv[i]);
        break;
      case '--cwd':
        i += 1;
        if (argv[i] === undefined) throw new Error('--cwd requires a path');
        options.cwd = path.resolve(argv[i]);
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
        options.patterns.push(arg);
    }
  }

  if (options.patterns.length === 0) options.patterns = [...DEFAULT_PATTERNS];
  return options;
}

// --------------------------------------------------------------------------
// Findings
// --------------------------------------------------------------------------

function finding(level, code, message, context = {}) {
  return { level, code, message, file: null, id: null, ...context };
}

const error = (code, message, context) => finding('error', code, message, context);
const warning = (code, message, context) => finding('warning', code, message, context);

// --------------------------------------------------------------------------
// Checks that a JSON Schema cannot express
// --------------------------------------------------------------------------

/** Requirement ids must be unique across every file, not merely within one. */
function checkUniqueIds(entries) {
  const seen = new Map();
  const findings = [];

  for (const entry of entries) {
    const id = entry.requirement?.id;
    if (typeof id !== 'string') continue;

    const previous = seen.get(id);
    if (previous) {
      findings.push(
        error('duplicate-id', `${id} is already declared in ${previous.file}. Requirement ids are globally unique and are never reused (CONVENTIONS.md §1).`, {
          file: entry.file,
          id,
        }),
      );
      continue;
    }
    seen.set(id, entry);
  }

  return findings;
}

/** The `module` field must agree with the MODULE segment of the id. */
function checkModuleAgreesWithId(entries) {
  const findings = [];

  for (const { requirement, file } of entries) {
    const { id, module } = requirement ?? {};
    if (typeof id !== 'string' || typeof module !== 'string') continue;

    const fromId = moduleOf(id);
    if (fromId && fromId !== module) {
      findings.push(
        error('module-mismatch', `module is '${module}' but the id declares '${fromId}'. One of the two is wrong; the id is frozen, so fix the module field.`, {
          file,
          id,
        }),
      );
    }
  }

  return findings;
}

/** Every depends_on target must resolve to a requirement that exists. */
function checkDependenciesExist(entries, index) {
  const findings = [];

  for (const { requirement, file } of entries) {
    const dependencies = requirement?.depends_on;
    if (!Array.isArray(dependencies)) continue;

    for (const target of dependencies) {
      if (!index.has(target)) {
        findings.push(
          error('unknown-dependency', `depends_on references ${target}, which does not exist in any scanned requirement file.`, {
            file,
            id: requirement.id ?? null,
          }),
        );
      }
    }
  }

  return findings;
}

/**
 * Depth-first cycle detection over the depends_on graph.
 *
 * Reports each distinct cycle once, keyed by its normalised member set, so that
 * an A -> B -> A cycle produces one finding rather than one per participant.
 */
function checkNoDependencyCycles(entries, index) {
  const findings = [];
  const reported = new Set();
  const state = new Map(); // id -> 'visiting' | 'done'

  const dependenciesOf = (id) => {
    const requirement = index.get(id);
    const dependencies = requirement?.depends_on;
    return Array.isArray(dependencies) ? dependencies.filter((d) => index.has(d)) : [];
  };

  const record = (cycle) => {
    const key = [...cycle].sort().join('|');
    if (reported.has(key)) return;
    reported.add(key);

    const owner = entries.find((entry) => entry.requirement?.id === cycle[0]);
    findings.push(
      error('dependency-cycle', `dependency cycle: ${[...cycle, cycle[0]].join(' -> ')}. A requirement cannot transitively depend on itself.`, {
        file: owner ? owner.file : null,
        id: cycle[0],
      }),
    );
  };

  const visit = (id, stack) => {
    if (state.get(id) === 'done') return;

    if (state.get(id) === 'visiting') {
      const start = stack.indexOf(id);
      record(stack.slice(start));
      return;
    }

    state.set(id, 'visiting');
    stack.push(id);
    for (const next of dependenciesOf(id)) visit(next, stack);
    stack.pop();
    state.set(id, 'done');
  };

  for (const id of index.keys()) visit(id, []);
  return findings;
}

/** CONVENTIONS.md §6: an open ambiguity blocks the draft -> agreed transition. */
function checkAgreedHasNoOpenAmbiguities(entries) {
  const findings = [];

  for (const { requirement, file } of entries) {
    const { id, status, ambiguities } = requirement ?? {};
    if (!statusAtLeast(status, 'agreed')) continue;

    const open = Array.isArray(ambiguities) ? ambiguities : [];
    if (open.length > 0) {
      const plural = open.length === 1 ? 'ambiguity is' : 'ambiguities are';
      findings.push(
        error('open-ambiguity', `status is '${status}' but ${open.length} ${plural} still open. An ambiguity is resolved by the client answering it, never by the toolkit choosing a reading (CONVENTIONS.md §6).`, {
          file,
          id: id ?? null,
        }),
      );
    }
  }

  return findings;
}

/** CONVENTIONS.md §6: in_progress -> verified requires at least one verified_by entry. */
function checkVerifiedHasEvidence(entries) {
  const findings = [];

  for (const { requirement, file } of entries) {
    const { id, status, verified_by: verifiedBy } = requirement ?? {};
    if (!statusAtLeast(status, 'verified')) continue;

    const evidence = Array.isArray(verifiedBy) ? verifiedBy : [];
    if (evidence.length === 0) {
      findings.push(
        error('missing-verification', `status is '${status}' but verified_by is empty. A requirement is verified by a test that annotates it, or it is not verified.`, {
          file,
          id: id ?? null,
        }),
      );
    }
  }

  return findings;
}

// --------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------

function compileSchema(schemaPath) {
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    throw new Error(`cannot load schema at ${schemaPath}: ${err.message}`);
  }

  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function schemaFindings(documents, validateDocument) {
  const findings = [];

  for (const doc of documents) {
    if (doc.error) {
      findings.push(error('parse', doc.error, { file: doc.file, id: null }));
      continue;
    }

    if (validateDocument(doc.requirements)) continue;

    for (const err of validateDocument.errors) {
      // instancePath looks like "/2/acceptance/0/then"; the first segment is the
      // index of the requirement within the file.
      const [, indexSegment, ...rest] = err.instancePath.split('/');
      const index = Number.parseInt(indexSegment, 10);
      const subject = Number.isInteger(index) ? doc.requirements[index] : undefined;
      const field = rest.length > 0 ? rest.join('.') : '(requirement)';

      findings.push(
        error('schema', `${field}: ${err.message}${err.params && Object.keys(err.params).length ? ` (${JSON.stringify(err.params)})` : ''}`, {
          file: doc.file,
          id: subject?.id ?? (Number.isInteger(index) ? `#${index}` : null),
        }),
      );
    }
  }

  return findings;
}

function validate(options) {
  const validateDocument = compileSchema(options.schemaPath);
  const { documents, missingPatterns } = loadRequirementFiles(options.patterns, options.cwd);

  const findings = [];

  if (missingPatterns.length > 0) {
    findings.push(
      warning('no-files', `no requirement files matched: ${missingPatterns.join(', ')}. Nothing was validated.`),
    );
  }

  findings.push(...schemaFindings(documents, validateDocument));

  // Cross-file checks run over structurally-sound requirements only. Feeding a
  // requirement that failed the schema into the graph checks produces noise
  // that hides the real cause.
  const entries = flatten(documents).filter(
    ({ requirement }) => requirement && typeof requirement === 'object' && typeof requirement.id === 'string',
  );

  const index = new Map();
  for (const entry of entries) if (!index.has(entry.requirement.id)) index.set(entry.requirement.id, entry.requirement);

  findings.push(...checkUniqueIds(entries));
  findings.push(...checkModuleAgreesWithId(entries));
  findings.push(...checkDependenciesExist(entries, index));
  findings.push(...checkNoDependencyCycles(entries, index));
  findings.push(...checkAgreedHasNoOpenAmbiguities(entries));
  findings.push(...checkVerifiedHasEvidence(entries));

  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warning');

  return {
    ok: errors.length === 0,
    files: documents.map((doc) => ({
      path: doc.file,
      requirements: doc.requirements ? doc.requirements.length : 0,
      parsed: doc.error === null,
    })),
    requirementCount: entries.length,
    findings,
    errorCount: errors.length,
    warningCount: warnings.length,
  };
}

// --------------------------------------------------------------------------
// Reporting
// --------------------------------------------------------------------------

function relative(cwd, file) {
  if (!file) return '(no file)';
  const rel = path.relative(cwd, file);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : file;
}

function printHumanReport(result, options) {
  const lines = [];
  lines.push('');
  lines.push('itm-sdlc | requirement validation');
  lines.push('');

  const byFile = new Map();
  for (const f of result.findings) {
    const key = f.file ?? '';
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(f);
  }

  for (const file of result.files) {
    const problems = byFile.get(file.path) ?? [];
    const label = `${relative(options.cwd, file.path)}  (${file.requirements} requirement${file.requirements === 1 ? '' : 's'})`;
    lines.push(problems.length === 0 ? `  ok    ${label}` : `  FAIL  ${label}`);

    for (const problem of problems) {
      lines.push(`          ${problem.level.toUpperCase()}  [${problem.code}]  ${problem.id ?? ''}`.trimEnd());
      lines.push(`          ${problem.message}`);
      lines.push('');
    }
  }

  const unattached = byFile.get('') ?? [];
  for (const problem of unattached) {
    lines.push(`  ${problem.level.toUpperCase()}  [${problem.code}]  ${problem.message}`);
  }

  lines.push('');
  lines.push('  ' + '-'.repeat(66));
  lines.push(
    `  ${result.files.length} file${result.files.length === 1 ? '' : 's'}, ` +
      `${result.requirementCount} requirement${result.requirementCount === 1 ? '' : 's'}, ` +
      `${result.errorCount} error${result.errorCount === 1 ? '' : 's'}, ` +
      `${result.warningCount} warning${result.warningCount === 1 ? '' : 's'}`,
  );
  lines.push(`  ${result.ok ? 'PASS' : 'FAIL'}`);
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');
}

const USAGE = `
Usage: node scripts/validate-requirements.js [glob...] [options]

  Validates requirement YAML files against schema/requirement.schema.json plus
  the cross-file rules in CONVENTIONS.md.

  Defaults to ${DEFAULT_PATTERNS.join(', ')} when no glob is given.

Options:
  --json           machine-readable output
  --schema <path>  override the schema location
  --cwd <path>     resolve globs relative to this directory
  -h, --help       show this message

Exit codes: 0 clean, 1 violations found, 2 the tool could not run.
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
    result = validate(options);
  } catch (err) {
    process.stderr.write(`validate-requirements: ${err.message}\n`);
    return EXIT_TOOL_ERROR;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printHumanReport(result, options);
  }

  return result.ok ? EXIT_OK : EXIT_VIOLATION;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { validate, parseArgs, main };
