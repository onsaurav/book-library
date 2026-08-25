---
name: adr-write
description: Capture an architectural decision as an append-only ADR. Use whenever a non-obvious choice is made between real alternatives.
allowed-tools: Read, Grep, Glob, Write
---

# adr-write

Records why something is built the way it is, so the same argument is not had a
third time.

---

## When this is warranted

A decision belongs here when **reversing it later would be expensive**: storage
choices, service boundaries, authentication models, anything that constrains what
can be built next.

**If there were no real alternatives, it was not a decision.** It is a fact, and
it does not need a record. Do not manufacture ADRs to look diligent — noise in
the one place that has to stay trustworthy is worse than silence.

## 1. Allocate the id

Read `.brain/decisions/`, take the next number after the highest. `ADR-NNNN`,
four digits, sequential project-wide, never reused — not even if a record is
later superseded.

## 2. Write it

To `.brain/decisions/ADR-NNNN-short-slug.md`:

```markdown
# ADR-0007 — Photo files are stored in object storage, not on the app server

- **Status:** accepted
- **Date:** 2026-08-18
- **Governs:** src/Gallery/PhotoStore.cs, src/Gallery/UploadValidation.cs

## Context
What was true when this was decided. The constraint, not the conclusion.

## Decision
What was chosen, stated plainly.

## Alternatives considered
What else was on the table and why it lost. If nothing was, this is not an ADR.

## Consequences
What this makes easy, what it makes hard, and what it rules out.
```

**`Governs:` is not optional.** A decision nobody can connect to code is a
decision nobody will apply. It is also what lets CI warn when those paths change
and the record has not been reviewed.

## 3. Superseding, never editing

Decision records are **append-only**. If a decision turns out to be wrong, write a
**new** ADR and mark the old one:

```markdown
- **Status:** superseded by ADR-0012
```

That single line is the only edit ever permitted to an existing record. The old
one stays exactly where it is, saying exactly what it said.

Editing history destroys the reasoning trail, and an agent reading a rewritten
past will confidently explain a rationale that was never true.

---

## Rules

- Record the decision, not the debate. An hour of argument should still read in
  two minutes.
- If the alternative was rejected after being **tried**, it also belongs in
  `.brain/rejected/` with the evidence.
- Work on a branch. `.brain/` reaches `main` through a reviewed pull request.
