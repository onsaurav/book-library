#!/usr/bin/env node
'use strict';

/**
 * review-change.js — the isolation harness for the adversarial reviewer.
 *
 * The agent file `agents/adversarial-reviewer.md` asks to be given only a diff
 * and the requirements it claims to satisfy. An agent file is a request. THIS
 * SCRIPT IS THE ENFORCEMENT: it constructs the reviewer's entire input, and it
 * is structurally incapable of including anything else.
 *
 * The guarantee rests on one property, which the tests assert directly:
 * `buildPrompt` takes exactly two arguments — the diff text and the selected
 * requirements. The implementation plan, the commit messages, the branch name
 * and any session transcript are never passed to it, so they cannot leak into
 * the prompt through a later edit that forgets why.
 *
 * A reviewer who has read the plan reviews the plan. The gap between what was
 * intended and what was built is exactly the gap that matters, and it is
 * invisible to anyone who has seen both.
 *
 * Usage:
 *   node scripts/review-change.js --base <ref> --head <ref> [options]
 *
 * Options:
 *   --base <ref>              base ref (required)
 *   --head <ref>              head ref (default: HEAD)
 *   --repo <path>             repository to diff (default: cwd)
 *   --requirements <ids>      comma-separated REQ ids, instead of a description
 *   --pr-description <file>   file to scan for REQ ids. Only the IDS are taken
 *                             from it; its prose is discarded and never reaches
 *                             the reviewer
 *   --requirements-glob <g>   where requirement files live
 *                             (default: .brain/requirements/*.yaml)
 *   --out <file>              findings output (default: review-findings.json)
 *   --invoker <command>       command that runs the reviewer. Receives the
 *                             prompt on stdin, returns findings JSON on stdout.
 *                             Resolution order (PF-004):
 *                               1. --invoker
 *                               2. $ITM_SDLC_REVIEWER_CMD  (an override, not the
 *                                  only path — set it for a different Claude
 *                                  Code version, a wrapper, or a non-Claude
 *                                  reviewer entirely)
 *                               3. the default: `claude -p`, used only when the
 *                                  `claude` binary actually resolves on PATH
 *                             $ITM_SDLC_REVIEWER_CMD set to the empty string
 *                             disables both 2 and 3 outright.
 *                             If nothing resolves, the review is skipped: the
 *                             output records status "not-configured" with no
 *                             findings, and the script exits 0 — an advisory
 *                             gate with nothing to invoke is not a failure.
 *   --prompt-only             print the constructed prompt and exit, running no
 *                             reviewer. Use this to inspect what would be sent
 *   -h, --help                this message
 *
 * Exit codes:
 *   0  reviewed with nothing blocking, OR nothing could be invoked
 *      (status "not-configured" — advisory, not a failure)
 *   1  at least one blocking finding
 *   2  the harness could not run (bad args, broken diff, a configured
 *      reviewer command that itself failed)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { loadRequirementFiles, flatten, DEFAULT_PATTERNS } = require('./lib/requirements');

const EXIT_CLEAN = 0;
const EXIT_BLOCKING = 1;
const EXIT_HARNESS_ERROR = 2;

const REQUIREMENT_ID = /\bREQ-[A-Z]{3,8}-\d{3}\b/g;
const SEVERITIES = ['blocking', 'major', 'minor', 'observation'];

/**
 * The only requirement fields the reviewer sees.
 *
 * These say WHAT MUST BE TRUE. Deliberately excluded: `source` (provenance),
 * `history` (superseded text), `verified_by` (which tests claim to cover it —
 * that is the author's assertion, and the reviewer must not take it on trust)
 * and `depends_on` (points at requirements that were not selected).
 */
const REVIEWABLE_FIELDS = ['id', 'version', 'status', 'priority', 'title', 'rationale', 'acceptance', 'ambiguities'];

class HarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HarnessError';
  }
}

// --------------------------------------------------------------------------
// 1. The diff
// --------------------------------------------------------------------------

