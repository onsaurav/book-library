---
name: verifyReq
description: Verify the requirement record — schema, ids, dependencies, statuses and traceability — against the working tree. Use before committing, before opening a pull request, and after any skill that writes to .brain/requirements/.
allowed-tools: Read, Grep, Glob, Bash
---

# verifyReq

Checks that the **requirement record** is sound and that the code matches it.

Nothing here is new logic. These are the exact scripts the pull request gauntlet
runs — running them locally only changes *when* you find out.

The name is deliberately narrow. This verifies requirements; other things worth
verifying get their own command rather than being quietly bolted on here.

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
[ -f .claude/itm-sdlc/scripts/advance-status.js ] || echo "vendored toolkit predates advance-status.js - re-run install.js"
[ -f .claude/itm-sdlc/scripts/check-constraints.js ] || echo "vendored toolkit predates check-constraints.js - re-run install.js"
[ -f .claude/itm-sdlc/scripts/check-drift.js ] || echo "vendored toolkit predates check-drift.js - re-run install.js"
[ -f .claude/itm-sdlc/scripts/check-secrets.js ] || echo "vendored toolkit predates check-secrets.js - re-run install.js"
[ -f .claude/itm-sdlc/scripts/check-traceability.js ] || echo "vendored toolkit predates check-traceability.js - re-run install.js"
[ -f .claude/itm-sdlc/scripts/validate-requirements.js ] || echo "vendored toolkit predates validate-requirements.js - re-run install.js"
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

The preflight above covers both halves of this: the scripts must exist, and
`.claude/itm-sdlc/node_modules/` must exist for them to run. `node_modules/` is
gitignored, so a fresh clone of the project has the scripts and nothing to run
them with — the `npm ci` one-liner is a once-per-clone step, not a fix.

`npm ci` rather than `npm install`, because the lockfile ships with the payload
and a project's checks should not silently drift to different dependency
versions. Safe to repeat; the result is already gitignored.

**Never fall back to a toolkit clone at an absolute path.** `C:\itm-sdlc` exists
on one machine. A check that only the person who set the project up can run is
not a check.

## 2. Verify the record

Both, from the project root. Do not stop at the first failure — the developer
wants the whole picture, not the first line of it.

```bash
node .claude/itm-sdlc/scripts/validate-requirements.js --cwd .
node .claude/itm-sdlc/scripts/check-traceability.js --project .
```

| Check | Answers |
|---|---|
| `validate-requirements` | Is the record internally consistent — ids unique, dependencies real, no cycles, nothing `agreed` with open ambiguities, nothing `verified` without `verified_by`? |
| `check-traceability` | Orphans in both directions — an `agreed` requirement with no code claiming it, and an annotation naming a requirement or a version that does not exist. |

## 3. Also run, until they have their own command

These are **not** requirement checks. They inspect the whole working tree, and a
credential or an expired constraint can appear in any change regardless of which
requirement it belongs to. They are run here because there is nowhere better yet
— when a `/verifyTree` or equivalent exists, they move there.

```bash
node .claude/itm-sdlc/scripts/check-secrets.js --project .
node .claude/itm-sdlc/scripts/check-constraints.js --project .
```

Report them under a separate heading. Do not let them dilute the requirement
verdict in either direction — a clean record with a hardcoded password is not a
pass, and an expired constraint does not make the requirements wrong.

## 4. Change drift

Also not a requirement check, and given its own heading rather than folded
into step 3 — this one reads the requirement record too, and the point is
exactly to keep it from being mistaken for part of the traceability verdict:

```bash
node .claude/itm-sdlc/scripts/check-drift.js --project .
```

Reports three things: `@covers` annotations pinned to a version that is no
longer current (cited from `check-traceability`'s own class C, not
recomputed — the two must never be free to disagree), requirement versions
that incremented with no `CHG-NNNN` anywhere in their history, and `agreed`
requirements with no implementation annotation at all that traceability's own
`in_progress` floor does not already report. Advisory, always exits 0 unless
run with `--strict`.

## 4b. Has `verified` been earned?

For every requirement at `in_progress`, ask whether a test now annotates it at
its **current** version — the gate CONVENTIONS.md §6 puts on
`in_progress → verified`:

```bash
node .claude/itm-sdlc/scripts/advance-status.js --to verified --dry-run REQ-... REQ-...
```

