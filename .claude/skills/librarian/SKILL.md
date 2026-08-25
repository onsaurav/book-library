---
name: librarian
description: Sweep the project brain for contradictions, expired constraints, drift, and agreed requirements with no implementation evidence. Use on request, or weekly. Proposes file-level edits; never writes .brain/ itself.
allowed-tools: Read, Grep, Glob, Bash
---

# librarian

The PDF calls brain rot worse than having no brain at all — a wrong record is
trusted the same as a right one, and an agent reasons confidently from
whichever it was handed. This skill is the sweep that catches it before
someone builds on a premise that stopped being true.

**Propose only.** This skill never writes to `.brain/`, not a draft and not a
branch. Every finding below ends as a suggestion in your reply, for a human to
apply through a reviewed pull request — the same write path CONVENTIONS.md §7
requires for everything else in `.brain/`.

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
[ -f .claude/itm-sdlc/scripts/check-constraints.js ] || echo "vendored toolkit predates check-constraints.js - re-run install.js"
[ -f .claude/itm-sdlc/scripts/check-drift.js ] || echo "vendored toolkit predates check-drift.js - re-run install.js"
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

Same seam as `/verifyReq`, `/metrics` and `/regression-select`. If
`.claude/itm-sdlc/node_modules/` is missing, install once:

```bash
cd .claude/itm-sdlc && npm ci --omit=dev --no-audit --no-fund
```

Then return to the project root.

## 2. Run the mechanical checks

```bash
node .claude/itm-sdlc/scripts/check-constraints.js --project .
```

```bash
node .claude/itm-sdlc/scripts/check-drift.js --project .
```

**Check `check-drift.js` exists before running it.** It shipped after
`check-constraints.js`; a project installed from an older toolkit version may
not have it yet. If it is missing, say so plainly in your report rather than
silently skipping the drift section — an older toolkit is itself a finding
worth naming.

Both scripts are advisory and read-only. Neither needs `--strict` here; you
want everything they can tell you, not a pass/fail verdict.

## 3. Read the brain for contradictions

Nothing checks this mechanically — it does not exist as a script, and it is
the reason this skill exists rather than being folded into `check-drift.js`.
Read `.brain/index.md` first, then work through:

| Read | Looking for |
|---|---|
| `decisions/` | Two ADRs governing the same code paths (their `Governs:` lines) that disagree, where the later one is not marked `superseded by` the earlier |
| `rejected/` | An approach recorded here that a current requirement, decision, or plan has quietly re-proposed |
| `constraints/` | A constraint whose stated limit contradicts what a currently `agreed`-or-later requirement's acceptance criteria promises |
| `glossary.md` | Two terms drifting toward the same meaning, or a requirement using a word the glossary does not define |
| `changes/` | A change record whose `decision` field has sat blank long enough that it reads as forgotten rather than pending |

A contradiction is two things in the record that cannot both be true at once —
not a stale fact on its own (that is drift or an expired constraint, already
covered mechanically) and not a style inconsistency. Cite both sides,
verbatim, with their file paths. **An empty section here is a legitimate,
good result** — do not manufacture a contradiction to look thorough.

## 4. Report, in four labelled sections

1. **Contradictions** — from step 3, each with both citations.
2. **Expired constraints** — `check-constraints.js`'s own findings, shown as
   it reported them.
3. **Drift** — `check-drift.js`'s stale `@covers` versions and uncaptured
   version bumps, shown as it reported them.
4. **Uncovered agreed requirements** — `check-drift.js`'s missing-annotation
   findings: `agreed`-or-later requirements with no implementation annotation
   that `check-traceability` does not already flag.

If a section is empty, say so in one line rather than omitting it — an absent
section reads as "not checked," and every section here was checked.

## 5. Propose file-level edits

For each finding, name the specific edit a human would make — not "fix the
constraint," but "extend `constraints/rate-limit.md`'s `Review by:` to
`2026-10-01` once reverified" or "mark `decisions/ADR-0004.md` `superseded by
ADR-0012`" or "open `/change-record` for REQ-SAMPLE-014's uncaptured v3."
Group proposals by target file, so a human can see the whole set of changes
one file would need before opening anything.

**Do not create the branch, write the file, or open the pull request
yourself.** Hand the proposals to the human, or to `/checkpoint` if they ask
you to carry them into one — either way, the write happens through a reviewed
pull request, and it is not this skill that opens it.

---

## Rules

- **Never write to `.brain/`.** Not a draft file, not a branch, nothing. Every
  output of this skill is prose in your reply.
- **A missing `check-drift.js` is a finding, not a silent gap.** Say the
  toolkit is out of date rather than quietly reporting three sections instead
  of four.
- **Do not manufacture a contradiction, an expired constraint, or a gap to
  look thorough.** A clean sweep is a valid, useful result — report it as
  plainly as you would report a full one.
- **Cite everything.** A contradiction without both sides quoted, or a
  proposal without the file it targets, is not actionable — it is an
  impression, and the human reading it cannot act on an impression.
