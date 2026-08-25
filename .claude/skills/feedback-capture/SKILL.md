---
name: feedback-capture
description: Capture client feedback verbatim and propose a triage classification. Use at the end of every client-facing meeting, demo or UAT session.
allowed-tools: Read, Grep, Glob, Write
---

# feedback-capture

What the client said about work already delivered, recorded before anyone
interprets it.

**Paste their words, and say who said it, where and when.**

---

## Why this exists

Feedback given in a call, a chat message or a corridor conversation never reaches
the record unless capture is a step someone owns. **That is the single most
common reason this model degrades in month three.**

## 1. Allocate the id

Read `.brain/feedback/`, take the next number after the highest. `FB-NNNN`, four
digits, sequential project-wide, never reused.

## 2. Capture the raw words first

To `.brain/feedback/FB-NNNN-short-slug.md`:

```markdown
# FB-0031 — The book list is unusable on a phone

- **Received:** 2026-07-14
- **From:** <name / role>
- **Channel:** UAT session
- **Anchors:** REQ-BOOK-003
- **Triage:** proposed — variation
- **Sentiment:** negative

## What they said

> "I can't read any of it on my phone, the covers are tiny and I have to
> scroll forever."

## What we think it means

Clearly marked as a reading, not as fact. Kept separate from the quote above.

## Resolution

What was done, or why nothing was done.
```

**Write the quote before writing the interpretation, and keep them apart.**
Paraphrase silently discards intent, and the raw wording is what you will need
when the interpretation is disputed.

## 3. Propose a triage

| Class | Means | Routes to |
|---|---|---|
| `defect` | Agreed criterion not satisfied | Fix. No change record |
| `variation` | Beyond what was agreed | `/change-record`, commercial assessment |
| `preference` | Within scope, a matter of taste | Logged, batched |
| `already-agreed` | Was decided, and recorded | Point at the requirement version |

**Propose it. Do not apply it.** Classification carries commercial consequences,
so a human always reviews.

## 4. Anchor it

Name the requirement ids it bears on. Feedback floating free of the thing it
concerns is hard to act on and easy to lose.

---

## Rules

- **Every item gets a resolution eventually**, including "declined" and "noted".
  Feedback with no recorded outcome reads later as feedback that was ignored —
  and the client will remember raising it.
- **Repeated negative feedback in one area is a design problem**, not a defect
  queue. That is what `sentiment` is for.
- Capture even when you disagree. Especially then.
- Work on a branch. `.brain/` reaches `main` through a reviewed pull request.
