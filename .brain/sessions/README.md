# sessions/

Working session notes. The lowest-value directory in the brain, and the one most
likely to become noise.

## What belongs here

One file per session: `YYYY-MM-DD-short-slug.md`.

A short note on what was worked on, what was learned, and what was left
unfinished. Written at the end of a session, usually by `/checkpoint`.

## Format

```markdown
# 2026-07-14 — Engagement reference allocation

## Worked on
REQ-SAMPLE-012, REQ-SAMPLE-014.

## Learned
Anything discovered that is not yet a decision, constraint or rejected approach.
If it IS one of those, it belongs in that directory instead — put a pointer here
rather than the content.

## Left unfinished
What the next person picks up, and anything half-done that would be confusing
to find.

## Promoted to the record
- ADR-0007 (reference allocation)
- rejected/batch-reference-lookups.md
```

## Rules

**This is a staging area, not a destination.** Anything durable gets promoted to
`decisions/`, `rejected/`, `constraints/` or `glossary.md`. What stays here is
the connective tissue nobody will need — until the one time they do.

**Prune aggressively.** Sessions older than a completed phase can usually be
deleted once everything durable has been promoted. Nobody will ever read the
whole directory, and its size is what makes people stop trusting the brain.

**Never put a decision here and nowhere else.** A decision recorded only in a
session note is invisible to anyone who does not already know when it was made —
which is everyone who needs it.

## What does not belong here

Anything another directory has a home for. If you are unsure whether a note is
durable, write it in the right directory rather than here: a slightly premature
ADR is easier to find and supersede than a buried session note.
