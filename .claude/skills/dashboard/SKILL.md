---
name: dashboard
description: Open a visual project dashboard — requirement status, change counts, feedback, decisions, and version history. Use when asked for progress, overview, or a dashboard.
allowed-tools: Read, Grep, Glob, Bash
---

# dashboard

Builds an HTML overview from the project files and opens it in the browser.
**No database.** Read-only.

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
[ -f .claude/itm-sdlc/scripts/dashboard.js ] || echo "vendored toolkit predates dashboard.js - re-run install.js"
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


## 1. Toolkit ready

If `.claude/itm-sdlc/node_modules/` is missing:

```bash
cd .claude/itm-sdlc && npm ci --omit=dev --no-audit --no-fund
```

Return to the project root.

## 2. Generate and open

```bash
node .claude/itm-sdlc/scripts/dashboard.js --project . --open
```

Writes `.claude/reports/dashboard.html` and `dashboard.json`, then opens the HTML.

Those two files are also rewritten by the dashboard hook after a real project edit, and again when the session ends. They are snapshots, not the record. Do not treat them as source of truth.

## 3. Say

- How many requirements, and the count per status
- How many CHG / FB / ADR records
- How many requirements have a version history
- The path of the file that opened

Do not edit `.brain/`.