/**
 * Paths withheld from the reviewed diff.
 *
 * Withholding the plan from the PROMPT is not enough. A branch routinely commits
 * its own plan and session notes, and those files then arrive inside the diff
 * itself — through the front door, as legitimate content. A reviewer handed that
 * diff has read the plan, and the isolation is worth nothing.
 *
 * These paths hold process records and author reasoning, never product code.
 * Everything excluded is reported, because silently dropping a file from a
 * review is its own failure.
 */
const DEFAULT_EXCLUDES = [
  '.brain',
  '.claude',
  '**/PLAN.md',
  '**/IMPLEMENTATION-PLAN.md',
  '**/*.session.md',
];

/** A git pathspec that excludes `pattern`, using glob magic only when needed. */
const toExcludePathspec = (pattern) =>
  pattern.includes('*') ? `:(exclude,glob)${pattern}` : `:(exclude)${pattern}`;

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * The diff between two refs, via git, with process records withheld.
 *
 * `base...head` diffs from the merge base, which is what a pull request shows.
 * `--no-color` and `--no-ext-diff` keep the output stable regardless of local
 * git configuration.
 *
 * Note what this does NOT collect: no `git log`, no commit messages, no author,
 * no branch name. Only the change itself, minus the excluded paths.
 *
 * @returns {{diff: string, included: string[], excluded: string[]}}
 */
function collectDiff(base, head, repo, excludes = DEFAULT_EXCLUDES) {
  const range = `${base}...${head}`;
  const pathspec = ['--', '.', ...excludes.map(toExcludePathspec)];

  try {
    const all = git(repo, ['diff', '--name-only', range]).split('\n').filter(Boolean);
    const included = git(repo, ['diff', '--name-only', range, ...pathspec]).split('\n').filter(Boolean);
    const diff = git(repo, ['diff', '--no-color', '--no-ext-diff', range, ...pathspec]);

    return {
      diff,
      included,
      excluded: all.filter((file) => !included.includes(file)).sort(),
    };
  } catch (err) {
    const detail = (err.stderr || err.message || '').toString().trim();
    throw new HarnessError(`could not produce a diff for ${range}: ${detail}`);
  }
}

// --------------------------------------------------------------------------
// 2. Requirement selection
// --------------------------------------------------------------------------

/**
 * Every requirement id mentioned in a body of text, de-duplicated.
 *
 * This is the ONLY thing taken from a pull request description. The prose around
 * the ids — which is where an implementation plan lives — is discarded here and
 * never travels any further.
 */
function extractRequirementIds(text) {
  return [...new Set(String(text ?? '').match(REQUIREMENT_ID) ?? [])].sort();
}

/** Load exactly the requested requirements, and fail loudly on any that are missing. */
function selectRequirements(ids, patterns, cwd) {
  const { documents } = loadRequirementFiles(patterns, cwd);

  const parseErrors = documents.filter((d) => d.error);
  if (parseErrors.length > 0) {
    throw new HarnessError(
      `requirement files could not be read:\n  ${parseErrors.map((d) => `${d.file}: ${d.error}`).join('\n  ')}`,
    );
  }

  const byId = new Map();
  for (const { requirement } of flatten(documents)) {
    if (requirement && typeof requirement.id === 'string' && !byId.has(requirement.id)) {
      byId.set(requirement.id, requirement);
    }
  }

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new HarnessError(
      `the change claims to cover requirement(s) that do not exist: ${missing.join(', ')}. ` +
        'Either the id is wrong or the requirement was never written.',
    );
  }

  return ids.map((id) => byId.get(id));
}

// --------------------------------------------------------------------------
// 3. The prompt
// --------------------------------------------------------------------------