`--dry-run` writes nothing. Report what it says: which requirements have earned
`verified`, and for those that have not, the exact annotation that is missing.

**By default, stop there.** Reporting is this skill's job.

### Recording it

**Only when the developer asked** — `/verifyReq --record`, or they said in this
conversation to record the transition — drop `--dry-run`:

```bash
node .claude/itm-sdlc/scripts/advance-status.js --to verified REQ-... REQ-...
```

That writes `status: verified` and rewrites `verified_by` to the tests that
actually annotate each requirement. It refuses anything without that evidence,
so it cannot assert a verification that was not earned.

Two things it will not do, and neither will you:

- **Never move anything to `signed_off`.** That records a client accepting a
  delivered increment. A tool asserting it on their behalf is exactly the claim
  the record exists to prevent.
- **Never edit the YAML by hand** to get past a refusal. A refusal means the
  test is missing or pinned to a stale version. Write the test.

## 4c. Run the isolated reviewer locally (optional)

G7 runs the adversarial reviewer in CI, but a GitHub-hosted runner usually has
no `claude` binary and no reviewer secret, so it records `not-configured` and
blocks nothing. **Your machine probably does have one.**

Offer this when the developer is about to open a pull request, and run it only
if they say yes — it spends tokens:

```bash
node .claude/itm-sdlc/scripts/review-change.js \
  --base main --head HEAD \
  --requirements REQ-...,REQ-...
```

It prints which resolver won — `invoker`, `env`, `default-claude` or
`not-configured` — so a silent run is diagnosable.

**Do not paraphrase what comes back.** Each finding cites `file:line`; show them
as given, with their severities. The reviewer sees the diff and the requirement
text and nothing else — not the plan, not the commit messages, not this
conversation — so a finding you think is wrong is worth reading twice before
dismissing: it is the only opinion here that was not shaped by knowing what the
change was *meant* to do.

Add `--prompt-only` to see exactly what would be sent without sending it.

## 5. Report

**Show the scripts' own output.** Do not paraphrase a count, do not summarise a
verdict, do not say "all clean" without the lines that say so. Report each
check's exit code.

Then state, in one line each:

- what failed, and what the developer should do about it
- what passed
- anything **advisory** — `check-secrets`, `check-constraints` and
  `check-drift` all ship advisory, so they can report findings and still exit
  0. An advisory finding is still a finding. Say it out loud rather than
  letting a green exit code bury it.

If everything passes, say so plainly and add the one caveat that matters: a
clean secret scan is evidence, not proof.

---

## Rules

- **Read-only by default.** This skill runs checks and reports. It does not fix
  what it finds. Fixing a finding is the developer's decision, and some of them
  are change records rather than edits.
- **The single exception is `--record`**, and only when the developer asked for
  it: `in_progress → verified` on requirements that have earned it, applied by
  `advance-status.js`, which refuses anything lacking a test at the current
  version. Nothing else in `.brain/` is ever written from here.
- **Never lower a threshold to get a pass.** If a check is wrong, that is a
  pilot finding, not an argument for editing the check.
- **Report a script that could not run as a failure**, never as a pass. A
  missing module, a bad path or a crash means you learned nothing — which is not
  the same as learning that nothing is wrong.

## Then what

**Do not give the same next step regardless of what you found.** Read the state
before recommending anything.

- **Failures in the record** → fix them, or open a `/change-record` if the record
  is right and the world changed.
- **Traceability orphans** → the annotation is missing, or points at a version
  that no longer exists. `/feature-plan` shows which requirement the work
  belongs to.
- **Change drift** → a version bump with no `CHG-NNNN` behind it means scope
  moved without a record; open `/change-record` for it, retroactively if
  necessary. A stale `@covers` needs the test re-read against the current
  text before its pin moves. A missing annotation on an `agreed` requirement
  means work has not started — `/feature-plan` it, or say plainly that it is
  still waiting.
- **Green, and the change under review is code** → `/pr-prepare`.
- **Green, but nothing is built yet** — no adapter detected, no test files
  scanned, `src/` effectively empty → **not** `/pr-prepare`. There is nothing to
  raise a pull request about. The next step is `/feature-plan <REQ-ID>` on an
  `agreed` requirement, and building it.
- **Requirements still at `draft`** → say which, and which questions are holding
  them. They cannot be planned or built. If the rest are `agreed`, work can
  start on those in parallel while the client answers — say so, rather than
  implying the whole project is blocked.
