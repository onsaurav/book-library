'use strict';

/**
 * Loading and parsing of requirement YAML files.
 *
 * Shared by scripts/validate-requirements.js and scripts/check-traceability.js
 * so that both agree on what a requirement file is and where they live.
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { globSync } = require('glob');

const DEFAULT_PATTERNS = ['.brain/requirements/*.yaml', '.brain/requirements/*.yml'];

/** CONVENTIONS.md §6. Index order is the lifecycle order; do not reorder. */
const STATUS_ORDER = ['draft', 'agreed', 'in_progress', 'verified', 'signed_off'];

/**
 * YAML CORE schema keeps ISO dates as strings rather than coercing them to Date
 * objects. The JSON Schema declares those fields as strings, so coercion here
 * would produce spurious type errors.
 */
const YAML_OPTIONS = { schema: yaml.CORE_SCHEMA };

/**
 * Expand CLI patterns into a sorted, de-duplicated list of absolute file paths.
 *
 * A pattern that names an existing file is taken literally, which keeps Windows
 * paths with backslashes working without the caller having to escape them.
 */
function resolveFiles(patterns, cwd = process.cwd()) {
  const found = new Set();

  for (const pattern of patterns) {
    const literal = path.resolve(cwd, pattern);
    if (fs.existsSync(literal) && fs.statSync(literal).isFile()) {
      found.add(literal);
      continue;
    }

    const matches = globSync(pattern.split(path.sep).join('/'), {
      cwd,
      absolute: true,
      nodir: true,
      windowsPathsNoEscape: true,
    });
    for (const match of matches) found.add(path.resolve(match));
  }

  return [...found].sort();
}

/**
 * Parse one requirement file.
 *
 * @returns {{file: string, requirements: object[]|null, error: string|null}}
 */
function loadFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { file, requirements: null, error: `cannot read file: ${err.message}` };
  }

  let parsed;
  try {
    parsed = yaml.load(text, YAML_OPTIONS);
  } catch (err) {
    return { file, requirements: null, error: `invalid YAML: ${err.message}` };
  }

  // An empty file parses to undefined. Treat it as an empty requirement set
  // rather than an error; a module with no requirements yet is legitimate.
  if (parsed === undefined || parsed === null) {
    return { file, requirements: [], error: null };
  }

  if (!Array.isArray(parsed)) {
    return {
      file,
      requirements: null,
      error: 'top level of a requirement file must be an array of requirements',
    };
  }

  return { file, requirements: parsed, error: null };
}

/**
 * Load every requirement file matching `patterns`.
 *
 * Parse failures are returned as documents with `requirements: null` rather than
 * thrown, so that one broken file does not hide problems in the others.
 *
 * @returns {{documents: object[], missingPatterns: string[]}}
 */
function loadRequirementFiles(patterns = DEFAULT_PATTERNS, cwd = process.cwd()) {
  const files = resolveFiles(patterns, cwd);
  const documents = files.map(loadFile);
  const missingPatterns = files.length === 0 ? [...patterns] : [];
  return { documents, missingPatterns };
}

/** Every successfully-parsed requirement, tagged with the file it came from. */
function flatten(documents) {
  const out = [];
  for (const doc of documents) {
    if (!doc.requirements) continue;
    doc.requirements.forEach((requirement, index) => {
      out.push({ requirement, file: doc.file, index });
    });
  }
  return out;
}

/** True when `status` is at or beyond `floor` in the frozen lifecycle. */
function statusAtLeast(status, floor) {
  const actual = STATUS_ORDER.indexOf(status);
  const required = STATUS_ORDER.indexOf(floor);
  if (actual === -1 || required === -1) return false;
  return actual >= required;
}

/** The MODULE segment of a requirement id, or null if the id is malformed. */
function moduleOf(id) {
  const match = /^REQ-([A-Z]{3,8})-\d{3}$/.exec(String(id ?? ''));
  return match ? match[1] : null;
}

module.exports = {
  DEFAULT_PATTERNS,
  STATUS_ORDER,
  resolveFiles,
  loadFile,
  loadRequirementFiles,
  flatten,
  statusAtLeast,
  moduleOf,
};
