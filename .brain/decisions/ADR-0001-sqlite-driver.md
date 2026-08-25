# ADR-0001 — bookStore.js uses better-sqlite3

- **Status:** accepted
- **Date:** 2026-08-25
- **Governs:** src/store/**

## Context

REQ-BOOK-012 (agreed) fixes the Library's data store as SQLite. REQ-BOOK-008
(agreed) requires an added Book to be present in that store. Building either
means picking how Node talks to SQLite.

Node's built-in `node:sqlite` module would need no dependency at all, but does
not exist on Node 20.20.2 — the version installed in this environment — and
first shipped experimentally in Node 22.5. REQ-BOOK-014 and REQ-BOOK-016, which
would settle which Node version the client wants, are both still `draft`.
Waiting for that answer blocks REQ-BOOK-008 and REQ-BOOK-012 indefinitely, and
REQ-BOOK-015 (the dependency-count question) is open too, but SQLite itself is
already agreed — some driver is required regardless of how that answer lands.

## Decision

Use `better-sqlite3` as the runtime dependency behind `src/store/bookStore.js`.
Callers see only `listBooks()` / `addBook(details)`; nothing outside that module
references the driver.

## Alternatives considered

- **`node:sqlite`, targeting Node 22.5+.** No dependency, but commits to a Node
  version ahead of the client's own answer, and requires upgrading the only
  Node available in this environment (20.20.2) before anything can run.
- **In-memory stub, deferring real persistence to REQ-BOOK-012's own slice.**
  Keeps this slice dependency-free, but REQ-BOOK-008's own acceptance criterion
  — "the Book is stored in the server-side SQLite data store" — would not
  actually be proven by its tests. Rejected: a criterion a test cannot check is
  the exact failure `resolve-ambiguities` and `feature-plan` both exist to
  catch, and building a passing-but-unproven test here would be the same
  mistake wearing code instead of prose.
- **`sqlite3` (node-sqlite3), async/callback-based.** Same native-compile cost
  as `better-sqlite3` with a less convenient API for this app's small,
  synchronous read/write pattern.

## Consequences

Adds one runtime dependency with a native build step (`node-gyp`) to install —
a real cost if REQ-BOOK-015 is answered as "no third-party runtime packages at
all." If that happens, this ADR is superseded once a Node version supporting
`node:sqlite` is agreed; `bookStore.js`'s two-function interface should not
need to change at any call site.

Makes `src/store/bookStore.js` the only file that imports `better-sqlite3`,
so replacing it later is a one-file change.
