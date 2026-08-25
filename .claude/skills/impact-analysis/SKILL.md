---
name: impact-analysis
description: Traverse the requirement graph for a change record and report what it affects. Use on every change record, before the commercial decision.
allowed-tools: Read, Grep, Glob, Bash
---

# impact-analysis

Answers "what does this change actually touch?" from the record rather than from
memory — which is what turns regression scope from a judgement call into a
derived set.

**Invoke with a change record id**, e.g. `/impact-analysis CHG-0042`.

---

## 1. Read the change

`.brain/changes/CHG-NNNN.yaml`. Take its `affects` list as the starting set.

## 2. Walk the requirement graph

For each affected requirement, find every requirement whose `depends_on` names it
— then repeat for those, until nothing new appears. Those are the dependants: not
changing themselves, but resting on something that is.

## 3. Find the tests that are about to go stale

For each affected requirement, search the test files for `@covers <id>@v<n>`.

A test pinned to the version being superseded is **invalidated** — it was written
against text that no longer says the same thing. It does not necessarily fail; it
simply no longer proves what it claims. Gate G3 reports these as stale.

## 4. Report

```markdown
## Impact — CHG-0042

**Directly affected**   REQ-SHIFT-021 (v1 -> v2), REQ-NOTIF-004
**Dependants**          REQ-NOTIF-011 (depends on REQ-SHIFT-021)
**Tests invalidated**   4
  tests/notifications/cancel.spec.ts:12   @covers REQ-SHIFT-021@v1
  ...
**Still at draft**      REQ-NOTIF-011 cannot be re-agreed until its ambiguities close

### Regression scope
The tests covering the affected requirements and their dependants, plus the
usual baseline. Not the whole suite.

### Effort
<only if you can justify it from the above; otherwise say you cannot estimate>
```

## 5. Hand it to the commercial decision

Write the findings back into the change record's `analysis` block —
`dependants`, `tests_invalidated`, `estimate`.

**Leave `decision` and `commercial` alone.** Whether this is absorbed, varied,
deferred or declined is not yours to record.

---

## Rules

- **Report what the graph says, not what you assume.** If a requirement declares
  no `depends_on`, it has no recorded dependants — say that, rather than
  inferring relationships from the code.
- An incomplete graph produces a confident, wrong answer. If `depends_on` is
  largely empty across the requirement set, say so plainly: the analysis is only
  as good as the declarations.
- This is analysis, not action. Change no requirement and no test.
