# feedback/

What the client said about work that was delivered.

## What belongs here

One file per item: `FB-NNNN-short-slug.md`. Four digits, sequential project-wide,
never reused, never renumbered.

Anything the client says in response to delivered work — a demo reaction, a UAT
note, a complaint, an offhand remark in a call that turns out to matter.

## Format

```markdown
# FB-0031 — The engagement list is unusable on a phone

- **Received:** 2026-07-14
- **From:** <name / role>
- **Channel:** UAT session
- **About:** REQ-SAMPLE-018
- **Disposition:** raised as CHG-0014     <!-- actioned | raised as CHG-NNNN | declined | noted -->

## What they said
Their words, quoted, before any interpretation. Keep this separate from what
you think they meant.

## What we think it means
Your reading — clearly marked as a reading, not a fact.

## What was done
The outcome, and the record it turned into if it became one.
```

## Rules

**Quote before interpreting, and keep the two apart.** The value of this record
is that it preserves what was actually said. An interpretation written down as
though it were the client's words is how a misunderstanding becomes permanent.

**Every item gets a disposition, including "declined" and "noted".** Feedback
with no recorded outcome reads later as feedback that was ignored — and the
client will remember raising it.

**Link it to what it is about.** A requirement id, or a change record. Feedback
floating free of the thing it concerns is hard to act on and easy to lose.

## What does not belong here

Internal opinions about the work. Team retrospectives. This directory is the
client's voice specifically — mixing in your own blurs the one thing that makes
it worth keeping.
