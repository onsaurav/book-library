# rejected/

Approaches that were tried and abandoned — **with the reason**.

> **This directory saves more time than the rest of the brain combined.**
>
> Everything else here tells you what to do. This tells you what not to try, and
> that is the more expensive lesson, because a bad approach looks exactly as
> promising the second time as it did the first. Without this record, the same
> dead end is re-entered every few months by whoever is newest — and it costs
> the full investigation each time before failing the same way.

## What belongs here

One file per abandoned approach: `short-slug.md`. No sequential id — these are
not referenced from anywhere; they are found by reading.

Write one whenever you spend more than an hour on something that did not work.
Especially when it *nearly* worked, because that is what will tempt the next
person.

## Format

```markdown
# Batch the reference lookups in a single query

- **Tried:** 2026-07-14
- **By:** <who>
- **Related:** ADR-0007, REQ-SAMPLE-012

## What was tried
Enough detail that someone could reproduce it, briefly.

## Why it was abandoned
The actual reason, with the evidence. A number, an error, a measurement.
Not "it felt wrong".

## What would have to change for this to become viable
The condition under which to reconsider — or "nothing, this is a dead end".
This line is what makes the record useful rather than merely discouraging.
```

## Rules

**Record the reason, not just the rejection.** "We didn't use X" is close to
useless. "X held a connection per request and we exhausted the pool at 40
concurrent users" is what stops the next attempt.

**Be honest about near-misses.** If it failed for a reason that might not apply
next year, say so. The point is to inform the next decision, not to close the
question forever.

**Do not delete these when they become stale.** Add a note. A rejected approach
that later became viable is one of the most valuable records in the brain.

## What does not belong here

Ideas nobody actually tried. Speculation costs nothing to have and nothing to
skip; this directory is for lessons that were paid for.
