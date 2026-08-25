---
name: metrics
description: Report governance metrics — requirement coverage, uncaptured change, open ambiguities, golden-set detection, gate false-positive rate — computed from the repository alone. Use when asked for project health, gate-promotion evidence, or "how are we doing".
allowed-tools: Read, Grep, Glob, Bash
---

# metrics

Runs `scripts/metrics.js` and reports what it finds. **Read-only** — this skill
computes numbers from files already in the repository. It does not fix
anything, does not touch `.brain/`, and does not invent a number it cannot back
up with a file in the project.

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
[ -f .claude/itm-sdlc/scripts/metrics.js ] || echo "vendored toolkit predates metrics.js - re-run install.js"
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

Same seam as `/verifyReq`. If `.claude/itm-sdlc/node_modules/` is missing,
install once:

```bash
cd .claude/itm-sdlc && npm ci --omit=dev --no-audit --no-fund
```

Then return to the project root.

## 2. Run it

```bash
node .claude/itm-sdlc/scripts/metrics.js --project .
```

Add `--skip-golden-set` only if you need a fast answer and can live without that
section — it otherwise materialises and runs every golden-set case, which takes
real seconds, not milliseconds.

## 3. What each number means, and when it is honestly absent

| Metric | Answers | When it is legitimately absent or incomplete |
|---|---|---|
| **Requirement coverage** | Of everything `agreed` or later, how much has `verified_by` or a matching `@covers`? | `requiringCoverage: 0` on a project with nothing agreed yet — not a failure |
| **Uncaptured change** | Of requirements whose version incremented, how many have no `CHG-NNNN` anywhere in their `history`? | `total: 0` if nothing has ever changed version — the healthy early state |
| **Open ambiguities** | Requirements past `draft` that still carry an open ambiguity | **Must be zero.** `validate-requirements.js` blocks `draft → agreed` while ambiguities are open, so a non-zero count here means a requirement reached `agreed` some other way — a validator bug, or a hand-edited record. Treat as a genuine finding, not noise |
| **Golden set** | Reused from `run-golden-set.js`, including its refusal to print a headline rate when fewer than half the cases were judged (PF-014) | `available: false` in every installed project — the set ships only with the toolkit repository itself, not vendored into `.claude/itm-sdlc/` |
| **Gate false-positive rate** | Per advisory gate, how often a human judged a finding a false positive | `unmeasured` until a project actually maintains `--gate-log` (default `.brain/metrics/gate-findings-log.json`; see `scripts/metrics.js`'s header for the format). Nothing in this toolkit writes that file automatically yet |

## 4. Report

**Show the script's own output**, not a paraphrase. Then, in your own words:

- Which metrics are genuine numbers, and which are honestly `not available` /
  `unmeasured` / `NO HEADLINE RATE` — and why, in one line each. Do not let a
  present number crowd out an absent one; an absent metric is information, not
  a gap to smooth over.
- **Open ambiguities is the one metric to escalate, not just report.** If it is
  non-zero, say so plainly and point at `/verifyReq` or `/change-record` as the
  next step — this one indicates something is wrong with the record, not
  merely something not yet measured.
- If asked about promoting an advisory gate (G5/G6/G7) to blocking, point at
  the gate false-positive rate. If it reads `unmeasured`, say plainly that the
  gate cannot be promoted yet (README's promotion policy: 30 real pull
  requests with a measured rate below the agreed threshold) — do not treat a
  clean run of everything *else* as evidence for this one.

---

## Rules

- **Never print a percentage this script did not compute.** If a section reads
  `unmeasured` or `not available`, report it as exactly that — do not estimate,
  round up from a small sample, or infer a number from an adjacent metric.
- **Do not average away an absence.** "Mostly measured" is not a summary; name
  which sections are missing and why.
- Read-only, same as `/verifyReq`: no edits, no `.brain/` writes, no fixes.
