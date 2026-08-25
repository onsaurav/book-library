# changes/

Scope variations against requirements that were already agreed.

## What belongs here

One file per change: `CHG-NNNN-short-slug.md`. Four digits, sequential
project-wide, never reused, never renumbered.

A change record is needed whenever an **agreed** requirement moves: its meaning
changes, it is withdrawn, or a new one is added to a scope the client has already
signed off. Work that merely implements an agreed requirement is not a change.

## Format

```markdown
# CHG-0012 — Cancellation window extended from 24 to 48 hours

- **Raised:** 2026-07-14
- **Raised by:** client (call with <name>)
- **Affects:** REQ-SAMPLE-014 (v1 -> v2), REQ-SAMPLE-019
- **Status:** accepted            <!-- proposed | accepted | rejected -->

## What changed
The old text and the new text, plainly. Quote both.

## Why
The client's reason, in their words where possible.

## Impact
What has to be rebuilt, retested or migrated. Tests whose `@covers` pin must
move to the new version. Anything already delivered that this invalidates.

## Commercial position
Whether this is in scope, or a variation. State it explicitly even when the
answer is "absorbed" — an unstated answer is assumed to be "free".
```

## Rules

**A requirement version never moves without a change record.** That pairing is
measurable, and the gap between the two is a governance metric: requirement
versions that moved with no CHG behind them are uncaptured scope.

**Record rejected changes too.** A change the client asked for and withdrew is
exactly what gets misremembered later, by both sides.

**Name the affected requirement versions explicitly.** `REQ-SAMPLE-014 (v1 -> v2)`,
not "the cancellation requirement". Six months on, only the identifier is
unambiguous.

## What does not belong here

Bug fixes. Implementation changes that leave the agreed behaviour intact. If the
requirement text still describes what is being built, nothing has changed.
