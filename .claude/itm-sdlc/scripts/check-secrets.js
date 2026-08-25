#!/usr/bin/env node
'use strict';

/**
 * check-secrets.js — is there a credential committed in this tree?
 *
 * The golden set proved this gap: a hardcoded secret passed every gate. G1 runs
 * the adapter's linter, which is not configured to find credentials; G2 tests
 * pass; G3 checks traceability. G7 would only catch it if the pull request
 * happened to declare the requirement about credentials — and a change that
 * introduces a secret by accident declares whatever it was actually working on.
 *
 * **A gate that inspects only declared requirements cannot catch a defect that
 * can appear in any change.** So this one inspects everything.
 *
 * Deliberately language-neutral: a credential looks the same in every language,
 * so unlike G1 and G2 this does not go through the adapters.
 *
 * Honest about its limits: it finds literals matching known shapes. It does not
 * do entropy analysis and it will not catch a secret that looks like ordinary
 * text. Point --command at gitleaks or trufflehog for a stronger scan; this
 * exists so that a project with no scanner configured is not defenceless.
 *
 * Usage:
 *   node scripts/check-secrets.js [options]
 *
 * Options:
 *   --project <path>   tree to scan (default: cwd)
 *   --exclude <glob>   additional path to skip, repeatable
 *   --command <cmd>    run this instead, e.g. "gitleaks detect --no-git"
 *   --advisory         report and exit 0
 *   --json             machine-readable
 *   -h, --help         this message
 *
 * Exit codes:
 *   0  nothing found, or advisory
 *   1  a probable credential was found
 *   2  the tool could not run
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXIT_CLEAN = 0;
const EXIT_FOUND = 1;
const EXIT_TOOL_ERROR = 2;

/** A line carrying this marker is not reported. Use it for fixtures and docs. */
const ALLOW_MARKER = 'itm-sdlc:allow-secret';

const DEFAULT_EXCLUDES = [
  '.git', 'node_modules', 'dist', 'build', 'bin', 'obj', 'coverage',
  'playwright-report', 'TestResults', '.next', '.vs',
  // The toolkit's own golden set contains a deliberate credential. It must be
  // caught when the case is materialised and run, not when scanning this repo.
  path.join('tests', 'golden-set'),
];

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.gz', '.exe',
  '.dll', '.pdb', '.woff', '.woff2', '.ttf', '.mp4', '.webp', '.svg',
]);

/**
 * High-signal patterns only.
 *
 * A scanner that cries wolf gets switched off, and a blocking gate that cries
 * wolf gets the whole gauntlet resented. Every rule here should be something a
 * reviewer would agree is a credential on sight.
 */
