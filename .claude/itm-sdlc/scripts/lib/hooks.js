'use strict';

/**
 * Shared helpers for the two shipped hooks: format, and prompt-change log.
 * No script here hardcodes an extension; adapters own those.
 */

const fs = require('node:fs');
const path = require('node:path');

const TDD_PROMPT = /^\s*\/tdd(?:\s|$)/i;

function readStdinJson(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function fileFromPayload(payload) {
  const value =
    payload.file_path ||
    payload.filePath ||
    payload.path ||
    payload.file ||
    payload.uri ||
    '';
  return String(value).replace(/^file:\/\//, '');
}

function promptFromPayload(payload) {
  return String(payload.prompt || payload.prompt_text || payload.text || '').trim();
}

function extensionsOf(adapter) {
  const found = [];
  for (const glob of adapter.sourceGlobs ?? []) {
    const match = /\*\.([A-Za-z0-9]+)$/.exec(glob);
    if (match) found.push(`.${match[1].toLowerCase()}`);
  }
  return found;
}

function adapterForFile(file, adapters) {
  const ext = path.extname(file).toLowerCase();
  if (!ext) return null;
  return adapters.find((adapter) => extensionsOf(adapter).includes(ext)) ?? null;
}

function formatCommand(file, adapter) {
  const template = adapter?.commands?.format;
  if (!template || !template.includes('{file}')) return null;
  return template.replaceAll('{file}', `"${file.replaceAll('"', '\\"')}"`);
}

function isTddPrompt(prompt) {
  return TDD_PROMPT.test(prompt);
}

function projectPaths(projectRoot) {
  const root = path.resolve(projectRoot);
  const vendored = path.join(root, '.claude', 'itm-sdlc');
  const useVendored = fs.existsSync(vendored);
  return {
    root,
    stateDir: useVendored
      ? path.join(vendored, '.hook-state')
      : path.join(root, '.cursor', 'hook-state'),
    logFile: useVendored
      ? path.join(root, '.claude', 'prompt-changes.md')
      : path.join(root, '.cursor', 'prompt-changes.md'),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  TDD_PROMPT,
  readStdinJson,
  fileFromPayload,
  promptFromPayload,
  extensionsOf,
  adapterForFile,
  formatCommand,
  isTddPrompt,
  projectPaths,
  ensureDir,
  writeJson,
  readJson,
};
