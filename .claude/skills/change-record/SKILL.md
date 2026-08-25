---
name: change-record
description: Capture a scope change or discovered constraint as a structured record, and version the requirements it affects. Use on any deviation from the agreed position.
allowed-tools: Read, Grep, Glob, Write
---

# change-record

The client asked for something different, or reality contradicted a requirement.
This turns that into a dated record instead of a conversation nobody can produce
later.

**Paste what was said, and who said it.**

---

## 1. Which stream is this?

Conflating these is the most common source of scope confusion.

| Stream | Origin | Treatment |
|---|---|---|
| `scope_change` | The client asked for something different from what was agreed | New record, requirement version increment, commercial assessment |
| `discovered_constraint` | Technical or vendor reality contradicts what a requirement assumes | Constraint recorded, affected requirements re-opened, client informed with options |
| `feedback` | Reaction to work already delivered | Use `/feedback-capture` instead — it triages first |

## 2. Allocate the id

Read `.brain/changes/`, take the next number after the highest. `CHG-NNNN`, four
digits, sequential project-wide, never reused.

## 3. Write the record

To `.brain/changes/CHG-NNNN.yaml`:

```yaml
id: CHG-0042
raised: 2026-07-24
stream: scope_change
source: "Client call, 24 Jul, operations manager"
raw: "We also need the coordinator cc'd on cancellations, not just the worker."
affects: [REQ-SHIFT-021, REQ-NOTIF-004]
analysis:
  dependants: [REQ-NOTIF-011]     # from depends_on across the requirement set
  tests_invalidated: 4            # tests pinned to the version being superseded
  estimate: "6h build, 2h verification"
decision: varied                  # absorbed | varied | deferred | declined
commercial: "Variation 3, approved by email 26 Jul"
outcome:
  - REQ-SHIFT-021: v2
  - REQ-NOTIF-004: unchanged
```

`raw` is the client's exact words. Never paraphrase it — that is the field that
settles the argument six weeks later.

## 4. Version the requirements, never edit them

For each affected requirement, in its YAML:

1. Increment `version`.
2. Append the previous state to `history` with `superseded_by: CHG-NNNN` and a
   one-line summary of what it used to say.
3. Reset `status` to `draft`. It has to be re-agreed.

A silently rewritten requirement makes an agent reason confidently from a history
that never happened, and lets a client conclude scope moved without agreement.

## 5. Report the blast radius

State which requirements changed version, which tests are now pinned to a
superseded version (gate G3 will report them as stale), and what re-work follows.

Leave `decision` and `commercial` blank if the commercial call has not been made.
**Do not guess at it.**

---

## Rules

- **A requirement version never moves without a change record.** The gap between
  the two is a governed metric — uncaptured change means scope is being agreed
  verbally.
- **Record declined and deferred changes too.** A change the client asked for and
  withdrew is exactly what gets misremembered.
- Work on a branch. `.brain/` reaches `main` through a reviewed pull request.
