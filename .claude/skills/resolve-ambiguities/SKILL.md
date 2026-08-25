---
name: resolve-ambiguities
description: Apply the client's answers to the ambiguity register. Reads ANSWERS.md, writes acceptance criteria, removes the answered questions, and moves requirements to agreed.
allowed-tools: Read, Grep, Glob, Write
---

# resolve-ambiguities

Turns the client's reply into acceptance criteria, and clears the questions it
answers — across both files, in one pass.

**Input:** `.brain/requirements/ANSWERS.md`. Paste the client's reply into it,
raw, and run this. If the file is missing or empty, say so and stop.

---

## 1. Read what is open

- `.brain/requirements/AMBIGUITIES.md` — the questions as the client saw them
- `.brain/requirements/<module>.yaml` — the same questions on each requirement
- `.brain/requirements/ANSWERS.md` — what came back

## 2. Match each answer to its question

The client will not answer in your order, will answer several at once, and will
answer some questions you did not ask.

- One reply may close several questions. Apply it to all of them.
- A reply that closes no question is **not** an answer — it is new information.
  Leave it in `ANSWERS.md` and report it; it may need `/change-record`.
- **A question with no matching answer stays open.** Never infer one from
  context, from what is easier to build, or from the client's silence.

## 3. For each answered question

**a. Write the answer as an acceptance criterion** on every requirement it
affects. Given/when/then, and the `then` must name something a test can check.

The criterion must be *falsifiable by the other reading*. "A Book is a title,
not a copy" becomes:

```yaml
- given: The same title has been added twice
  when: The home page is opened
  then: That title is shown once, not twice
```

If the answer forced no observable difference, it did not answer anything —
report it as still open.

**b. Delete the question** from that requirement's `ambiguities:` list.

**c. Delete its section** from `AMBIGUITIES.md`.

**d. Append to `source:`** where the answer came from —
`; clarified by <channel> <date>`, taken from `ANSWERS.md`.

## 4. Move what is now clear

A requirement whose `ambiguities:` list is empty moves `draft` → `agreed`.

Nothing else changes status. A requirement with one question left stays `draft`,
however small that question looks.

## 5. Report

```
Answered   14 of 20
Agreed     REQ-BOOK-002, REQ-BOOK-004
Still open REQ-BOOK-001 (3), REQ-BOOK-003 (3)
           - What fields does a Book consist of?
           - ...
Not a question anyone asked
           - "We'll also want CSV export eventually" -> consider /change-record
```

Then re-run the validator. A requirement at `agreed` with anything left in
`ambiguities` is refused, and that is the check this skill exists to satisfy.

---

## Rules

- **Never answer a question yourself.** Not from the codebase, not from
  convention, not from what the client probably meant. Unanswered stays open.
- **Keep `ANSWERS.md`.** It is the record of what was said and when. Do not
  delete answered sections from it — only from `AMBIGUITIES.md`.
- **Requirement ids never change here.** If an answer means a requirement should
  not exist, say so and stop; deleting an agreed requirement is a change record.
- Work on a branch. `.brain/` reaches `main` through a reviewed pull request.