/** One requirement, rendered as text, carrying only the reviewable fields. */
function renderRequirement(requirement) {
  const lines = [];
  lines.push(`### ${requirement.id}@v${requirement.version} — ${requirement.title}`);
  lines.push('');
  lines.push(`- status: ${requirement.status}`);
  lines.push(`- priority: ${requirement.priority}`);

  if (requirement.rationale) {
    lines.push('');
    lines.push(`Rationale: ${String(requirement.rationale).trim()}`);
  }

  lines.push('');
  lines.push('Acceptance criteria:');
  (requirement.acceptance ?? []).forEach((criterion, index) => {
    lines.push(`  ${index + 1}. GIVEN ${criterion.given}`);
    lines.push(`     WHEN  ${criterion.when}`);
    lines.push(`     THEN  ${criterion.then}`);
  });

  const ambiguities = requirement.ambiguities ?? [];
  if (ambiguities.length > 0) {
    lines.push('');
    lines.push('Open ambiguities (unresolved questions on this requirement):');
    for (const ambiguity of ambiguities) lines.push(`  - ${ambiguity}`);
  }

  return lines.join('\n');
}

/**
 * Build the reviewer's ENTIRE input.
 *
 * This function takes two arguments and closes over nothing. That is the
 * isolation guarantee: there is no parameter through which a plan, a commit
 * message, a branch name or a transcript could arrive, so no future edit can
 * quietly admit one. Adding a third argument here is a change to the security
 * property of this toolkit, not a refactor.
 */
function buildPrompt({ diff, requirements }) {
  const bodies = requirements.map((requirement) =>
    Object.fromEntries(Object.entries(requirement).filter(([key]) => REVIEWABLE_FIELDS.includes(key))),
  );

  return [
    'Review the following diff against the requirements it claims to satisfy.',
    '',
    'You have been given exactly two things: the requirement texts, and the diff.',
    'You have NOT been given the implementation plan, the commit messages, the',
    'branch name, or any record of the author\'s reasoning. They were withheld',
    'deliberately. Do not speculate about intent — assess only what the code does',
    'against what the requirements say.',
    '',
    '## Requirements',
    '',
    bodies.map(renderRequirement).join('\n\n'),
    '',
    '## Diff',
    '',
    '```diff',
    diff.trimEnd(),
    '```',
    '',
    '## Output',
    '',
    'Return a JSON object: {"findings": [...]}. Each finding must have:',
    '  severity     one of: blocking | major | minor | observation',
    '  requirement  the REQ id it concerns',
    '  criterion    the 1-based criterion number, or null',
    '  file         path from the diff',
    '  line         line number',
    '  message      what the criterion requires, and what the code actually does',
    '',
    'A finding without file and line is not a finding. Return an empty findings',
    'array if nothing is wrong; do not manufacture findings to appear diligent.',
  ].join('\n');
}

// --------------------------------------------------------------------------
// 4. Invocation
// --------------------------------------------------------------------------

/** The default headless invocation (PF-004), used only when nothing is configured. */
const DEFAULT_REVIEWER_COMMAND = 'claude -p';

/**
 * Whether `bin` resolves on PATH. Cheap and side-effect-free: this only asks
 * the shell where a binary lives, it never runs it and never spends a token.
 */
