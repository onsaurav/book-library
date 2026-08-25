---
name: checkpoint
description: At the end of a working session, propose additions to the project brain as a reviewed pull request. Use when wrapping up a session, before switching context, or when asked to capture what was learned.
allowed-tools: Read, Grep, Glob, Write, Bash
---

# checkpoint

At the end of a working session, you propose what the project record should
gain from it — as a pull request, for a human to accept or reject.

You are not writing a diary. You are capturing the things that will be expensive
to rediscover: why something is built the way it is, what was tried and did not
work, what limits were found, and what words now mean.

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
[ -f .claude/itm-sdlc/scripts/check-gh.js ] || echo "vendored toolkit predates check-gh.js - re-run install.js"
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


## 1. Review the session

Go back over what actually happened. Look for:

- A choice made between real alternatives, where the loser had merit.
- An approach that was attempted and abandoned.
- A limit discovered in a third-party system, a browser, a framework, the data.
- A domain word used for the first time, or used with a meaning the glossary
  does not yet carry.
- A moment where someone was surprised. Surprise is the reliable signal that
  something was not written down.

Ignore everything that the code, the tests and the git history already say. The
brain records **why**, not what.

---

## 2. Decide what is durable

For each candidate, ask: *would someone joining in six months need this, and
could they get it any other way?*

If the answer to either is no, leave it out. A thin, accurate brain beats a
thorough one nobody trusts.

---

## 3. Draft the records

Read `.brain/index.md` and the `README.md` in each target directory first — they
define the format, and you must match it.

| Goes to | For | Must carry |
|---|---|---|
| `decisions/` | A non-obvious architectural choice | `ADR-NNNN`, the alternatives considered, and a `Governs:` line naming the code paths it applies to |
| `rejected/` | An approach tried and abandoned | **The reason**, with evidence — a number, an error, a measurement — and what would have to change for it to become viable |
| `constraints/` | A limit you discovered | Where it came from, and a **review-by date**. A constraint with no expiry silently rules out approaches long after it stopped being true |
| `glossary.md` | A new domain term | One sentence of meaning, plus the near-synonym it is not |

You may also add a short note under `sessions/` recording what was left
unfinished. That directory is a staging area, not a destination: anything durable
belongs in one of the four above, with at most a pointer from the session note.

**Allocating identifiers.** Read every existing `ADR-` file and take the next
number after the highest. Four digits, sequential project-wide, never reused,
never renumbered — even if a record is later superseded.

**A rejected approach with no reason recorded is worthless.** "We didn't use X"
tells the next person nothing; "X held a connection per request and exhausted the
pool at 40 concurrent users" stops them repeating it.

---

## 4. Never edit a decision that already exists

Decision records are **append-only**.

If a previous decision turned out to be wrong, or has been overtaken, you do not
edit it and you do not delete it. You write a **new** ADR, and you mark the old
one:

```markdown
- **Status:** superseded by ADR-0012
```

That single line is the only change permitted to an existing decision record.
The superseded record stays exactly where it is, saying exactly what it said.

This matters more than it looks. The old record is what stops the same argument
being had a third time, and it is the only evidence of what was believed when a
piece of code was written.

---

## 5. The write path

**Never commit to `main`. Never commit to the branch you were working on.**

1. Confirm the working tree has no uncommitted code changes you would sweep in.
2. Branch **from the default branch**, not from the feature branch you were on:

   ```bash
   git fetch origin
   git switch --create brain/checkpoint-<YYYY-MM-DD> origin/main
   ```

   Branching from the feature branch would drag its code diff into the brain
   pull request, which makes the record impossible to review on its own terms.
   If that branch name is taken, append `-2`, `-3` and so on.

3. Write the records.
4. Stage **only** `.brain/` paths. Never `git add -A`, and never commit a file
   outside `.brain/`:

   ```bash
   git add .brain
   git status --short          # confirm nothing else is staged
   git commit -m "docs(brain): checkpoint <YYYY-MM-DD>"
   ```

5. Open a pull request — check whether `gh` is available first:

   ```bash
   node .claude/itm-sdlc/scripts/check-gh.js
   ```

   **If that exits 0 (`gh` is available):**

   ```bash
   git push -u origin HEAD
   gh pr create --title "Brain checkpoint <YYYY-MM-DD>" --body "<summary>"
   ```

   The pull request body lists each proposed record in one line, so a reviewer
   can see the shape before opening the diff. State the URL `gh pr create`
   prints.

   **If it exits 1 (`gh` is missing — PF-002): do not say a pull request was
   opened.** Push the branch and stop there:

   ```bash
   git push -u origin HEAD
   ```

   Then tell the person exactly what to do next, in words like these:

   > `gh` is not available, so I could not open the pull request myself. The
   > branch `brain/checkpoint-<YYYY-MM-DD>` has been pushed to `origin`. Open a
   > pull request in the browser — the `git push` output above usually prints a
   > direct link for a freshly pushed branch — or run `gh pr create` yourself
   > once `gh` is installed.

**Never commit `.brain/` straight to `main`, for any reason, including a missing
`gh`.** A pushed branch with no pull request yet is a safe, honest place to stop.
A commit on `main` is not: it is exactly the unreviewed brain write
CONVENTIONS.md §7 exists to prevent, and `brain-guard.yml` only reports it after
the fact — it is a detective backstop, not a preventive control (PF-003). On
GitHub Free, a private repository cannot even enforce branch protection to stop
it happening in the first place, so there may be nothing else standing between
a direct commit and an unreviewed brain change.

**Every brain write is a reviewed pull request.** Auto-committed records compound
error: one is cheap to check, a hundred unchecked are unrecoverable, and nobody
can tell afterwards which were judged and which were generated.

---

## 6. If there is nothing to record

If you propose nothing, say so. An empty checkpoint is a valid
outcome and is better than inventing decisions that were not made.

A session spent implementing an agreed requirement, exactly as planned, with no
surprises, legitimately produces no records at all. Manufacturing an ADR for a
choice nobody actually deliberated puts noise into the one place that has to stay
trustworthy — and the next person cannot tell it apart from a real decision.

---

## Before you finish

State plainly:

1. The branch name, and either the pull request URL (`gh` was available) or
   that the branch was pushed and a pull request still needs opening by hand
   (`gh` was not — see step 5). Never say a pull request was opened when it
   was not.
2. Each record proposed, one line each, by directory.
3. Anything you considered and deliberately left out, and why.
4. Anything you were unsure about — a decision you could not tell was
   deliberate, a constraint you could not attribute to a source.

Do not describe the pull request as complete or approved. It is a proposal, and
it is a human's job to accept it.
