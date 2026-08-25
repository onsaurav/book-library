#!/usr/bin/env node
"use strict";

/**
 * Hook 3 — write the requirement dashboard when a session ends.
 *
 * Not after every edit. npm ci runs only if the vendored toolkit has no
 * node_modules. Fail open.
 *
 * Usage: node hook-report.js   (sessionEnd)
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { globSync } = require("glob");

function toolkitHome(projectRoot) {
  const vendored = path.join(projectRoot, ".claude", "itm-sdlc");
  if (fs.existsSync(path.join(vendored, "scripts", "client-report.js")))
    return vendored;
  const local = path.resolve(__dirname, "..");
  if (fs.existsSync(path.join(local, "scripts", "client-report.js")))
    return local;
  return null;
}

function hasRequirements(projectRoot) {
  return (
    globSync(".brain/requirements/*.{yaml,yml}", {
      cwd: projectRoot,
      nodir: true,
      windowsPathsNoEscape: true,
    }).length > 0
  );
}

function ensureDeps(home) {
  if (fs.existsSync(path.join(home, "node_modules", "js-yaml"))) return false;
  execSync("npm ci --omit=dev --no-audit --no-fund", {
    cwd: home,
    stdio: "ignore",
  });
  return true;
}

function run(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  if (!hasRequirements(projectRoot)) return { skipped: "no-requirements" };

  const home = toolkitHome(projectRoot);
  if (!home) return { skipped: "no-toolkit" };

  try {
    ensureDeps(home);
  } catch {
    return { skipped: "deps" };
  }

  const report = require(path.join(home, "scripts", "client-report.js"));
  const data = report.computeReport({
    project: projectRoot,
    requirements: [".brain/requirements/*.yaml", ".brain/requirements/*.yml"],
  });

  const outDir = path.join(projectRoot, ".claude", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const title = `${path.basename(projectRoot)} — requirement status`;
  const md = path.join(outDir, "requirement-status.md");
  const html = path.join(outDir, "requirement-status.html");
  fs.writeFileSync(md, report.renderMarkdown(data, { title }));
  fs.writeFileSync(html, report.renderHtml(data, { title }));
  try {
    const dashboard = require(path.join(home, "scripts", "dashboard.js"));
    dashboard.writeDashboard(projectRoot, path.join(outDir, "dashboard.html"));
  } catch {
    // older vendored toolkit without dashboard.js
  }
  return { wrote: html, total: data.summary.total };
}

if (require.main === module) {
  run();
}

module.exports = { run, hasRequirements, toolkitHome };