function findOnPath(bin) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(finder, [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Which command review() should invoke, or null if nothing resolves.
 *
 * `explicit` is whatever --invoker or $ITM_SDLC_REVIEWER_CMD supplied:
 *   a non-empty string  -> that command wins outright, unconditionally
 *   the empty string    -> explicitly disabled; the default is never probed
 *   null / undefined    -> nothing was configured; try the default
 *
 * The empty-string case matters: it is how a caller says "no reviewer, and
 * don't go looking for one" without depending on whatever happens to be on
 * this machine's PATH — the golden set and this file's own tests rely on it
 * to stay deterministic regardless of what is installed where they run.
 *
 * `probe` is injectable so callers (tests, mainly) can force either branch
 * without touching the real filesystem or PATH.
 */
function resolveInvoker(explicit, { probe = findOnPath } = {}) {
  if (explicit) return explicit;
  if (explicit === '') return null;
  return probe('claude') ? DEFAULT_REVIEWER_COMMAND : null;
}

/**
 * Which link in the chain supplied the command — for the CI summary, so a
 * `not-configured` result is diagnosable without anyone guessing which of the
 * four possibilities happened.
 *
 * **Returns the name of the link, never the command.** An invoker string can
 * carry an API key, and a job summary is as readable as the build log.
 *
 * @returns {'invoker'|'env'|'default-claude'|'disabled'|'not-configured'}
 */
function resolverName({ explicit, source, command }) {
  if (command && explicit) return source === 'flag' ? 'invoker' : 'env';
  if (command) return 'default-claude';
  if (explicit === '') return 'disabled';
  return 'not-configured';
}

/**
 * Run the reviewer.
 *
 * The command is supplied rather than hardcoded: how a named agent is invoked
 * non-interactively depends on the Claude Code version installed, and guessing a
 * CLI contract here would fail silently in a way that looks like a clean review.
 * Configure it with --invoker or $ITM_SDLC_REVIEWER_CMD, or rely on the default
 * resolved by resolveInvoker() above.
 */
function defaultInvoker(prompt, { command }) {
  if (!command) {
    throw new HarnessError(
      'no reviewer command configured.\n' +
        '  Set --invoker "<command>" or $ITM_SDLC_REVIEWER_CMD.\n' +
        '  The command receives the prompt on stdin and must return {"findings": [...]} on stdout.\n' +
        '  Use --prompt-only to inspect the constructed prompt without running a reviewer.',
    );
  }

  const result = spawnSync(command, {
    input: prompt,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) throw new HarnessError(`reviewer command failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new HarnessError(`reviewer command exited ${result.status}: ${(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

/** Parse and sanity-check whatever the reviewer returned. */
function parseFindings(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new HarnessError('the reviewer returned nothing. A review that produced no output is not a pass.');

  // Tolerate a fenced block around the JSON; reject anything else.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1].trim() : text;

  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new HarnessError(`the reviewer did not return usable JSON (${err.message}).`);
  }

  const findings = Array.isArray(parsed) ? parsed : parsed.findings;
  if (!Array.isArray(findings)) {
    throw new HarnessError('the reviewer returned JSON with no `findings` array.');
  }

  const malformed = [];
  const normalised = findings.map((finding, index) => {
    const severity = String(finding.severity ?? '').toLowerCase();
    if (!SEVERITIES.includes(severity)) malformed.push(`finding ${index}: unknown severity ${JSON.stringify(finding.severity)}`);
    if (!finding.file || finding.line === undefined || finding.line === null) {
      malformed.push(`finding ${index}: no file:line — the reviewer's own rules make this not a finding`);
    }
    return { ...finding, severity };
  });

  return { findings: normalised, malformed };
}

// --------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------

function review(options, invoke = defaultInvoker, probe = findOnPath) {
  const repo = path.resolve(options.repo);

  let ids = options.requirements;
  if (ids === null) {
    if (!options.prDescription) {
      throw new HarnessError('supply --requirements or --pr-description so the reviewer knows what to check against.');
    }
    if (!fs.existsSync(options.prDescription)) {
      throw new HarnessError(`pull request description not found: ${options.prDescription}`);
    }
    ids = extractRequirementIds(fs.readFileSync(options.prDescription, 'utf8'));
  }

  if (ids.length === 0) {
    throw new HarnessError(
      'no requirement ids found. A change under review must declare what it covers ' +
        '(Covers: REQ-...), or be labelled as chore.',
    );
  }

  const requirements = selectRequirements(ids, options.requirementsGlob, repo);
  const { diff, excluded } = collectDiff(options.base, options.head, repo, options.excludes);

  if (diff.trim() === '') {
    throw new HarnessError(
      `${options.base}...${options.head} produced an empty diff. There is nothing to review.` +
        (excluded.length > 0 ? ` (${excluded.length} path(s) were withheld as process records.)` : ''),
    );
  }

  // Everything above this line may touch descriptions, refs and file paths.
  // Below it, only these two values travel onward.
  const prompt = buildPrompt({ diff, requirements });

  if (options.promptOnly) return { prompt, requirements, excluded, findings: null, malformed: [], status: null, resolver: 'prompt-only' };

  const command = resolveInvoker(options.invoker, { probe });
  const resolver = resolverName({ explicit: options.invoker, source: options.invokerSource, command });

  if (!command) {
    // Advisory gate, nothing to invoke: this is a gap to report, not a
    // failure, and it must never manufacture a finding to fill the silence.
    return { prompt, requirements, excluded, findings: [], malformed: [], status: 'not-configured', resolver };
  }

  const { findings, malformed } = parseFindings(invoke(prompt, { command }));
  return { prompt, requirements, excluded, findings, malformed, status: 'reviewed', resolver };
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    base: null,
    head: 'HEAD',
    repo: process.cwd(),
    requirements: null,
    prDescription: null,
    requirementsGlob: [...DEFAULT_PATTERNS],
    out: 'review-findings.json',
    invoker: process.env.ITM_SDLC_REVIEWER_CMD ?? null,
    invokerSource: process.env.ITM_SDLC_REVIEWER_CMD === undefined ? null : 'env',
    excludes: [...DEFAULT_EXCLUDES],
    promptOnly: false,
    help: false,
  };

  const takesValue = {
    '--base': 'base',
    '--head': 'head',
    '--repo': 'repo',
    '--pr-description': 'prDescription',
    '--out': 'out',
    '--invoker': 'invoker',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--prompt-only') { options.promptOnly = true; continue; }
    if (arg === '-h' || arg === '--help') { options.help = true; continue; }

    if (arg === '--requirements') {
      i += 1;
      if (argv[i] === undefined) throw new Error('--requirements requires a comma-separated list');
      options.requirements = extractRequirementIds(argv[i]);
      if (options.requirements.length === 0) throw new Error(`--requirements contained no valid REQ ids: ${argv[i]}`);
      continue;
    }

    if (arg === '--exclude') {
      i += 1;
      if (argv[i] === undefined) throw new Error('--exclude requires a path or glob');
      options.excludes.push(argv[i]);
      continue;
    }

    if (arg === '--requirements-glob') {
      i += 1;
      if (argv[i] === undefined) throw new Error('--requirements-glob requires a glob');
      options.requirementsGlob = [argv[i]];
      continue;
    }

    if (takesValue[arg]) {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} requires a value`);
      options[takesValue[arg]] = argv[i];
      // Remember that the flag won, not the environment. Only the NAME of the
      // winning link is ever reported; the command itself can carry a key.
      if (arg === '--invoker') options.invokerSource = 'flag';
      continue;
    }

    throw new Error(`unknown option: ${arg}`);
  }

  if (!options.help && !options.base) throw new Error('--base is required');
  return options;
}

const USAGE = `
Usage: node scripts/review-change.js --base <ref> [options]

  Builds the adversarial reviewer's entire input from exactly two things: the
  diff, and the requirements the change claims to satisfy. The implementation
  plan, commit messages, branch name and session transcript are never included.

Options:
  --base <ref>             base ref (required)
  --head <ref>             head ref (default: HEAD)
  --repo <path>            repository to diff (default: current directory)
  --requirements <ids>     comma-separated REQ ids
  --pr-description <file>  file to scan for REQ ids; its prose is discarded
  --requirements-glob <g>  default: ${DEFAULT_PATTERNS[0]}
  --out <file>             default: review-findings.json
  --invoker <command>      runs the reviewer; prompt on stdin, JSON on stdout.
                           Falls back to $ITM_SDLC_REVIEWER_CMD (an override,
                           not the only path), then to a default headless
                           'claude -p' invocation when that binary is on PATH.
                           Neither resolving records status "not-configured"
                           and exits 0 rather than inventing a finding.
  --exclude <path|glob>    additional path withheld from the diff (repeatable)
  --prompt-only            print the prompt and exit, running no reviewer
  -h, --help               show this message

Exit codes: 0 nothing blocking (or not-configured), 1 blocking finding(s), 2 the harness failed.
`;

function report(result, options) {
  const out = [];
  out.push('');
  out.push('itm-sdlc | adversarial review');
  out.push('');
  out.push(`  requirements  ${result.requirements.map((r) => `${r.id}@v${r.version}`).join(', ')}`);
  out.push(`  resolver      ${result.resolver}`);

  if (result.status === 'not-configured') {
    out.push('  status        not-configured — no reviewer command available');
    out.push('');
    out.push('  Set --invoker "<command>" or $ITM_SDLC_REVIEWER_CMD to override, or put the');
    out.push('  claude binary on PATH so the default headless invocation can run.');
    out.push('  This is advisory: G7 records the gap and does not block the merge.');
    out.push('');
    process.stdout.write(out.join('\n') + '\n');
    return;
  }

  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const finding of result.findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;

  out.push(`  findings      ${result.findings.length}`);
  if (result.excluded.length > 0) {
    out.push(`  withheld      ${result.excluded.length} process-record path(s), not shown to the reviewer:`);
    for (const file of result.excluded) out.push(`                  ${file}`);
  }
  out.push('');

  for (const severity of SEVERITIES) {
    const group = result.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    out.push(`  ${severity.toUpperCase()} (${group.length})`);
    for (const finding of group) {
      out.push(`      ${finding.requirement ?? '?'}${finding.criterion ? ` criterion ${finding.criterion}` : ''}  ${finding.file}:${finding.line}`);
      out.push(`          ${finding.message ?? ''}`);
    }
    out.push('');
  }

  for (const problem of result.malformed) out.push(`  MALFORMED  ${problem}`);
  if (result.malformed.length > 0) out.push('');

  out.push('  ' + '-'.repeat(66));
  out.push(`  ${SEVERITIES.map((s) => `${counts[s]} ${s}`).join(', ')}`);
  out.push(`  findings written to ${options.out}`);
  out.push(counts.blocking > 0 ? '  FAIL - blocking finding(s) must be resolved or explicitly waived' : '  PASS - nothing blocking');
  out.push('');

  process.stdout.write(out.join('\n') + '\n');
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`review-change: ${err.message}\n${USAGE}`);
    return EXIT_HARNESS_ERROR;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return EXIT_CLEAN;
  }

  let result;
  try {
    result = review(options);
  } catch (err) {
    process.stderr.write(`review-change: ${err instanceof HarnessError ? err.message : err.message}\n`);
    return EXIT_HARNESS_ERROR;
  }

  if (options.promptOnly) {
    process.stdout.write(result.prompt + '\n');
    return EXIT_CLEAN;
  }

  fs.writeFileSync(
    options.out,
    JSON.stringify(
      {
        requirements: result.requirements.map((r) => ({ id: r.id, version: r.version })),
        status: result.status,
        // Which link in the resolution chain won, so a `not-configured` run is
        // diagnosable. The NAME only — an invoker command can carry a key, and
        // this file is uploaded as a CI artefact.
        resolver: result.resolver,
        findings: result.findings,
        malformed: result.malformed,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  report(result, options);

  if (result.status === 'not-configured') return EXIT_CLEAN;
  return result.findings.some((f) => f.severity === 'blocking') ? EXIT_BLOCKING : EXIT_CLEAN;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  HarnessError,
  REVIEWABLE_FIELDS,
  DEFAULT_EXCLUDES,
  DEFAULT_REVIEWER_COMMAND,
  collectDiff,
  extractRequirementIds,
  selectRequirements,
  renderRequirement,
  buildPrompt,
  findOnPath,
  resolveInvoker,
  resolverName,
  parseFindings,
  review,
  parseArgs,
  main,
};