const RULES = [
  { id: 'private-key', severity: 'blocking', description: 'private key block', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', severity: 'blocking', description: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', severity: 'blocking', description: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/ },
  { id: 'slack-token', severity: 'blocking', description: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'stripe-key', severity: 'blocking', description: 'Stripe secret key', pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { id: 'google-api-key', severity: 'blocking', description: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'jwt', severity: 'major', description: 'JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  {
    id: 'connection-string-password',
    severity: 'blocking',
    description: 'password inside a connection string',
    pattern: /(?:password|pwd)\s*=\s*(?!\s*[;'"]?\s*$)[^;'"\s]{4,}/i,
  },
  {
    id: 'assigned-secret',
    severity: 'blocking',
    description: 'credential assigned to a literal',
    // name = "value" / name: 'value', where the name reads as a credential.
    // The leading [A-Za-z0-9_]{0,24} is load-bearing: a word boundary does
    // NOT match inside DB_PASSWORD, because an underscore is a word
    // character. Without it the scanner misses every SCREAMING_SNAKE
    // constant, which is exactly where credentials get written.
    //
    // The credential word must END the identifier, so TOKEN_PATTERN and
    // SECRET_HEADER_NAME do not fire.
    pattern: /[A-Za-z0-9_]{0,24}(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|token)["\x27`]?\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/i,
    // Anything that is plainly not a secret value.
    exempt: /^(?:\s*|\$\{.*\}|<[^>]*>|process\.env\..*|env\..*|null|undefined|true|false|x{3,}|\*{3,}|\.{3,}|changeme|password|secret|your[-_].*|my[-_].*|example.*|placeholder.*|todo.*|redacted.*|dummy.*|test|sample.*)$/i,
  },
];

// --------------------------------------------------------------------------
// Scanning
// --------------------------------------------------------------------------

function isExcluded(relative, excludes) {
  const parts = relative.split(path.sep);
  return excludes.some((ex) => {
    const exParts = ex.split(/[\\/]/);
    return exParts.every((part, i) => parts[i] === part);
  });
}

function* walk(root, excludes, current = '') {
  const dir = path.join(root, current);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relative = path.join(current, entry.name);
    if (isExcluded(relative, excludes)) continue;

    if (entry.isDirectory()) yield* walk(root, excludes, relative);
    else if (entry.isFile() && !BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield relative;
    }
  }
}

/** Every rule hit in one file, with line numbers. */
function scanFile(root, relative) {
  const absolute = path.join(root, relative);

  let text;
  try {
    const stat = fs.statSync(absolute);
    if (stat.size > 2 * 1024 * 1024) return []; // a 2MB source file is not hand-written
    text = fs.readFileSync(absolute, 'utf8');
  } catch {
    return [];
  }

  if (text.includes('\0')) return []; // binary despite its extension

  const findings = [];
  text.split('\n').forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;

    for (const rule of RULES) {
      const match = rule.pattern.exec(line);
      if (!match) continue;
      if (rule.exempt && rule.exempt.test(match[1] ?? '')) continue;

      findings.push({
        rule: rule.id,
        severity: rule.severity,
        description: rule.description,
        file: relative.split(path.sep).join('/'),
        line: index + 1,
        // Never echo the value. CI logs are far more widely readable than
        // the repository was, so a scanner that prints what it found makes
        // the exposure worse. The identifier is safe and is what a developer
        // needs to find it; rules with no capture group report location only.
        evidence: match[1] === undefined ? null : `${line.trim().split(/[\"'`]/)[0].trim().slice(0, 60)}…`,
      });
    }
  });

  return findings;
}

function scan(options) {
  const root = path.resolve(options.project);
  const excludes = [...DEFAULT_EXCLUDES, ...options.excludes];

  const findings = [];
  let scanned = 0;

  for (const relative of walk(root, excludes)) {
    scanned += 1;
    findings.push(...scanFile(root, relative));
  }

  const blocking = findings.filter((f) => f.severity === 'blocking');

  return {
    ok: blocking.length === 0,
    mode: options.advisory ? 'advisory' : 'blocking',
    project: root,
    scannedFileCount: scanned,
    findings,
    blockingCount: blocking.length,
  };
}

/** Delegate to a stronger scanner when the project has configured one. */
function runExternal(command, project) {
  const result = spawnSync(command, { cwd: project, shell: true, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw new Error(`could not run ${command}: ${result.error.message}`);
  return result.status ?? 0;
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

const USAGE = `
Usage: node scripts/check-secrets.js [options]

  Scans a tree for committed credentials. Language-neutral: a credential looks
  the same in every language, so this does not go through the adapters.

Options:
  --project <path>   tree to scan (default: current directory)
  --exclude <path>   additional path to skip, repeatable
  --command <cmd>    run this instead, e.g. "gitleaks detect --no-git --redact"
  --advisory         report and exit 0
  --json             machine-readable output
  -h, --help         show this message

  Put ${ALLOW_MARKER} on a line to exempt it.

Exit codes: 0 clean or advisory, 1 credential found, 2 the tool failed.
`;

function parseArgs(argv) {
  const options = { project: process.cwd(), excludes: [], command: null, advisory: false, json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} requires a value`);
      return argv[i];
    };

    switch (arg) {
      case '--project': options.project = value(); break;
      case '--exclude': options.excludes.push(value()); break;
      case '--command': options.command = value(); break;
      case '--advisory': options.advisory = true; break;
      case '--json': options.json = true; break;
      case '-h': case '--help': options.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

function report(result) {
  const out = ['', 'itm-sdlc | secret scan', ''];
  out.push(`  scanned  ${result.scannedFileCount} file(s)`);
  out.push('');

  if (result.findings.length === 0) {
    out.push('  No credentials found.');
    out.push('');
    out.push('  This checks for literals matching known shapes. It does not do entropy');
    out.push('  analysis, so a clean result is evidence, not proof.');
  } else {
    for (const f of result.findings) {
      out.push(`  ${f.severity.toUpperCase()}  ${f.description}  [${f.rule}]`);
      out.push(`      ${f.file}:${f.line}`);
      out.push(`      ${f.evidence}`);
      out.push('');
    }
    out.push('  A credential that reached a commit is compromised. Rotate it — removing');
    out.push('  it from the working tree does not remove it from history.');
  }

  out.push('');
  out.push('  ' + '-'.repeat(66));
  out.push(`  ${result.blockingCount} blocking, ${result.findings.length - result.blockingCount} other  |  mode: ${result.mode}`);
  out.push(result.ok ? '  PASS' : result.mode === 'advisory' ? '  ADVISORY - reported, build not failed.' : '  FAIL');
  out.push('');

  process.stdout.write(out.join('\n') + '\n');
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`check-secrets: ${err.message}\n${USAGE}`);
    return EXIT_TOOL_ERROR;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return EXIT_CLEAN;
  }

  if (options.command) {
    try {
      const status = runExternal(options.command, path.resolve(options.project));
      return options.advisory ? EXIT_CLEAN : status === 0 ? EXIT_CLEAN : EXIT_FOUND;
    } catch (err) {
      process.stderr.write(`check-secrets: ${err.message}\n`);
      return EXIT_TOOL_ERROR;
    }
  }

  const result = scan(options);

  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else report(result);

  return options.advisory || result.ok ? EXIT_CLEAN : EXIT_FOUND;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { scan, scanFile, RULES, DEFAULT_EXCLUDES, ALLOW_MARKER, parseArgs, main };
