#!/usr/bin/env node
'use strict';

/**
 * Hook 1 — format the file that was just edited.
 *
 * C# → dotnet format, JS/TS → prettier, Python → ruff.
 * The command comes from the adapter. Missing tools fail open.
 *
 * Usage: node hook-format.js   (JSON on stdin from afterFileEdit)
 */

const { execSync } = require('node:child_process');
const path = require('node:path');

const {
  readStdinJson,
  fileFromPayload,
  adapterForFile,
  formatCommand,
  projectPaths,
  writeJson,
} = require('./lib/hooks');

function loadAdaptersSafe(projectRoot) {
  const vendored = path.join(projectRoot, '.claude', 'itm-sdlc', 'scripts', 'lib', 'adapters.js');
  const local = path.join(__dirname, 'lib', 'adapters.js');
  const file = require('node:fs').existsSync(vendored) ? vendored : local;
  try {
    return require(file).loadAdapters();
  } catch {
    return [];
  }
}

function run(raw, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const payload = readStdinJson(raw);
  const file = fileFromPayload(payload);
  if (!file) return { skipped: 'no-file' };

  const adapters = options.adapters ?? loadAdaptersSafe(projectRoot);
  const adapter = adapterForFile(file, adapters);
  const command = formatCommand(file, adapter);
  if (!command) return { skipped: 'no-formatter' };

  const paths = projectPaths(projectRoot);
  writeJson(path.join(paths.stateDir, 'format-stamp.json'), { file, at: Date.now() });

  if (options.dryRun) return { command, adapter: adapter.id };

  try {
    execSync(command, { cwd: projectRoot, stdio: 'ignore' });
  } catch {
    // fail open — a missing prettier must not block the edit
  }
  return { formatted: file, adapter: adapter.id };
}

if (require.main === module) {
  const raw = require('node:fs').readFileSync(0, 'utf8');
  run(raw, { dryRun: process.env.ITM_SDLC_HOOK_DRY === '1' });
}

module.exports = { run };
