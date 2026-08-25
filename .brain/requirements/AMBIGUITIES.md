# Open questions for the client

Every point where the brief at `.brain/requirements/BRIEF.md` does not actually
settle what it appears to settle, phrased as a question you can answer in a
sentence.

**Nothing here has been decided.** Each question below is open, and each one
blocks the requirement it affects from moving past `draft`. The same list
appears in the `ambiguities` field of every requirement in `book.yaml`; the two
must not diverge.

Sentence numbers refer to the six sentences of the brief as recorded in
`BRIEF.md`.

Twenty-six questions were answered via message (Dhaka), 2026-08-25 — see
`ANSWERS.md` — and have been removed from this list. Three answers came back
too general to check against a test, and stay open below; see the report from
`/resolve-ambiguities` for what each one is still missing.

---

## What do "modern", "clean and attractive" and "user-friendly" require?

- **Affects:** REQ-BOOK-001, REQ-BOOK-002, REQ-BOOK-013
- **The document says:** "Create a simple and modern Book Library application"
  (BRIEF.md, sentence 1); "in a clean and attractive gallery/grid layout"
  (BRIEF.md, sentence 2); "provide a clean and user-friendly interface"
  (BRIEF.md, sentence 6).
- **Which could mean:**
  - (a) Ordinary tidy defaults are enough: consistent spacing, readable type, a
    card with a border.
  - (b) A specific look is expected — a brand, a colour palette, a font, cover
    images on the cards, hover and transition effects.
- **Question for the client:** What specifically makes the interface "modern",
  "clean and attractive" and "user-friendly" — is there a reference site, brand,
  or design you want it to look like?
- **Why it matters:** No test can check this as written, so it is the one thing
  most likely to be rejected at review after everything else passes. If (b) turns
  out to include cover images, that is a new field on every Book, an upload or
  URL path, and a different card layout — not a styling pass.
- **Still open because:** the 2026-08-25 reply ("a simple, clean, modern layout
  with clear controls, readable content, consistent spacing, and an attractive
  gallery") restates the same adjectives the brief already used, without naming
  a reference, a palette, a font, or any other detail a test could check either
  way.

## "Avoid unnecessary dependencies" — none at all, or an approved few?

- **Affects:** REQ-BOOK-015
- **The document says:** "avoid unnecessary dependencies" (BRIEF.md, sentence 6).
- **Which could mean:**
  - (a) Zero third-party runtime packages: only the Node.js standard library.
  - (b) A small number is fine as long as each one earns its place, with a
    framework such as Express being the usual example.
- **Question for the client:** Does "avoid unnecessary dependencies" mean no
  third-party runtime packages at all, or a small set you would approve one by
  one?
- **Why it matters:** (a) means a hand-written HTTP and static-file layer, which
  is more code to write and to review — and hand-rolled static file serving is a
  well-known source of security defects. (b) is faster to build but hands the
  client packages to patch and audit after handover. The two produce
  fundamentally different codebases, so this cannot be deferred.
- **Still open because:** the 2026-08-25 reply ("if the dependency is not
  necessary for the required functionality, it is not added") repeats the
  brief's own rule rather than saying which reading applies — both (a) and (b)
  are consistent with "don't add what isn't necessary". It does not say whether
  a framework such as Express would be approved.

## Node.js: which version, which framework, which port, and is there a build step?

- **Affects:** REQ-BOOK-014, REQ-BOOK-016
- **The document says:** "Create a simple and modern Book Library application
  using Node.js" (BRIEF.md, sentence 1); "easy to run on a local development PC"
  (BRIEF.md, sentence 6).
- **Which could mean:**
  - (a) Plain Node.js, served as written, started with one command and no build
    step.
  - (b) A framework and a front-end toolchain that compiles the source before it
    runs.
- **Question for the client:** Which Node.js version, which web framework (if
  any), which port, and should there be a build step before the application runs?
- **Why it matters:** "Easy to run" is only testable once there is a named
  command, a named port and a stated minimum Node.js version — otherwise it
  fails on the reviewer's machine and nobody can say whose fault that is. A build
  step also decides which of the project's coding-standard rule sets applies,
  which affects every source file.
- **Still open because:** the 2026-08-25 reply settles only one of the four
  parts — no build step. "Node.js LTS" names no version number, "a simple
  Node.js web framework" names no framework, and "a standard local development
  port" names no port. None of the three can be checked by a test as written.
