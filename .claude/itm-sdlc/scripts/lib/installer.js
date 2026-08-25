"use strict";

/**
 * Installer core.
 *
 * The whole design turns on one asymmetry:
 *
 *   .claude/ and .github/workflows/  are SHIPPED CONTENT. They are overwritten on
 *                                    every update, because that is how a project
 *                                    receives toolkit improvements.
 *
 *   .brain/ and CLAUDE.md            are THE PROJECT'S OWN. They are seeded once
 *                                    and never touched again. Overwriting a
 *                                    client's record with a template would
 *                                    destroy the only copy of it.
 *
 * Every file the installer writes is recorded in .brain/install-state.json with
 * a sha256, so a later run can report what drifted.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { checkGh } = require("../check-gh");

/**
 * Every shipped adapter, for the generated .gitignore.
 *
 * Loaded through the validating loader when the toolkit's dependencies are
 * present, and by plain JSON.parse when they are not. That fallback is what
 * lets `node install.js` run straight after `git clone`, with no `npm install`
 * first — installing into a project should not require a build step in the
 * tool doing the installing.
 *
 * The adapters are shipped by us and validated by the test suite and by CI, so
 * skipping schema validation here loses nothing at install time.
 */
function loadShippedAdapters(toolkitRoot) {
  const dir = path.join(toolkitRoot, "adapters");

  try {
    return require("./adapters").loadAdapters({
      dir,
      schemaPath: path.join(toolkitRoot, "schema", "adapter.schema.json"),
    });
  } catch (err) {
    if (err?.code !== "MODULE_NOT_FOUND") throw err;
  }

  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

const STATE_FILE = path.join(".brain", "install-state.json");
const STATE_VERSION = 1;

/**
 * Files under a `managed` root are replaced on update; a drifted managed file is
 * about to lose its local edits and must be reported. Files under a `seeded`
 * root are written once and then belong to the project; drift there is expected
 * and is not a finding.
 */
const PAYLOAD = [
  { source: "agents", destination: ".claude/agents", policy: "managed" },
  {
    source: "skills",
    destination: ".claude/skills",
    policy: "managed",
    filter: skillAllowedForProfile,
  },
  { source: "rules", destination: ".claude/rules", policy: "managed" },
  { source: "workflows", destination: ".github/workflows", policy: "managed" },
  {
    source: "templates/brain-scaffold",
    destination: ".brain",
    policy: "seeded",
    onceOnly: true,
  },

  // The toolkit itself, vendored so the CI gates can run inside the project.
  // Without this every job in gates.yml fails its preflight, and the checks can
  // only ever be run by hand from a clone of this repository (PF-001).
  {
    source: "scripts",
    destination: ".claude/itm-sdlc/scripts",
    policy: "managed",
  },
  {
    source: "adapters",
    destination: ".claude/itm-sdlc/adapters",
    policy: "managed",
  },
  {
    source: "schema",
    destination: ".claude/itm-sdlc/schema",
    policy: "managed",
  },
];

const SINGLE_FILES = [
  {
    source: "templates/CLAUDE.md.template",
    destination: "CLAUDE.md",
    policy: "seeded",
    onceOnly: true,
  },
  {
    source: "templates/cursor-hooks.json",
    destination: ".cursor/hooks.json",
    policy: "managed",
  },
  {
    source: "templates/prompt-changes.md",
    destination: ".claude/prompt-changes.md",
    policy: "seeded",
    onceOnly: true,
  },

  // Generated rather than copied, so the language sections come from the
  // adapters instead of being hardcoded here.
  {
    generate: "gitignore",
    destination: ".gitignore",
    policy: "seeded",
    onceOnly: true,
  },

  // Somewhere for the project to be built. Git cannot track an empty directory,
  // so the marker is what actually creates it. Skipped entirely once `src/`
  // exists, rather than dropping a marker beside real code.
  {
    generate: "gitkeep",
    destination: "src/.gitkeep",
    policy: "seeded",
    onceOnly: true,
    skipIfExists: "src",
  },

  // Both are needed: `npm ci` refuses to run without a lockfile, and gates.yml
  // uses `npm ci` deliberately so a gate run installs exactly what was tested.
  {
    source: "package.json",
    destination: ".claude/itm-sdlc/package.json",
    policy: "managed",
  },
  {
    source: "package-lock.json",
    destination: ".claude/itm-sdlc/package-lock.json",
    policy: "managed",
  },
];

const MODULE_PATTERN = /^[A-Z]{3,8}$/;

// --------------------------------------------------------------------------
// Profile — capability, not the frozen id namespace (--modules stays that)
//
// Each skill belongs to the lowest tier it ships at; a project on a higher
// profile gets every skill at or below its tier. Ranked so "lower" and
// "raise" are simple index comparisons.
// --------------------------------------------------------------------------

const PROFILE_ORDER = ["spine", "delivery", "os"];
const DEFAULT_PROFILE = "delivery";

/**
 * Which profile tier each shipped skill belongs to.
 *
 * spine    — the requirement spine itself, and the process mechanics no
 *            profile can do without: decompose it, agree it, plan it,
 *            verify it, open the pull request, checkpoint the brain.
 * delivery — scope and feedback management on top of that: change control,
 *            variation triage, impact analysis, decisions.
 * os       — OPT-IN additions, not required for delivery: build-day
 *            pairing, governance metrics, the client-facing report, derived
 *            regression scope, and the brain-rot sweep.
 *
 * A skill not listed here defaults to 'spine' — ships everywhere — rather
 * than silently vanishing from every profile because someone forgot to add
 * a line here when they added the skill.
 */
const SKILL_PROFILE = {
  decompose: "spine",
  "resolve-ambiguities": "spine",
  "feature-plan": "spine",
  verifyReq: "spine",
  "pr-prepare": "spine",
  checkpoint: "spine",

  "change-record": "delivery",
  "feedback-capture": "delivery",
  "find-variation": "delivery",
  "impact-analysis": "delivery",
  "adr-write": "delivery",

  tdd: "os",
  fix: "os",
  metrics: "os",
  "client-report": "os",
  dashboard: "os",
  "regression-select": "os",
  librarian: "os",
};

/** Whether one skill file (its PAYLOAD-relative path, e.g. `tdd/SKILL.md`) ships at `profile`. */
function skillAllowedForProfile(relative, profile) {
  const skillName = toPosix(relative).split("/")[0];
  const tier = SKILL_PROFILE[skillName] ?? "spine";
  return PROFILE_ORDER.indexOf(tier) <= PROFILE_ORDER.indexOf(profile);
}

/**
 * Resolve the profile for this run, applying the same freeze-unless-forced
 * shape as `resolveModules` — except profile may RISE freely. Only lowering
 * it needs `--force-profile`, because raising only ever adds skills, while
 * lowering removes ones a project may already depend on.
 *
 * @returns {{profile: string, warning: string|null}}
 */
function resolveProfile(requested, previous, forceProfile) {
  if (requested !== null && !PROFILE_ORDER.includes(requested)) {
    throw new InstallError(
      `invalid profile: ${requested}. Must be one of: ${PROFILE_ORDER.join(", ")}.`,
    );
  }

  if (!previous) {
    return { profile: requested ?? DEFAULT_PROFILE, warning: null };
  }

  const desired = requested ?? previous;
  const previousRank = PROFILE_ORDER.indexOf(previous);
  const desiredRank = PROFILE_ORDER.indexOf(desired);

  if (desiredRank >= previousRank) {
    return { profile: desired, warning: null };
  }

  if (!forceProfile) {
    throw new InstallError(
      `refusing to lower the profile from '${previous}' to '${desired}' without --force-profile.\n` +
        `  Lowering removes skills this project may already depend on — 'requested: ${desired}' is a\n` +
        "  deliberate downgrade, not an install default. Pass --force-profile to proceed.",
    );
  }

  return {
    profile: desired,
    warning:
      `profile lowered from '${previous}' to '${desired}' via --force-profile. ` +
      `Skills above '${desired}' are removed from .claude/skills/ on this run.`,
  };
}

class InstallError extends Error {
  constructor(message) {
    super(message);
    this.name = "InstallError";
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const toPosix = (p) => p.split(path.sep).join("/");

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

/** Every file under `dir`, relative and posix-separated. Empty if absent. */
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      toPosix(
        path.relative(
          dir,
          path.join(entry.parentPath ?? entry.path, entry.name),
        ),
      ),
    )
    .sort();
}

/** Toolkit version and commit, for the state file. */
function toolkitIdentity(toolkitRoot) {
  let version = "unknown";
  try {
    version =
      JSON.parse(
        fs.readFileSync(path.join(toolkitRoot, "package.json"), "utf8"),
      ).version ?? "unknown";
  } catch {
    /* recorded as unknown */
  }

  const fromGit = (args, fallback) => {
    try {
      return (
        execFileSync("git", ["-C", toolkitRoot, ...args], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim() || fallback
      );
    } catch {
      return fallback; // not a git checkout, or git unavailable
    }
  };

  // Where this came from, not just what it was. A project installed from a
  // bootstrap clone has no toolkit directory left to inspect afterwards, so the
  // provenance has to travel in the state file or it is lost.
  return {
    version,
    commit: fromGit(["rev-parse", "HEAD"], "unknown"),
    ref: fromGit(["rev-parse", "--abbrev-ref", "HEAD"], "unknown"),
    remote: fromGit(["remote", "get-url", "origin"], "unknown"),
  };
}

// --------------------------------------------------------------------------
// Generated files
// --------------------------------------------------------------------------

/**
 * Adapter `ignore` is a scan list. Most of it belongs in .gitignore too
 * (bin/, node_modules/, coverage/). One family must never be a git rule:
 * the vendored toolkit. gates.yml runs `.claude/itm-sdlc/scripts/*`.
 * Only its node_modules/ is generated and ignored.
 */
function gitignoreSafeIgnore(pattern) {
  if (!/\.claude\/itm-sdlc/.test(pattern)) return true;
  return /node_modules/.test(pattern);
}

/**
 * A .gitignore for the target project.
 *
 * The language sections are built from every SHIPPED adapter's `ignore` list —
 * not from the adapters detected in the target, because on a fresh install
 * `src/` is empty and nothing would detect. Adding adapters/java.json therefore
 * adds Java's build output here too, with no change to this file.
 *
 * Deliberately absent: `.brain/`. It is the project record and is always
 * committed. Ignoring it is the single most damaging line anyone could add, so
 * the generated file says so where someone editing it will read it.
 */
function generateGitignore(adapters) {
  const lines = [];

  lines.push("# Written once by the itm-sdlc installer, and never rewritten.");
  lines.push(
    "# Safe to edit: re-running the installer will not touch this file.",
  );
  lines.push("");
  lines.push("# DO NOT ADD .brain/");
  lines.push(
    "# It holds the requirements, decisions and constraints this project is built",
  );
  lines.push("# against. It is the record, and it is always committed.");
  lines.push("");
  lines.push("# --- toolkit output ---");
  lines.push(".claude/itm-sdlc/node_modules/");
  lines.push(".claude/itm-sdlc/.hook-state/");
  lines.push(".claude/reports/");
  lines.push("review-findings.json");
  lines.push("traceability.json");
  lines.push("golden-set.json");
  lines.push("gate-findings/");
  lines.push("");
  lines.push("# --- secrets ---");
  lines.push(".env");
  lines.push(".env.*");
  lines.push("!.env.example");
  lines.push("");
  lines.push("# --- editors and operating systems ---");
  lines.push(".idea/");
  lines.push(".vs/");
  lines.push("*.swp");
  lines.push("*~");
  lines.push(".DS_Store");
  lines.push("Thumbs.db");
  lines.push("desktop.ini");

  for (const adapter of adapters) {
    const patterns = (adapter.ignore ?? []).filter(gitignoreSafeIgnore);
    if (patterns.length === 0) continue;
    lines.push("");
    lines.push(`# --- ${adapter.displayName} ---`);
    for (const pattern of patterns) lines.push(pattern);
  }

  lines.push("");
  return lines.join("\n");
}

function generateGitkeep() {
  return [
    "# Keeps src/ in git while it is still empty. Build the project in here.",
    "# Delete this file once there is real code beside it.",
    "",
  ].join("\n");
}

const GENERATORS = {
  gitignore: generateGitignore,
  gitkeep: generateGitkeep,
};

function readState(target) {
  const file = path.join(target, STATE_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new InstallError(
      `${toPosix(STATE_FILE)} exists but is not readable JSON (${err.message}). ` +
        "Delete it to force a clean install, or repair it by hand.",
    );
  }
}

// --------------------------------------------------------------------------
// Module list — frozen at install time (CONVENTIONS.md §1)
// --------------------------------------------------------------------------

function resolveModules(requested, previous) {
  if (requested !== null) {
    const invalid = requested.filter((m) => !MODULE_PATTERN.test(m));
    if (invalid.length > 0) {
      throw new InstallError(
        `invalid module code(s): ${invalid.join(", ")}. ` +
          "A module is 3-8 uppercase letters, no digits or punctuation (CONVENTIONS.md §1).",
      );
    }
  }

  if (previous && requested && previous.join(",") !== requested.join(",")) {
    throw new InstallError(
      `the module list is fixed at install time and cannot be changed here.\n` +
        `  recorded:  ${previous.join(", ") || "(none)"}\n` +
        `  requested: ${requested.join(", ") || "(none)"}\n` +
        "Adding a module is a deliberate change to the project record, not an install flag.",
    );
  }

  return requested ?? previous ?? [];
}

// --------------------------------------------------------------------------
// Planning
// --------------------------------------------------------------------------

/**
 * Refuse targets that cannot possibly be a project.
 *
 * This exists because of one specific accident, which has now happened three
 * times. In Command Prompt, `cd D:\projects\book-library` does **not** switch
 * drive — it silently changes the current directory *on D:* and leaves the
 * shell on C:. The prompt does not change and nothing reports an error, so the
 * next commands run against the home directory instead:
 *
 *     git init -b main          -> a repository wrapping the entire user profile
 *     install.js --target .     -> the toolkit written into ~
 *     git add -A                -> git walking AppData
 *
 * The installer cannot tell a good project directory from a bad one in general,
 * and should not try. But a home directory and a filesystem root are never the
 * answer, and they are exactly where this failure lands. Refusing them turns a
 * silent mess into a message at the first command that could have known.
 *
 * Not configurable. There is no legitimate reason to install into either.
 */
function assertPlausibleTarget(resolvedTarget) {
  const { root } = path.parse(resolvedTarget);

  if (resolvedTarget === root) {
    throw new InstallError(
      `refusing to install into a filesystem root: ${resolvedTarget}\n` +
        "  Create a directory for the project and install into that.",
    );
  }

  // Two independent checks. os.homedir() is the honest answer for the person
  // running this; the shape check also catches another account's home, and
  // still works when HOME is unset or points somewhere unexpected.
  const isOwnHome = resolvedTarget === path.resolve(os.homedir());
  const parent = path.dirname(resolvedTarget);
  const looksLikeHome =
    path.dirname(parent) === root &&
    ["users", "home"].includes(path.basename(parent).toLowerCase());

  if (isOwnHome || looksLikeHome) {
    throw new InstallError(
      `refusing to install into a home directory: ${resolvedTarget}\n` +
        "\n" +
        "  This is almost always a `cd` that did not take effect. In Command\n" +
        "  Prompt, `cd D:\\path` does not switch drive — it needs `cd /d D:\\path`.\n" +
        "\n" +
        "  Check the prompt shows your project directory, then install again.",
    );
  }
}

/**
 * Work out everything that would happen, without touching the filesystem.
 *
 * @returns {{actions: object[], drift: object[], warnings: string[], ...}}
 */
function buildPlan({
  target,
  toolkitRoot,
  modules = null,
  profile = null,
  forceProfile = false,
}) {
  const resolvedTarget = path.resolve(target);
  const resolvedToolkit = path.resolve(toolkitRoot);

  if (resolvedTarget === resolvedToolkit) {
    throw new InstallError(
      "refusing to install the toolkit into itself. Pass a different --target.",
    );
  }
  if (!fs.existsSync(resolvedTarget)) {
    throw new InstallError(`target does not exist: ${resolvedTarget}`);
  }
  if (!fs.statSync(resolvedTarget).isDirectory()) {
    throw new InstallError(`target is not a directory: ${resolvedTarget}`);
  }
  assertPlausibleTarget(resolvedTarget);

  const previous = readState(resolvedTarget);
  const identity = toolkitIdentity(resolvedToolkit);
  const resolvedModules = resolveModules(modules, previous?.modules ?? null);
  const resolvedProfile = resolveProfile(
    profile,
    previous?.profile ?? null,
    forceProfile,
  );

  // Every shipped adapter, so the generated .gitignore covers whatever the
  // project turns out to be built in. A broken adapter fails the install
  // rather than silently producing a .gitignore missing a language.
  let shippedAdapters;
  try {
    shippedAdapters = loadShippedAdapters(resolvedToolkit);
  } catch (err) {
    throw new InstallError(
      `cannot read the toolkit's adapters: ${err.message}`,
    );
  }

  const actions = [];
  const warnings = [];

  if (resolvedProfile.warning) warnings.push(resolvedProfile.warning);

  const brainExists = fs.existsSync(path.join(resolvedTarget, ".brain"));

  for (const entry of PAYLOAD) {
    const sourceDir = path.join(resolvedToolkit, entry.source);
    const files = listFiles(sourceDir);

    if (files.length === 0) {
      warnings.push(
        `${entry.source}/ is empty in the toolkit — nothing to install from it.`,
      );
      continue;
    }

    const blocked = entry.onceOnly && brainExists;

    for (const relative of files) {
      // A file this run's profile does not include is left out of the plan
      // entirely — not written, and not recorded — so the existing prune
      // mechanism removes it on its own if a later run raises the profile
      // back down (--force-profile) or if the toolkit stops shipping it.
      if (entry.filter && !entry.filter(relative, resolvedProfile.profile))
        continue;

      actions.push({
        action: blocked ? "skip" : "write",
        reason: blocked
          ? "the project already has a .brain/ — its record is never overwritten"
          : null,
        source: path.join(sourceDir, relative),
        destination: path.join(resolvedTarget, entry.destination, relative),
        key: toPosix(path.join(entry.destination, relative)),
        policy: entry.policy,
      });
    }
  }

  for (const entry of SINGLE_FILES) {
    let source = null;
    let content = null;

    if (entry.generate) {
      content = GENERATORS[entry.generate](shippedAdapters);
    } else {
      source = path.join(resolvedToolkit, entry.source);
      if (!fs.existsSync(source)) {
        warnings.push(`${entry.source} is missing from the toolkit — skipped.`);
        continue;
      }
    }

    const destination = path.join(resolvedTarget, entry.destination);

    // `skipIfExists` lets an entry test something other than its own
    // destination: src/.gitkeep must not be written beside real code just
    // because the marker itself happens to be absent.
    const guard = entry.skipIfExists
      ? path.join(resolvedTarget, entry.skipIfExists)
      : destination;
    const present = fs.existsSync(guard);

    actions.push({
      action: present && entry.onceOnly ? "skip" : "write",
      reason:
        present && entry.onceOnly
          ? entry.skipIfExists
            ? `${entry.skipIfExists} already exists — the project owns it`
            : "already present — the project owns this file"
          : null,
      source,
      content,
      destination,
      key: toPosix(entry.destination),
      policy: entry.policy,
    });
  }

  return {
    target: resolvedTarget,
    toolkitRoot: resolvedToolkit,
    version: identity.version,
    commit: identity.commit,
    ref: identity.ref,
    remote: identity.remote,
    modules: resolvedModules,
    profile: resolvedProfile.profile,
    firstInstall: previous === null,
    actions,
    drift: detectDrift(resolvedTarget, previous, actions),
    prune: detectPrunable(previous, new Set(actions.map((a) => a.key))),
    warnings,
  };
}

/**
 * Managed files recorded in a previous install that the toolkit no longer
 * ships (PF-007).
 *
 * A file dropped from PAYLOAD or SINGLE_FILES already stops being recorded on
 * the next install — apply() only ever writes state entries for what it
 * planned this run. Nothing removes the file itself, so without this it sits
 * on disk forever, unrecorded and untraceable.
 *
 * Only 'managed' entries are candidates. A seeded file is the project's own
 * regardless of whether the toolkit's own scaffold still plans it.
 */
function detectPrunable(previous, plannedKeys) {
  if (!previous?.files) return [];
  return Object.entries(previous.files)
    .filter(
      ([key, record]) => record.policy === "managed" && !plannedKeys.has(key),
    )
    .map(([key]) => key)
    .sort();
}

/**
 * Managed files whose current content differs from what was recorded.
 *
 * Only `managed` files are reported: they are the ones an update replaces, so a
 * drifted one is about to lose local edits. Seeded files are the project's own
 * and are expected to change.
 */
/** The bytes an action would write, or null when it writes nothing. */
function incomingBytes(action) {
  if (!action || action.action !== "write") return null;
  if (typeof action.content === "string") return Buffer.from(action.content, "utf8");
  if (action.source) {
    try {
      return fs.readFileSync(action.source);
    } catch {
      return null;
    }
  }
  return null;
}

const withoutCarriageReturns = (buffer) => Buffer.from(buffer.toString("utf8").replace(/\r\n/g, "\n"), "utf8");

/**
 * Managed files whose bytes differ from what the last install recorded.
 *
 * A differing hash is not the same thing as a lost edit, and reporting it that
 * way told a developer they had destroyed work they never did (PF-017). The
 * file is compared against what THIS run is about to write, which separates
 * three very different situations:
 *
 *   matches-toolkit  the file already holds this version's content — a bump
 *                    that landed some other way (a merge, a second clone).
 *                    Nothing to lose.
 *   line-endings     identical apart from CRLF/LF, which is git's autocrlf on
 *                    Windows rewriting a file the installer wrote. Nothing to
 *                    lose, and it recurs on every checkout.
 *   modified         genuinely different content. This is the only state where
 *                    a real local edit is about to be discarded.
 *
 * @param {object[]} actions this run's planned actions, for the comparison
 */
function detectDrift(target, previous, actions = []) {
  if (!previous?.files) return [];

  const incoming = new Map(actions.map((action) => [action.key, action]));
  const drift = [];

  for (const [key, record] of Object.entries(previous.files)) {
    if (record.policy !== "managed") continue;

    const file = path.join(target, key);
    if (!fs.existsSync(file)) {
      drift.push({ path: key, state: "deleted", recorded: record.sha256, actual: null });
      continue;
    }

    const actual = sha256(file);
    if (actual === record.sha256) continue;

    const onDisk = fs.readFileSync(file);
    const willWrite = incomingBytes(incoming.get(key));

    let state = "modified";
    if (willWrite) {
      if (onDisk.equals(willWrite)) state = "matches-toolkit";
      else if (withoutCarriageReturns(onDisk).equals(withoutCarriageReturns(willWrite))) state = "line-endings";
    }

    drift.push({ path: key, state, recorded: record.sha256, actual });
  }

  return drift.sort((a, b) => a.path.localeCompare(b.path));
}

/** Drift states where a real local edit is about to be discarded. */
const LOSES_WORK = new Set(["modified", "deleted"]);

// --------------------------------------------------------------------------
// Applying
// --------------------------------------------------------------------------

/**
 * Execute a plan. With `dryRun` nothing is written, including the state file.
 *
 * @returns {{written: number, skipped: number, state: object}}
 */
function apply(plan, { dryRun = false } = {}) {
  const files = {};
  let written = 0;
  let skipped = 0;

  for (const action of plan.actions) {
    if (action.action === "skip") {
      skipped += 1;
      continue;
    }

    if (!dryRun) {
      fs.mkdirSync(path.dirname(action.destination), { recursive: true });
      if (action.content !== null && action.content !== undefined) {
        fs.writeFileSync(action.destination, action.content, "utf8");
      } else {
        fs.copyFileSync(action.source, action.destination);
      }
    }

    // A generated file has no source to hash, so its recorded hash comes from
    // the content itself — which is also what makes a dry run's state match a
    // real one.
    files[action.key] = {
      sha256:
        action.content !== null && action.content !== undefined
          ? crypto.createHash("sha256").update(action.content).digest("hex")
          : dryRun
            ? sha256(action.source)
            : sha256(action.destination),
      policy: action.policy,
    };
    written += 1;
  }

  // Files seeded by an earlier run stay in the record even when skipped now, so
  // that the state file remains a complete inventory of what the toolkit put
  // there rather than only what this run touched.
  for (const action of plan.actions) {
    if (action.action !== "skip" || files[action.key]) continue;
    const existing = path.join(plan.target, action.key);
    if (fs.existsSync(existing)) {
      files[action.key] = { sha256: sha256(existing), policy: action.policy };
    }
  }

  // Managed files the toolkit no longer ships (PF-007). `files` above was
  // built only from this run's actions, so a pruned key is already absent
  // from it — deleting the file itself is all that is left to do.
  const prunedPaths = [];
  for (const key of plan.prune ?? []) {
    const file = path.join(plan.target, key);
    if (!fs.existsSync(file)) continue;
    prunedPaths.push(key);
    if (!dryRun) fs.rmSync(file);
  }

  const state = {
    stateVersion: STATE_VERSION,
    toolkit: "itm-sdlc",
    version: plan.version,
    commit: plan.commit,
    ref: plan.ref,
    remote: plan.remote,
    installedAt: new Date().toISOString(),
    modules: plan.modules,
    profile: plan.profile,
    files,
  };

  if (!dryRun) {
    const stateFile = path.join(plan.target, STATE_FILE);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
  }

  return { written, skipped, pruned: prunedPaths.length, prunedPaths, state };
}

// ---------------------------------------------------------------------------
// Uninstall — the mirror of install: remove every recorded managed file,
// leave every seeded file exactly alone.
// ---------------------------------------------------------------------------

/**
 * Work out what --uninstall would remove, without touching the filesystem.
 *
 * Only files this toolkit is on record as having written are candidates, and
 * only the 'managed' ones among those — a seeded file is the project's own,
 * uninstall or not. A file that exists on disk but was never recorded (hand
 * added, or written by something else entirely) is left alone: the state
 * file is the only source of truth for what this toolkit put there.
 */
function buildUninstallPlan({ target, toolkitRoot }) {
  const resolvedTarget = path.resolve(target);
  const resolvedToolkit = toolkitRoot ? path.resolve(toolkitRoot) : null;

  if (resolvedToolkit && resolvedTarget === resolvedToolkit) {
    throw new InstallError(
      "refusing to uninstall from the toolkit itself. Pass a different --target.",
    );
  }
  if (!fs.existsSync(resolvedTarget)) {
    throw new InstallError(`target does not exist: ${resolvedTarget}`);
  }
  if (!fs.statSync(resolvedTarget).isDirectory()) {
    throw new InstallError(`target is not a directory: ${resolvedTarget}`);
  }
  assertPlausibleTarget(resolvedTarget);

  const state = readState(resolvedTarget);
  if (!state) {
    throw new InstallError(
      `no ${toPosix(STATE_FILE)} found at ${resolvedTarget} — nothing recorded to uninstall.`,
    );
  }

  const managed = [];
  const seededRemaining = [];
  for (const [key, record] of Object.entries(state.files ?? {})) {
    (record.policy === "managed" ? managed : seededRemaining).push(key);
  }
  managed.sort();
  seededRemaining.sort();

  const actions = managed.map((key) => {
    const destination = path.join(resolvedTarget, key);
    return { key, destination, exists: fs.existsSync(destination) };
  });

  return { target: resolvedTarget, state, actions, seededRemaining };
}

/**
 * Execute an uninstall plan. With `dryRun` nothing is removed or rewritten.
 *
 * Rewrites install-state.json to drop the removed entries rather than
 * deleting the file outright: the seeded entries in it are still true, and a
 * project the toolkit is no longer installed into still owns its .brain/.
 */
function applyUninstall(plan, { dryRun = false } = {}) {
  let removed = 0;
  const removedKeys = [];

  for (const action of plan.actions) {
    if (!action.exists) continue;
    removedKeys.push(action.key);
    if (!dryRun) fs.rmSync(action.destination);
    removed += 1;
  }

  if (!dryRun) {
    const remainingFiles = Object.fromEntries(
      Object.entries(plan.state.files ?? {}).filter(
        ([, record]) => record.policy !== "managed",
      ),
    );
    const nextState = { ...plan.state, files: remainingFiles };
    fs.writeFileSync(
      path.join(plan.target, STATE_FILE),
      JSON.stringify(nextState, null, 2) + "\n",
      "utf8",
    );
  }

  return {
    removed,
    total: plan.actions.length,
    removedKeys,
    seededRemaining: plan.seededRemaining,
  };
}

// ---------------------------------------------------------------------------
// --check: is this directory a suitable target?
//
// The three guards in buildPlan refuse what is obviously wrong — the toolkit
// itself, a home directory, a filesystem root. They say nothing about a
// directory that is plausible and still unsuitable, which is what PF-008
// recorded: the intended pilot project had real source, no commits to diff
// against, and a full ECC installation in the same .claude/ this writes to.
//
// Everything here is read-only. Nothing in this section may write.
// ---------------------------------------------------------------------------

/** Directories never worth walking when looking for a language marker. */
const CHECK_SKIP_DIRS = new Set([
  ".git",
  ".brain",
  ".claude", // vendors its own package.json — scanning it detects javascript everywhere
  ".github",
  ".vs",
  ".vscode",
  ".idea",
  "node_modules",
  "bin",
  "obj",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".next",
  "packages_cache",
]);

const CHECK_MAX_DEPTH = 12;
const CHECK_MAX_FILES = 20000;

/**
 * A detect glob as a basename test.
 *
 * Every shipped `detect` pattern has the form `**\/<basename>`, which is the
 * only form this understands. A pattern with a directory part returns null and
 * is skipped rather than silently mis-matching — `--check` reporting a wrong
 * answer confidently is worse than reporting less.
 */
function basenamePattern(glob) {
  const tail = glob.replace(/^\*\*\//, "");
  if (tail.includes("/")) return null;

  const source = tail
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${source}$`, "i");
}

/** Every filename under `dir`, skipping build output and the toolkit's own directories. */
function* filenamesUnder(dir, depth = 0, budget = { left: CHECK_MAX_FILES }) {
  if (depth > CHECK_MAX_DEPTH || budget.left <= 0) return;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory is not a reason to fail the whole check
  }

  for (const entry of entries) {
    if (budget.left <= 0) return;
    if (entry.isDirectory()) {
      if (CHECK_SKIP_DIRS.has(entry.name)) continue;
      yield* filenamesUnder(path.join(dir, entry.name), depth + 1, budget);
    } else {
      budget.left -= 1;
      yield entry.name;
    }
  }
}

/**
 * Which adapters would activate, without loading the adapter library.
 *
 * `detectAdapters()` in lib/adapters.js is the real implementation and uses
 * glob and ajv. install.js must run straight after `git clone` with no
 * dependencies installed, so `--check` cannot reach for it.
 */
function detectAdapterIds(target, adapters) {
  const matchers = adapters.map((adapter) => ({
    id: adapter.id,
    detect: (adapter.detect ?? []).map(basenamePattern).filter(Boolean),
    unless: (adapter.detectUnless ?? []).map(basenamePattern).filter(Boolean),
  }));

  const seen = new Set();
  const suppressed = new Set();

  for (const name of filenamesUnder(target)) {
    for (const matcher of matchers) {
      if (matcher.detect.some((re) => re.test(name))) seen.add(matcher.id);
      if (matcher.unless.some((re) => re.test(name)))
        suppressed.add(matcher.id);
    }
  }

  return matchers
    .filter((m) => seen.has(m.id) && !suppressed.has(m.id))
    .map((m) => m.id)
    .sort();
}

/** Commit count, or null when the directory is not a git repository. */
function commitCount(target) {
  try {
    execFileSync("git", ["-C", target, "rev-parse", "--git-dir"], {
      stdio: "ignore",
    });
  } catch {
    return null;
  }

  try {
    const out = execFileSync(
      "git",
      ["-C", target, "rev-list", "--count", "HEAD"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return Number.parseInt(out.trim(), 10) || 0;
  } catch {
    return 0; // a repository with no commits has no HEAD to count
  }
}

const OWN_PLUGIN_NAME = "itm-sdlc";

/** Names of the agents and skills this toolkit ships, so foreign ones stand out. */
function shippedFleet(toolkitRoot) {
  const read = (dir) => {
    try {
      return fs.readdirSync(path.join(toolkitRoot, dir));
    } catch {
      return [];
    }
  };

  return {
    agents: new Set(read("agents")),
    skills: new Set(read("skills")),
  };
}

/**
 * Another toolkit writing to the same `.claude/`.
 *
 * Rule 8 forbids sharing it. Two toolkits in one directory means whichever
 * installed last wins, silently, and a skill can be replaced by an unrelated
 * one carrying the same name.
 */
function competingToolkit(target, toolkitRoot) {
  const claude = path.join(target, ".claude");
  if (!fs.existsSync(claude)) return [];

  const signals = [];
  const exists = (...parts) => fs.existsSync(path.join(claude, ...parts));

  if (exists("plugin.json")) {
    let name = null;
    try {
      name =
        JSON.parse(fs.readFileSync(path.join(claude, "plugin.json"), "utf8"))
          .name ?? null;
    } catch {
      name = "(unreadable)";
    }
    if (name !== OWN_PLUGIN_NAME) {
      signals.push(`.claude/plugin.json declares the plugin '${name}'`);
    }
  }

  if (exists("marketplace.json"))
    signals.push(
      ".claude/marketplace.json — a plugin marketplace is configured here",
    );
  if (exists("rules", "ecc"))
    signals.push(".claude/rules/ecc/ — an ECC rule pack is installed");

  try {
    const plugins = fs.readdirSync(path.join(claude, "plugins"));
    if (plugins.length > 0)
      signals.push(
        `.claude/plugins/ holds ${plugins.length} plugin(s): ${plugins.slice(0, 3).join(", ")}`,
      );
  } catch {
    /* no plugins directory */
  }

  // A fleet this toolkit did not ship and does not record as its own.
  const ours = shippedFleet(toolkitRoot);
  const recorded = new Set(Object.keys(readState(target)?.files ?? {}));

  for (const [dir, mine] of [
    ["agents", ours.agents],
    ["skills", ours.skills],
  ]) {
    let found;
    try {
      found = fs.readdirSync(path.join(claude, dir));
    } catch {
      continue;
    }

    const foreign = found.filter(
      (name) =>
        !mine.has(name) &&
        !recorded.has(`.claude/${dir}/${name}`) &&
        !recorded.has(`.claude/${dir}/${name}/SKILL.md`),
    );

    if (foreign.length > 0) {
      signals.push(
        `.claude/${dir}/ holds ${foreign.length} entr${foreign.length === 1 ? "y" : "ies"} this toolkit does not ship: ${foreign.slice(0, 4).join(", ")}${foreign.length > 4 ? ", …" : ""}`,
      );
    }
  }

  return signals;
}

/**
 * The write path cannot mechanically confirm itself from a local checkout: no
 * amount of reading this directory says whether GitHub branch protection is
 * actually configured, or whether the repository is private on a plan where
 * that is not even possible. So this is printed unconditionally rather than
 * gated on a check that would just be guessing — CONVENTIONS.md §7 and
 * PF-003 are explicit that the write path must never be described as
 * enforced without that confirmation.
 */
const BRANCH_PROTECTION_NOTICE =
  "On GitHub Free, branch protection is unavailable for private repositories (CONVENTIONS.md §7). " +
  "If this project is private on that plan, the .brain/ write path cannot be enforced mechanically: " +
  "brain-guard.yml is a detective backstop only — it reports a change that already reached the default " +
  "branch without a pull request, it does not prevent one (PF-003). Confirm branch protection is actually " +
  "configured on this repository before treating the write path as enforced.";

/**
 * Report whether `target` is a suitable install target. Writes nothing.
 *
 * `probeGh` is injectable so tests can force either outcome without depending
 * on whether `gh` happens to be installed wherever this runs.
 *
 * @returns {{ok: boolean, target: string, checks: {id: string, title: string, ok: boolean, detail: string}[], warnings: string[]}}
 */
function checkTarget({ target, toolkitRoot, probeGh = () => checkGh() }) {
  const resolvedTarget = path.resolve(target);
  const resolvedToolkit = path.resolve(toolkitRoot);
  const checks = [];
  const add = (id, title, ok, detail) => checks.push({ id, title, ok, detail });

  // 1 — the same refusals a real install would make, reported rather than thrown.
  let usable = true;
  if (!fs.existsSync(resolvedTarget)) {
    add(
      "target",
      "target directory",
      false,
      `does not exist: ${resolvedTarget}`,
    );
    usable = false;
  } else if (!fs.statSync(resolvedTarget).isDirectory()) {
    add(
      "target",
      "target directory",
      false,
      `not a directory: ${resolvedTarget}`,
    );
    usable = false;
  } else if (resolvedTarget === resolvedToolkit) {
    add(
      "target",
      "target directory",
      false,
      "this is the toolkit itself. A project must live outside it.",
    );
    usable = false;
  } else {
    try {
      assertPlausibleTarget(resolvedTarget);
      add("target", "target directory", true, resolvedTarget);
    } catch (err) {
      add("target", "target directory", false, err.message.split("\n")[0]);
      usable = false;
    }
  }

  if (!usable) {
    // Everything below reads the target. There is nothing trustworthy to read.
    add(
      "git",
      "git history",
      false,
      "not checked — the target itself is unusable",
    );
    add(
      "adapter",
      "language adapter",
      false,
      "not checked — the target itself is unusable",
    );
    add(
      "toolkit",
      "sole toolkit",
      false,
      "not checked — the target itself is unusable",
    );
    return { ok: false, target: resolvedTarget, checks, warnings: [] };
  }

  // 2 — git history. review-change.js needs a base ref to diff against, and a
  // repository with no commits has none.
  const commits = commitCount(resolvedTarget);
  if (commits === null) {
    add(
      "git",
      "git history",
      false,
      "not a git repository. Run `git init -b main`.",
    );
  } else if (commits === 0) {
    add(
      "git",
      "git history",
      false,
      "a git repository with no commits. Nothing can be diffed against. Commit once first.",
    );
  } else {
    add("git", "git history", true, `${commits} commit(s)`);
  }

  // 3 — a language adapter. gates.yml exits 1 when nothing matches, because
  // G1, G2 and G4 would otherwise pass without running anything.
  let detected = [];
  try {
    detected = detectAdapterIds(
      resolvedTarget,
      loadShippedAdapters(resolvedToolkit),
    );
  } catch (err) {
    add(
      "adapter",
      "language adapter",
      false,
      `could not read the toolkit's adapters: ${err.message}`,
    );
  }

  if (detected.length > 0) {
    add("adapter", "language adapter", true, detected.join(", "));
  } else if (checks.every((c) => c.id !== "adapter")) {
    add(
      "adapter",
      "language adapter",
      false,
      "nothing matched. The gates fail a repository no adapter matches, so this must be resolved before the first pull request — normal for a project with no source yet.",
    );
  }

  // 4 — sole toolkit. Rule 8: nothing else may write to this .claude/.
  const competing = competingToolkit(resolvedTarget, resolvedToolkit);
  if (competing.length === 0) {
    add("toolkit", "sole toolkit", true, "nothing else writes to .claude/");
  } else {
    add("toolkit", "sole toolkit", false, competing.join("; "));
  }

  // Warnings never affect `ok` — they are things worth knowing before the
  // first checkpoint, not reasons to refuse an otherwise-plausible target.
  const warnings = [];

  const gh = probeGh();
  if (!gh.ok) {
    warnings.push(
      "gh (the GitHub CLI) is not on PATH. /checkpoint will not be able to open the brain checkpoint " +
        "pull request itself and will push the branch and print instructions for a human instead (PF-002).",
    );
  }

  warnings.push(BRANCH_PROTECTION_NOTICE);

  return {
    ok: checks.every((c) => c.ok),
    target: resolvedTarget,
    checks,
    warnings,
  };
}

module.exports = {
  PAYLOAD,
  SINGLE_FILES,
  STATE_FILE,
  STATE_VERSION,
  InstallError,
  assertPlausibleTarget,
  buildPlan,
  apply,
  buildUninstallPlan,
  applyUninstall,
  checkTarget,
  detectAdapterIds,
  detectDrift,
  LOSES_WORK,
  detectPrunable,
  listFiles,
  sha256,
  resolveModules,
  resolveProfile,
  skillAllowedForProfile,
  PROFILE_ORDER,
  DEFAULT_PROFILE,
  SKILL_PROFILE,
};
