# decisions/

Every non-obvious architectural choice, and why it was made.

## What belongs here

One file per decision: `ADR-NNNN-short-slug.md`. Four digits, sequential
project-wide, never reused, never renumbered.

A decision belongs here when reversing it later would be expensive: storage
choices, boundaries between services, authentication models, anything that
constrains what can be built next.

## Format

```markdown
# ADR-0007 — Engagement references are issued centrally

- **Status:** accepted            <!-- proposed | accepted | superseded by ADR-NNNN -->
- **Date:** 2026-07-14
- **Governs:** src/engagements/**, src/billing/reference.*

## Context
What was true when this was decided. The constraint, not the conclusion.

## Decision
What was chosen, stated plainly.

## Alternatives considered
What else was on the table, and why it lost. If there were no alternatives,
this was not a decision and does not need a record.

## Consequences
What this makes easy, what it makes hard, and what it rules out.
```

## Rules

**Append-only.** Never edit a decision to reflect a change of mind, and never
delete one. Write a new ADR and mark the old one `superseded by ADR-NNNN`,
leaving it in place. The superseded record is what stops the same argument being
had twice.

**Name the code paths it governs.** A decision nobody can connect to code is a
decision nobody will apply. `Governs:` is what makes it findable when someone is
about to violate it.

**Record the decision, not the debate.** If it took an hour to decide, the ADR
should still take two minutes to read.

## What does not belong here

Choices with no alternative — those are just facts. Choices that are cheap to
reverse. Anything that is really a constraint you discovered rather than a
decision you made: that goes in `constraints/`.
