# The brain

The project record. Not documentation — the reason things are the way they are.

**Read the part you need, when you need it.** Reading all of this at the start of
every task is the failure mode this file exists to prevent.

| Directory | Holds | Read it when |
|---|---|---|
| `requirements/` | Requirements as structured YAML, plus `AMBIGUITIES.md` | Before building anything, before agreeing scope, before writing a test |
| `decisions/` | `ADR-NNNN` — architectural choices and why | Before changing anything the decision governs. Each ADR names the code paths it covers |
| `rejected/` | Approaches tried and abandoned, **with the reason** | Before proposing an approach. Check here FIRST |
| `constraints/` | Discovered limits, each with a review-by date | Before assuming something is possible |
| `changes/` | `CHG-NNNN` — scope variations against agreed requirements | When scope moves, or when asked why a requirement changed |
| `feedback/` | `FB-NNNN` — what the client said about delivered work | Before a review, and when planning the next increment |
| `sessions/` | Working session notes, newest last | Rarely. Only to reconstruct how something came about |
| `glossary.md` | What each domain term means here | **First, always**, before writing any requirement or naming anything |

## The rules that keep this useful

**Nothing here is written automatically.** Every addition arrives as a reviewed
pull request. Auto-committed records compound errors: cheap to review one at a
time, unrecoverable once a hundred have piled up unchecked.

**Requirements and decisions are append-only.** A record that is wrong is
superseded, never edited and never deleted. Mark the old one
`superseded by ADR-NNNN` and leave it where it is. The wrong turn is often more
useful than the right answer.

**Identifiers are frozen.** `REQ-`, `CHG-`, `ADR-` and `FB-` numbers are never
reused, renumbered or renamed. See `CONVENTIONS.md` in the repository root.

**Ambiguities are resolved by the client, never by an agent choosing a reading.**
An open ambiguity blocks a requirement from reaching `agreed`.

## Before you add anything

1. Does it belong in exactly one of the directories above? If it fits two, it is
   probably two records.
2. Would a new person joining in six months need it? If not, leave it out.
3. Does it record *why*, not just *what*? The what is in the code already.

A thin, accurate brain beats a thorough one nobody trusts.
