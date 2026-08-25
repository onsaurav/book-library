# JavaScript — security

Every item here is a **blocking** review finding, not a suggestion. If one is
found after merge, treat it as an incident: fix, then rotate anything exposed.

Plain JavaScript loses the compiler, so nothing here is caught for you. These are
all review and gate findings.

## Secrets

- **Never** commit a secret. Not in `.env`, not in a config file, not in a test
  fixture, not "temporarily". `.env` is git-ignored; `.env.example` holds keys
  with empty values and is committed.
- **Never put a secret in anything served to the browser.** In a plain-JS app the
  boundary is the directory you serve statically — a key in `public/app.js` is
  public, whatever it is named.
- Validate required environment variables at startup and refuse to boot if one is
  missing. Read them once, in one module, rather than `process.env.X` in twenty
  places.
- A secret that reached a commit is compromised. Rotate it. Removing it from the
  working tree does not remove it from history.

## Input validation

- Validate at every boundary. Without a type system the only thing standing
  between a request body and your data is the check you wrote.
- Never trust a client, including your own front end. Re-validate on the server
  what the browser already validated.
- Never spread a caller-supplied object into a stored record. Copy the fields you
  expect, by name. Anything else lets a caller set fields you never exposed.
- Reject unknown fields rather than ignoring them, so a rename fails loudly
  instead of silently dropping data.

## Serving files

A hand-rolled static file server is the most common place a plain-JS project goes
wrong.

- **Resolve, then verify containment.** Join the request path to the root,
  `path.resolve` it, and refuse anything that does not start with the resolved
  root. `..` in a URL is the oldest attack there is, and stripping it with a
  regular expression does not work — the encoded forms get through.
- Serve from an allow-list of extensions with explicit `Content-Type` headers.
  Never infer a type from a caller-supplied string.
- Refuse dotfiles and symlinks that escape the root.

## Injection

- Parameterised queries only. Never build SQL, a shell command or a file path by
  concatenating input.
- `child_process.execFile` with an argument array, never `exec` with an
  interpolated string.
- No dynamic code from data: `eval`, `new Function`, and string `setTimeout` are
  prohibited in `coding-style.md` for this reason.

## Cross-site scripting

- Build the DOM with `textContent` and `createElement`. **`innerHTML` with any
  value that came from a user or a store is a blocking finding** — and in a
  library application, the Book title came from a user.
- If HTML genuinely must be rendered, sanitise it with a maintained library and
  record the decision as an ADR.
- Set a Content-Security-Policy. `default-src 'self'` costs nothing on an app
  with no third-party assets.

## Errors and transport

- Never return a stack trace, a file path or an internal error message to a
  caller. Log the detail; return a correlation id.
- Cookies: `httpOnly`, `secure`, `sameSite: 'lax'` or stricter.
- HTTPS wherever the application is reachable beyond localhost.

## Dependencies

- Commit the lockfile; never float on a range in production.
- `npm audit` runs in CI.
- A new dependency is a review decision — check its age, maintenance and
  transitive weight before adding it. In a project whose requirements say to
  avoid unnecessary dependencies, adding one is a scope question, not a
  preference.
- Never run a `postinstall` script from a package you have not reviewed.
