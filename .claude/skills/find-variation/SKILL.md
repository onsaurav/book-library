---
name: find-variation
description: Decide whether a client's new ask is inside agreed scope or a chargeable variation. Use on a BRD update, UAT feedback, or anything that might be scope creep.
allowed-tools: Read, Grep, Glob, Write, Task
---

# find-variation

Turns "is this extra work?" from an argument into a document comparison.

**Paste the client's ask when you invoke this**, or name the file it is in.

---

## 1. Capture what was actually said

Write it to `.brain/feedback/` first, verbatim, with who said it, where and when.
Use `/feedback-capture` if it is a reaction to delivered work.

If you triage before capturing, the wording gets summarised into the
classification and the evidence disappears — which is the one thing that settles
a dispute six weeks later.

## 2. Split it into asks

A paragraph often contains three separate requests. Judge each one separately:
they can land on different sides of the line, and bundling them means the whole
lot gets treated as whatever the loudest one is.

## 3. Ask `variation-agent` whether each is covered

Give it **only** the asks and the agreed requirement texts — never the
implementation plan, the code, or your own view of whether it "should" be
included. The barrier is the point: a reader who knows delivery would rather not
raise a variation will find scope generously.

It returns one verdict per ask: `covered`, `not-covered`, `partial` or
`contradicts`, each citing a requirement, version and criterion.

## 4. Turn coverage into a commercial classification

The agent judges the text. **You** combine that with whether the thing works:

| Agent says | Does it work today? | Classification | Who pays |
|---|---|---|---|
| `covered` | yes | **already-agreed** | nobody — show them the criterion |
| `covered` | no | **defect** | us |
| `not-covered` | — | **variation** | **client** |
| `contradicts` | — | **variation** | **client** — their own answer is the evidence |
| `partial` | — | **escalate** | a person decides, before anything is promised |

`preference` is the fifth outcome: covered and working, but they want it
different. It is not free and not chargeable until someone decides which.

Whether it works today comes from the tests that annotate the requirement, not
from an opinion. If no test covers it, say that — an untested criterion cannot
support a claim that it was delivered.

## 5. Draft a change record per variation

For each `variation`, write `.brain/changes/CHG-NNNN.yaml` using
`/change-record`, with `analysis`, `dependants` and `tests_invalidated` filled in
where `/impact-analysis` can derive them.

**Leave `decision:` and `commercial:` blank.** Absorbed, varied, deferred or
declined is not yours, and neither is the price.

## 6. Report

```
Asks              7
already-agreed    3   REQ-BOOK-001@v2 c2, REQ-BOOK-003@v1 c4, REQ-BOOK-003@v1 c7
defect            1   REQ-BOOK-002@v1 c3 — criterion exists, no passing test
variation         2   CHG-0004, CHG-0005 drafted
escalate          1   "sortable by author" — REQ-BOOK-001 requires a list,
                      says nothing about ordering. Both readings defensible.
duplicate         1   already raised as FB-0012 on 2026-08-02
```

---

## Rules

- **Every classification cites a requirement, version and criterion**, or states
  that nothing covers it and where you looked. A classification you cannot show
  the client is worthless.
- **`draft` is not agreed.** If the only thing covering an ask is a draft
  requirement, the ask is not covered — and the client has not agreed to it
  either.
- **Never decide the commercial outcome.** Classification carries commercial
  consequences and is always reviewed by a person.
- **Check for duplicates** in the feedback ledger and existing change records
  before drafting anything. The same ask arriving three times is one variation.
- Work on a branch. `.brain/` reaches `main` through a reviewed pull request.

## Why `ANSWERS.md` earns its keep

The strongest evidence in any scope dispute is the client's own recorded answer.
"No sign-in needed for this version" written in their words, dated, is what turns
a later login request from an argument into a variation nobody argues about.

That file is not admin. It is the commercial record.
