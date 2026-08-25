#!/usr/bin/env node
"use strict";

/**
 * Keep the dashboard snapshot current after a real project edit.
 *
 * Writes .claude/reports/dashboard.html and dashboard.json from the files
 * already in the project. Skips format rewrites and anything under reports/
 * so this hook cannot loop. Fail open.
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  readStdinJson,
  fileFromPayload,
  projectPaths,
  readJson,
} = require("./lib/hooks");
const { hasRequirements } = require("./hook-report");

function isIgnored(projectRoot, file) {
  const relative = path
    .relative(projectRoot, path.resolve(projectRoot, file))
    .split(path.sep)
    .join("/");
  if (relative.startsWith(".claude/reports/")) return "reports";
  if (relative.startsWith(".claude/itm-sdlc/")) return "toolkit";
  if (relative.startsWith(".cursor/hook-state/")) return "toolkit";
  const stamp = readJson(
    path.join(projectPaths(projectRoot).stateDir, "format-stamp.json"),
  );
  if (
    stamp &&
    path.resolve(projectRoot, stamp.file) === path.resolve(projectRoot, file) &&
    Date.now() - stamp.at < 4000
  ) {
    return "format";
  }
  return null;
}

function run(raw, options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  if (!hasRequirements(projectRoot)) return { skipped: "no-requirements" };

  const file = fileFromPayload(readStdinJson(raw));
  if (file) {
    const reason = isIgnored(projectRoot, file);
    if (reason) return { skipped: reason };
  }

  try {
    const { writeDashboard } = require("./dashboard");
    const result = writeDashboard(projectRoot);
    return { wrote: result.dest, json: result.jsonDest };
  } catch {
    return { skipped: "error" };
  }
}

if (require.main === module) {
  run(fs.readFileSync(0, "utf8"));
}

module.exports = { run, isIgnored };
