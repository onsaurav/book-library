---
name: regression-select
description: Derive which test files are worth re-running for a change — a CHG- id, or one or more REQ- ids. Use before verifying a change, when the full suite is slow enough that scope matters. This is the same selection G2 and G4 use when the pull request declares ids.
allowed-tools: Read, Grep, Glob, Bash
---

# regression-select

Runs `scripts/regression-select.js` and reports what it derives.

**This is now what CI uses**, not a preview of it. G2 and G4 run the derived
file list when four things all hold, and the **full suite whenever any one of
them does not**:

1. the pull request declares `REQ-` or `CHG-` ids — the same scan G0 does
2. the selector runs without error
3. it returns a non-empty file list
4. the detected adapter declares `commands.testFiles`

Condition 4 is a real limit, not a formality. `dotnet test` selects by test
name rather than by path, so the csharp adapter omits the field and a C#
project always runs everything. That is the intended answer: **a scoped run
that silently misses tests is worse than a slow one.**

Both jobs print which path they took and why — `scoped: N files` or
`full suite (reason)`. Coverage is never scoped: it is a property of the whole
codebase, and a figure derived from a subset would not mean what it says.

This skill remains read-only. It derives and reports; it never runs anything.

---

## Before running a vendored script

Every command below runs a script from `.claude/itm-sdlc/scripts/`, vendored
into this project by the installer. **A project installed from an older toolkit
will not have all of them.**

Check each file exists before running it. If one is missing, say exactly this
and move on to the checks that do exist:

> `<name>.js` is missing. This project's vendored toolkit predates this check —
> re-run `install.js` from the toolkit clone to update it.

That is a gap in the project's toolkit copy, not a failure of the project, and it
must never reach the developer as a raw Node `MODULE_NOT_FOUND` stack trace
(PF-016).

The same guard `gates.yml` uses at every job:

```bash
[ -f .claude/itm-sdlc/scripts/regression-select.js ] || echo "vendored toolkit predates regression-select.js - re-run install.js"
```

If `.claude/itm-sdlc/node_modules/` is missing, install the checkers'
dependencies once — the same one-liner everywhere:

```bash
cd .claude/itm-sdlc && npm ci --omit=dev --no-audit --no-fund
```

Then return to the project root. Do not use `npm --prefix`: it reads
`package.json` from the current directory, not the prefix, and fails with
`enoent`.

---


## 1. Find a runnable toolkit

Same seam as `/verifyReq`, `/metrics` and `/client-report`. If
`.claude/itm-sdlc/node_modules/` is missing, install once:

```bash
cd .claude/itm-sdlc && npm ci --omit=dev --no-audit --no-fund
```

Then return to the project root.

## 2. Run it

Give it exactly what changed — a change record, or the requirement(s) directly:

```bash
node .claude/itm-sdlc/scripts/regression-select.js CHG-0012
node .claude/itm-sdlc/scripts/regression-select.js REQ-SAMPLE-001 REQ-SAMPLE-004
```

Not both at once, and not more than one `CHG-` id — the script refuses either.

## 3. What it does

1. Resolves the input to a starting set of requirement ids. A `CHG-` id reads
   its `affects` field (whichever shape the record uses — see
   `templates/brain-scaffold/changes/README.md` and
   `skills/change-record/SKILL.md`, which currently document two different
   ones).
2. Walks `depends_on` **in reverse**: not what the starting requirement(s)
   depend on, but every requirement that depends on *them*, transitively.
   Those are the ones whose own behaviour may have assumed something that
   just changed.
3. Collects every test file carrying an `@covers` annotation for any id in
   that expanded set.
4. Prints the file list, and — purely informational — each detected
   adapter's test command as declared in `adapters/*.json`. That command runs
   the **whole** suite today; nothing scopes it to just these files yet.

## 4. Report

**Show the script's own output**, including the impacted-requirements list —
a developer who only sees the file list cannot tell whether a small change
pulled in half the requirement graph, and that is exactly the number worth
knowing before deciding whether to trust the scope.

State plainly:

- How many requirements were impacted, and how many were added purely via
  `depends_on` (not directly named).
- How many test files were derived. **An empty list is a real, reportable
  outcome, not a script failure** — it means nothing currently annotates any
  impacted requirement, which is itself useful to know.
- That this is advisory: the person still decides whether to run the full
  suite or trust the derived scope. Do not present the derived list as
  something G2/G4 already uses — they do not, on purpose (see Rules).

---

## Rules

- **Never propose editing `workflows/gates.yml` or an adapter's commands to
  scope a run.** The wiring already exists and is language-neutral by
  construction. An adapter that cannot express a scoped run omits the field
  and gets the full suite — that is the design, not a gap to patch around in
  the workflow.
- **Never present a scoped run as equivalent to a full one.** It re-runs what
  the requirement graph says could be affected. A dependency nobody recorded
  is invisible to it, which is one more reason the full suite stays the
  fallback rather than the exception.
- **A `CHG-` id that names no affected requirement, or that cannot be found,
  is a failure to report, not a reason to guess.** Say so and stop; do not
  fall back to "select everything" silently.
- **Read-only.** No edits to `.brain/`, no requirement changes, and this
  skill never itself runs the derived tests — it only says what they are.
