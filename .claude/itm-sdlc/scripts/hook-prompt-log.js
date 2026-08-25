#!/usr/bin/env node
"use strict";

/**
 * Hook 2 — save the prompt that changed the project.
 *
 * capture  (beforeSubmitPrompt) — remember the last user prompt
 * record   (afterFileEdit)      — append it if a project file changed
 *
 * Skips: /tdd (that skill already owns the slice), and the format hook's
 * second write. Does not write .brain/ — this is a working log.
 *
 * Usage:
 *   node hook-prompt-log.js capture
 *   node hook-prompt-log.js record
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  readStdinJson,
  fileFromPayload,
  promptFromPayload,
  isTddPrompt,
  projectPaths,
  ensureDir,
  writeJson,
  readJson,
} = require("./lib/hooks");

function lastPromptFile(projectRoot) {
  return path.join(projectPaths(projectRoot).stateDir, "last-prompt.json");
}

function capture(raw, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const prompt = promptFromPayload(readStdinJson(raw));
  writeJson(lastPromptFile(projectRoot), {
    prompt,
    skip: isTddPrompt(prompt),
    at: Date.now(),
  });
  return { captured: Boolean(prompt), skip: isTddPrompt(prompt) };
}

function sameFile(projectRoot, a, b) {
  if (!a || !b) return false;
  return path.resolve(projectRoot, a) === path.resolve(projectRoot, b);
}

function shouldSkip(projectRoot, file) {
  const last = readJson(lastPromptFile(projectRoot));
  if (!last) return "no-prompt";
  if (last.skip) return "tdd";
  if (!last.prompt) return "empty-prompt";

  const stamp = readJson(
    path.join(projectPaths(projectRoot).stateDir, "format-stamp.json"),
  );
  if (
    stamp &&
    sameFile(projectRoot, stamp.file, file) &&
    Date.now() - stamp.at < 4000
  )
    return "format";

  return null;
}

function record(raw, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const file = fileFromPayload(readStdinJson(raw));
  if (!file) return { skipped: "no-file" };

  const relative = path
    .relative(projectRoot, path.resolve(projectRoot, file))
    .split(path.sep)
    .join("/");
  if (
    relative.startsWith(".claude/itm-sdlc/") ||
    relative.startsWith(".claude/reports/") ||
    relative.startsWith(".cursor/hook-state/")
  ) {
    return { skipped: "toolkit" };
  }

  const reason = shouldSkip(projectRoot, file);
  if (reason) return { skipped: reason };

  const last = readJson(lastPromptFile(projectRoot));
  const paths = projectPaths(projectRoot);
  ensureDir(path.dirname(paths.logFile));

  const header = fs.existsSync(paths.logFile)
    ? ""
    : "# Prompt changes\n\nPrompts that changed project files. Not /tdd. Not format.\n\n";

  const stamp = new Date().toISOString();
  const block = `${header}## ${stamp}\n\nPrompt: ${last.prompt}\n\nFiles:\n- ${relative}\n\n`;
  fs.appendFileSync(paths.logFile, block);
  return { logged: relative };
}

function run(mode, raw, options = {}) {
  if (mode === "capture") return capture(raw, options);
  if (mode === "record") return record(raw, options);
  throw new Error(`unknown mode: ${mode}`);
}

if (require.main === module) {
  const mode = process.argv[2];
  const raw = fs.readFileSync(0, "utf8");
  run(mode, raw);
}

module.exports = { run, capture, record };
