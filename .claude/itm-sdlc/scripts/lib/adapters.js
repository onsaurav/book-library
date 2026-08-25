'use strict';

/**
 * Language adapters.
 *
 * This module is the only place in the toolkit that is allowed to know a file
 * extension, an annotation syntax or a build command — and even here it only
 * reads them out of adapters/*.json. Adding a language must mean adding one
 * JSON file and one rules directory, and changing no code.
 */

const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { globSync } = require('glob');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ADAPTERS_DIR = path.join(REPO_ROOT, 'adapters');
const ADAPTER_SCHEMA_PATH = path.join(REPO_ROOT, 'schema', 'adapter.schema.json');

/**
 * Ignore rules that are not language-specific. Everything else (bin/obj,
 * node_modules, target) is declared by the adapter that owns it.
 *
 * The vendored toolkit path is a SCAN rule only. It ships package.json, so
 * detecting against it would make every project look like JavaScript. It
 * must never become a gitignore rule — CI runs those scripts.
 */
const UNIVERSAL_IGNORE = ['**/.git/**', '**/.claude/itm-sdlc/**'];

/** Thrown when one or more adapter files are unusable. Carries every problem. */
class AdapterError extends Error {
  constructor(problems) {
    super(`invalid language adapter(s):\n  - ${problems.join('\n  - ')}`);
    this.name = 'AdapterError';
    this.problems = problems;
  }
}

/**
 * Number of capture groups in a regular expression source.
 *
 * Appending an empty alternative makes the whole pattern match the empty string,
 * so exec returns one entry per group regardless of what the pattern requires.
 */
function countCaptureGroups(source) {
  return new RegExp(`${source}|`).exec('').length - 1;
}

function compileSchema(schemaPath) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

/**
 * Checks that a JSON Schema cannot make: the annotation pattern must be usable,
 * and the declared example must actually be an instance of it. An adapter whose
 * example does not match its own pattern silently disables traceability for the
 * whole language, so this is checked at load time rather than discovered later.
 */
function checkAnnotation(adapter, file, problems) {
  const { pattern, example } = adapter.annotation;

  let regex;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    problems.push(`${file}: annotation.pattern is not a valid regular expression (${err.message})`);
    return;
  }

  const groups = countCaptureGroups(pattern);
  if (groups !== 2) {
    problems.push(
      `${file}: annotation.pattern must expose exactly 2 capture groups (id, version) but has ${groups}. Use (?:...) for grouping that should not capture.`,
    );
    return;
  }

  const match = regex.exec(example);
  if (!match) {
    problems.push(`${file}: annotation.example ${JSON.stringify(example)} does not match annotation.pattern`);
    return;
  }

  if (!match[1]) {
    problems.push(`${file}: annotation.pattern did not capture a requirement id from its own example`);
  }
  if (!match[2]) {
    problems.push(
      `${file}: annotation.example ${JSON.stringify(example)} has no @v version. CONVENTIONS.md §5 makes the version mandatory, so the example must carry one.`,
    );
  }
}

/**
 * Read and validate every adapter in `dir`.
 *
 * Throws AdapterError listing every problem found, rather than the first. A
 * broken adapter must fail loudly: silently dropping it would silently disable
 * the gates for that language.
 *
 * @returns {object[]} adapters, sorted by id
 */
function loadAdapters({ dir = ADAPTERS_DIR, schemaPath = ADAPTER_SCHEMA_PATH } = {}) {
  let validate;
  try {
    validate = compileSchema(schemaPath);
  } catch (err) {
    throw new AdapterError([`cannot load ${schemaPath}: ${err.message}`]);
  }

  let files;
  try {
    files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(dir, name));
  } catch (err) {
    throw new AdapterError([`cannot read adapters directory ${dir}: ${err.message}`]);
  }

  const problems = [];
  const adapters = [];
  const seenIds = new Set();

  for (const file of files) {
    const label = path.basename(file);

    let adapter;
    try {
      adapter = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push(`${label}: not valid JSON (${err.message})`);
      continue;
    }

    if (!validate(adapter)) {
      for (const err of validate.errors) {
        problems.push(`${label}: ${err.instancePath || '(root)'} ${err.message}`);
      }
      continue;
    }

    const expectedId = path.basename(file, '.json');
    if (adapter.id !== expectedId) {
      problems.push(`${label}: id is '${adapter.id}' but the filename declares '${expectedId}'`);
      continue;
    }

    if (seenIds.has(adapter.id)) {
      problems.push(`${label}: duplicate adapter id '${adapter.id}'`);
      continue;
    }
    seenIds.add(adapter.id);

    checkAnnotation(adapter, label, problems);
    adapters.push(Object.freeze({ ...adapter, sourceFile: file }));
  }

  if (problems.length > 0) throw new AdapterError(problems);
  return adapters;
}

/** Ignore globs for one adapter: its own, plus the universal ones. */
function ignoreFor(adapter) {
  return [...UNIVERSAL_IGNORE, ...(adapter.ignore ?? [])];
}

/** Resolve a set of globs inside a project, honouring the adapter's ignores. */
function filesMatching(projectDir, patterns, adapter) {
  const matches = globSync(patterns, {
    cwd: path.resolve(projectDir),
    absolute: true,
    nodir: true,
    ignore: ignoreFor(adapter),
    windowsPathsNoEscape: true,
  });

  return [...new Set(matches.map((file) => path.resolve(file)))].sort();
}

/** Production source files for this adapter within `projectDir`. */
function sourceFiles(projectDir, adapter) {
  return filesMatching(projectDir, adapter.sourceGlobs, adapter);
}

/** Test files for this adapter within `projectDir`. */
function testFiles(projectDir, adapter) {
  return filesMatching(projectDir, adapter.testGlobs, adapter);
}

/**
 * Which adapters apply to a project.
 *
 * An adapter activates when any of its `detect` globs matches and none of its
 * `detectUnless` globs do. A polyglot repository activates several, and each
 * contributes its own commands and annotation syntax.
 *
 * @returns {object[]} the subset of `adapters` that apply, sorted by id
 */
function detectAdapters(projectDir, adapters = loadAdapters()) {
  const resolved = path.resolve(projectDir);

  const anyMatch = (globs, adapter) =>
    globSync(globs, {
      cwd: resolved,
      absolute: true,
      nodir: true,
      ignore: ignoreFor(adapter),
      windowsPathsNoEscape: true,
    }).length > 0;

  return adapters.filter((adapter) => {
    if (!anyMatch(adapter.detect, adapter)) return false;

    // A marker that a more specific adapter also owns: package.json activates
    // JavaScript, but a tsconfig.json beside it means TypeScript owns this
    // project, and running both would execute the same commands twice.
    if (adapter.detectUnless && anyMatch(adapter.detectUnless, adapter)) return false;

    return true;
  });
}

/**
 * A fresh global RegExp for scanning a file body.
 *
 * Returned per call rather than cached: a /g regex carries mutable lastIndex,
 * and sharing one between scans loses matches.
 */
function annotationRegex(adapter) {
  return new RegExp(adapter.annotation.pattern, 'g');
}

module.exports = {
  ADAPTERS_DIR,
  ADAPTER_SCHEMA_PATH,
  UNIVERSAL_IGNORE,
  AdapterError,
  loadAdapters,
  detectAdapters,
  annotationRegex,
  sourceFiles,
  testFiles,
  filesMatching,
  ignoreFor,
  countCaptureGroups,
};
