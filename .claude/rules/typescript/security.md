# TypeScript — security

Every item here is a **blocking** review finding, not a suggestion. If one is
found after merge, treat it as an incident: fix, then rotate anything exposed.

## Secrets

- **Never** commit a secret. Not in `.env`, not in a config file, not in a test
  fixture, not "temporarily". `.env` is git-ignored; `.env.example` holds keys
  with empty values and is committed.
- **Never put a secret in anything the client bundles.** A variable prefixed
  `NEXT_PUBLIC_` / `VITE_` / `REACT_APP_` is shipped to the browser and readable
  by anyone. This is the single most common way an API key leaks.
- Server secrets are read server-side only — in a route handler, a server
  component, or an API layer. Never imported into a module that a client
  component also imports.
- Validate required environment variables at startup and refuse to boot if one is
  missing. Parse them through a schema, once, rather than reading
  `process.env.X` in twenty places.
- A secret that reached a commit is compromised. Rotate it. Removing it from the
  working tree does not remove it from history.

## Input validation

- Validate at every boundary with a schema — **zod** — and derive the TypeScript
  type from the schema rather than declaring both. A hand-written type over
  unvalidated input is a lie the compiler believes.
- Every API route parses its body, query and params before use. Never trust a
  client, including your own front end.
- Never spread caller-supplied objects into a database write. That is how a
  caller sets a field you forgot existed.
- Constrain length, range and format on every string that reaches storage.
- Validate uploads by content type and size; never use the caller's filename as
  a path.

## Injection

- **Parameterise every query.** Never build SQL by template literal. Prisma,
  Drizzle and Kysely parameterise by default; their raw escape hatches
  (`$queryRawUnsafe`, `sql.raw`) do not.
- Never pass caller input into a table name, a column name, or an `ORDER BY`.
  Map it through an allow-list.
- Never pass caller input to `exec`, `spawn` with a shell, or a file path without
  resolving and confirming it stays inside the intended directory.

## Cross-site scripting

- React and Vue escape by default. `dangerouslySetInnerHTML` and `v-html` do not.
- Never pass caller-supplied content to either without sanitising it through
  DOMPurify first — and prefer not passing it at all.
- Never build DOM with `innerHTML`. Never `eval`, `new Function`, or a string
  body in `setTimeout`.
- Validate that a caller-supplied URL is `http:` or `https:` before rendering it
  in an `href`. `javascript:` URLs execute.
- Set a `Content-Security-Policy`. It is the control that limits the damage when
  one of the above is missed.

## Authorisation

- Deny by default. Check authorisation in the route handler or server action —
  **never only in the UI.** Hiding a button hides nothing.
- **Check ownership, not just authentication.** A signed-in caller requesting
  `/api/engagements/[id]` must be shown to have a right to *that* engagement.
  Missing object-level checks are the most common serious defect in a working API.
- Never accept a client-supplied user id, tenant id, or role. Take it from the
  validated session or token.
- Server actions and route handlers are public endpoints. Treat them as such,
  regardless of which component calls them.

## Sessions and transport

- Cookies: `httpOnly`, `secure`, `sameSite: 'lax'` or stricter. A token in
  `localStorage` is readable by any script that gets injected.
- HTTPS only, HSTS enabled.
- Never return a stack trace or a database error to a caller. Log the detail;
  return a correlation id.

## Dependencies

- `npm audit` runs in CI. Commit the lockfile; never float on a range in
  production.
- A new dependency is a review decision. Check its age, maintenance and transitive
  weight before adding it.
- Never run a `postinstall` script from a package you have not reviewed.
