---
name: feature-plan
description: Turn agreed requirement identifiers into an implementation plan and test skeleton. Use at the start of each work item, before any code is written.
allowed-tools: Read, Grep, Glob, Write
---

# feature-plan

Takes requirement identifiers and produces a plan a developer approves before
code exists.

**Invoke with the ids**, e.g. `/feature-plan REQ-BOOK-001 REQ-BOOK-003`.

---

## 1. Refuse to plan what is not agreed

Read each requirement from `.brain/requirements/`.

**Stop if any is still `draft`.** A draft requirement has open ambiguities, and
planning against one means designing around a guess. Say which requirement, and
which questions are unanswered.

## 1b. Check that what this depends on is already built

Read each requirement's `depends_on`. If a dependency is still at `agreed` — not
`in_progress`, not `verified` — **the code this plan builds on does not exist
yet**.

Say so before designing, and name the requirement and its status. You can still
plan, but the plan will be inventing a file layout, a module boundary and a data
shape that the earlier slice has not chosen yet — and when that slice lands it
will have chosen differently.

**Prefer to stop and recommend planning the dependency first.** Planning a whole
project up front produces one plan per slice, each blind to the others, and four
of five get thrown away. That is the failure this check exists to catch.

The exception is a deliberate design spike, where the developer says they want
the shape explored ahead of time. Take them at their word, and put it at the top
of the plan that this is speculative.

## 2. Read the record before designing

| Read | For |
|---|---|
| `.brain/glossary.md` | The exact words to use in names |
| `.brain/decisions/` | Decisions that govern the code paths you will touch |
| `.brain/rejected/` | **Whether this approach was already tried and abandoned** |
| `.brain/constraints/` | Limits that apply here, and whether any are past review |

If `rejected/` contains what you are about to propose, say so and explain what
has changed since. Re-proposing an abandoned approach without acknowledging it is
the failure the directory exists to prevent.

## 3. Write the plan

To `.brain/sessions/<date>-plan-<requirement>.md`:

```markdown
# Plan — REQ-BOOK-001@v1

## What must be true
Each acceptance criterion, restated as the observable behaviour to build.

## Approach
The design, in a paragraph. Name the files to be created or changed.

## Test skeleton
One test per acceptance criterion, named for the behaviour, each carrying
`@covers REQ-BOOK-001@v1`. Write the names and assertions, not the bodies.

## Decisions this forces
Anything non-obvious that will need an ADR once chosen.

## What I am unsure about
Where the requirement is thin, or where you are guessing.
```

## 4. Stop for approval

The developer approves or corrects the plan **before** any code is written. Say
plainly that you are waiting.

---

## Rules

- **One test per acceptance criterion, minimum.** A criterion with no test is a
  criterion nobody will notice is missing.
- **Every test carries the requirement at its current version.** `@covers
  REQ-BOOK-001@v1`. The version is mandatory.
- **The plan is a proposal.** A developer who approves every plan unchanged is
  rubber-stamping, and the plan-override rate is a governed metric precisely
  because of that.
- **Every file the application is made of goes under `src/`** — including served
  static assets. The installer creates `src/` for this. Only `package.json` and
  its lockfile (npm reads them from the working directory, and the gates run from
  the repository root), `README.md`, `tests/`, `scripts/` for project tooling,
  and the toolkit's own `.brain/`, `.claude/` and `.github/` belong beside it. A
  plan that puts `public/`, `lib/` or `app/` at the root is wrong.
- Write only to `.brain/sessions/`. No code yet.
