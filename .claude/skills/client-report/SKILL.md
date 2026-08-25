---
name: client-report
description: Generate the client-facing requirement status matrix — id, title, status, version, evidence, open questions — as Markdown or HTML. Use for a weekly update, a milestone check-in, or a sign-off attachment.
allowed-tools: Read, Grep, Glob, Bash, Write
---

# client-report

Runs `scripts/client-report.js` and hands the output to the person who asked
for it. **Read-only against the project record** — this generates a document
from `.brain/requirements/` and the codebase's `@covers` annotations. It does
not edit `.brain/`, does not decide anything, and does not add implementation
commentary.

This is the artefact PDF §03 calls the client-facing dividend: a live matrix
the client can actually be shown, suitable to paste into an email or attach at
sign-off without editing first.

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
[ -f .claude/itm-sdlc/scripts/client-report.js ] || echo "vendored toolkit predates client-report.js - re-run install.js"
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

Same seam as `/verifyReq` and `/metrics`. If `.claude/itm-sdlc/node_modules/`
is missing, install once:

```bash
cd .claude/itm-sdlc && npm ci --omit=dev --no-audit --no-fund
```

Then return to the project root.

## 2. Generate it

```bash
node .claude/itm-sdlc/scripts/client-report.js --project . --title "<Client / project name> — requirement status"
```

Add `--format html` for an attachment, or `--format both --out <path>` to
produce both `<path>.md` and `<path>.html` in one run. Without `--out`, the
report prints to stdout — write it to a file only when the person asked for a
file.

## 3. What is, and is not, in it

| Column | Source |
|---|---|
| REQ id | the requirement's id |
| Title | the requirement's title |
| Status | `draft` / `agreed` / `in_progress` / `verified` / `signed_off` |
| Version | the requirement's current version |
| Evidence | `verified_by` entries, plus any matching `@covers` annotation found in the codebase |
| Open questions | the requirement's own `ambiguities` — unresolved questions for the client |

**Deliberately absent, always:** `rejected/`, `sessions/`, install state, test
counts or coverage percentages, and anything that reads like implementation
advice. A requirement with no evidence shows as `—`, not as an excuse for why.
If asked to add commentary explaining a gap, put that in your own message to
the person you are reporting to — never edit it into the generated file. The
generated document is meant to be sent as-is.

## 4. Report

Say plainly:

- How many requirements are in the matrix, and the count per status.
- Whether every `agreed`-or-later requirement carries evidence — if any do
  not, name them; the client will ask.
- Whether any requirement carries an open question — those are exactly what
  the client needs to answer before that requirement can move.

Then hand over the file (or paste the Markdown, if that's what was asked for).
**Do not describe it as final or approved.** It is a snapshot of the record at
the moment it was generated — say so, using the report's own generated-at line
if asked when.

---

## Rules

- **Read-only.** No edits to `.brain/`, no requirement changes, no fixes.
  A gap in the matrix is a finding for `/change-record` or `/feature-plan` to
  act on, not something this skill resolves.
- **Never paraphrase evidence into a stronger claim than the file supports.**
  "Verified" in the Status column means the requirement reached that status in
  the record — it is not this skill's job to second-guess it, and not this
  skill's job to inflate a `draft` into anything else either.
- **Nothing from `rejected/`, `sessions/`, or installer state ever belongs in
  this report**, even if it feels relevant. Those directories exist so the
  team does not repeat itself; the client was never meant to see them.
