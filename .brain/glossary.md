# Glossary

Terms are **fixed** on this project. Use these words, spelled this way, and no
synonyms — in requirements, in code, in tests, in conversation with the client.

A term used in a requirement but not defined here is an **ambiguity**, not a
decision anyone may make on the client's behalf. Record it and ask.

---

## Why this file exists

A client described one thing three ways in a single meeting:

> "When a **job** comes in we assign it to a crew."
> "Each **engagement** has a start date and a purchase order."
> "The customer can cancel a **booking** up to 24 hours before."

Three words. The team built:

- a `Job` table for scheduling,
- an `Engagement` record for billing, because it "obviously" carried the PO,
- a `Booking` API for the customer-facing app.

They were the same entity. It was discovered in UAT, when cancelling a booking
left the job scheduled and the engagement billable. The fix touched three
schemas, two APIs and a migration — about three weeks — and none of it was
visible as a defect until real users produced all three views of one record.

**The cost was not the rework. It was that nobody could see it coming**, because
each team was individually consistent and the disagreement lived in the gaps
between them.

Pinning one word at discovery would have cost five minutes.

---

## How to write an entry

**Term** — what it means here, in one sentence. Then, where it matters:
- **Not to be confused with:** the near-synonym people reach for, and how it differs
- **Also called:** what the client says, when it differs from the agreed term
- **Identified by:** what makes two of these the same one

Define the term the *client's business* uses, not the one the database uses. If
they diverge, that divergence is itself worth writing down.

---

## Agreed terms

**Book** — a single entry in the Library, as entered by a user through the
Add Book form. Shown on a book card in the gallery.
- **Identified by:** its Book ID.
- Carries five fields named explicitly in the brief: Book ID, Name, Author,
  Language, Price.

**Library** — the full collection of Books, shown on the home page as a
gallery/grid of book cards.

**Book card** — the gallery tile for one Book, showing its Book ID, Name,
Author, Language and Price, plus a Delete option.

---

## Appears in source documents, not yet defined

List terms the client has used without settling what they mean. Being listed here
makes clear their absence is known, not overlooked. Each one should have a
matching question in `requirements/AMBIGUITIES.md`.

- **Book ID** — not stated whether it is system-generated (and how) or entered
  by the user. The brief lists it as a card field but not as an Add Book form
  field.
- **Name** — not stated whether this is the book's title, or something else
  (e.g. distinct from a "Title" field).
- **Language** — not stated whether this is a free-text field, or a
  constrained list of values.
- **Price** — no currency specified, and no statement of whether decimals or
  a minimum/maximum are expected.
- **Simple data store** — not stated what counts as "simple" (in-memory,
  flat file, embedded database) or whether data must survive a server
  restart.
