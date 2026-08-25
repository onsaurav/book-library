# constraints/

Limits discovered in the wild — things that turned out not to be possible, or not
to be possible the obvious way.

## What belongs here

One file per constraint: `short-slug.md`. A constraint is something reality
imposed on you: a third-party API's rate limit, a browser behaviour, a
regulatory requirement, a legacy schema that cannot be changed.

The distinction from `decisions/`: a decision is a choice you made. A constraint
is a fact you found. If you could have chosen otherwise, it is a decision.

## Format

```markdown
# The billing provider rate-limits to 100 requests per minute per tenant

- **Discovered:** 2026-07-14
- **Review by:** 2027-01-14          <!-- MANDATORY -->
- **Source:** provider docs v4 §7.2; confirmed by support ticket #48812
- **Affects:** src/billing/**, REQ-SAMPLE-020

## The constraint
What the limit actually is, precisely. Numbers, not adjectives.

## How we know
Where this came from. A doc reference, a support answer, a measurement you took.
If it was measured, say how, so it can be re-measured.

## What we do about it
The workaround currently in place, and where it lives in the code.
```

## Rules

**Every constraint carries a review-by date.** This is the rule that matters.
Constraints expire: rate limits get raised, browsers ship the missing feature,
the legacy system is retired. A brain full of constraints that stopped being true
is worse than no record, because it quietly rules out approaches that would now
work perfectly well.

**Six to twelve months is a reasonable default.** Sooner if the source is a
third party under active development.

**When a review-by date passes, re-check and either extend it or delete the
file.** A constraint that no longer holds should leave a note in `rejected/` if
anything was built around it.

**Cite the evidence.** "The API is slow" is not a constraint. "p99 is 4.2s
measured over 10k calls on 2026-07-14" is.

## What does not belong here

Things you assume are true but have not verified. Check first — half of what
"everyone knows" about a third-party system is out of date.
