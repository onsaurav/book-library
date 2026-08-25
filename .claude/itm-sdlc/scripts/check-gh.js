#!/usr/bin/env node
'use strict';

/**
 * check-gh.js
 *
 * Reports whether the GitHub CLI (`gh`) is on PATH.
 *
 * PF-002: without it, skills/checkpoint/SKILL.md cannot open the brain
 * checkpoint pull request itself and must fall back to pushing the branch and
 * printing instructions for a human to open it. `install --check` cites this
 * too, so the gap is visible before a project ever reaches a checkpoint.
 *
 * Usage:
 *   node scripts/check-gh.js [options]
 *
 * Options:
 *   --json       machine-readable output
 *   -h, --help   this message
 *
 * Exit codes:
 *   0  gh is on PATH
 *   1  gh is not on PATH
 */

const { execFileSync } = require('node:child_process');

/**
 * Whether `bin` resolves on PATH. Cheap and side-effect-free: this only asks
 * the shell where a binary lives, it never runs it.
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
 * `probe` is injectable so callers (tests, mainly) can force either outcome
 * without depending on whether `gh` happens to be installed wherever this
 * runs.
 */
function checkGh({ probe = findOnPath } = {}) {
  const available = probe('gh');
  return {
    ok: available,
    available,
    reason: available
      ? null
      : 'gh is not on PATH. The brain checkpoint pull request must be opened by hand (PF-002).',
  };
}

const USAGE = `
Usage: node scripts/check-gh.js [options]

  Reports whether the GitHub CLI (gh) is on PATH.

Options:
  --json       machine-readable output
  -h, --help   show this message

Exit codes: 0 gh is available, 1 gh is missing.
`;

function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE);
    return 0;
  }

  const result = checkGh();

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(result.ok ? 'gh is available\n' : `gh is not available: ${result.reason}\n`);
  }

  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { checkGh, findOnPath, main };
