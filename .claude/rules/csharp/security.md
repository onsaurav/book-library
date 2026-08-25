# C# — security

Every item here is a **blocking** review finding, not a suggestion. If one is
found after merge, treat it as an incident: fix, then rotate anything exposed.

## Secrets

- **Never** commit a secret. Not in `appsettings.json`, not in
  `appsettings.Development.json`, not in a launch profile, not in a test fixture,
  not "temporarily".
- Development: `dotnet user-secrets`. Production: environment variables or Azure
  Key Vault. Never a file in the repository.
- Validate at startup that every required secret is present, and fail to start if
  one is missing. A service that boots with a missing secret and fails later is
  harder to diagnose than one that refuses to start.
- A secret that reached a commit is compromised. Rotate it. Removing it from the
  working tree does not remove it from history.
- Never log a secret, a token, a connection string, or a full request body that
  might contain one.

## SQL and injection

- **Parameterise everything.** Never build SQL by concatenation or interpolation.
- EF Core LINQ is parameterised by default. `FromSqlRaw` and `ExecuteSqlRaw` are
  not — use `FromSqlInterpolated` / `ExecuteSqlInterpolated`, which are.
- Never pass user input into a raw SQL fragment, a table name, or an `ORDER BY`
  clause. If a column must be caller-selected, map it through an allow-list.
- The same rule applies to LDAP filters, shell arguments, and file paths.

## Input validation

- Validate at the boundary — the controller or endpoint — before anything else
  runs. Never trust a client, including your own front end.
- Bind to a request DTO with explicit properties. Never bind directly to an
  entity: that is how a caller sets `IsAdmin` on a field you forgot existed.
- FluentValidation or DataAnnotations, applied consistently. Validation failures
  return 400 with the offending field named, and nothing else.
- Constrain length, range and format on every string that reaches storage.
- Validate file uploads by content, not by extension. Cap the size. Never use the
  caller's filename as a path.

## Authorisation

- Deny by default. Register a fallback policy requiring an authenticated user, so
  a new endpoint is protected before anyone remembers to think about it.
- `[Authorize]` on the controller, `[AllowAnonymous]` as the deliberate exception.
- **Check ownership, not just authentication.** A signed-in caller requesting
  `/engagements/{id}` must be shown to have a right to *that* engagement. Missing
  object-level checks are the most common serious defect in a working API.
- Never accept a client-supplied user id, tenant id, or role. Take it from the
  validated token.

## Output and responses

- Never return a stack trace, a SQL error, or an inner exception message to a
  caller. Log the detail; return a correlation id.
- Error responses must not reveal whether a record exists to someone not
  authorised to see it — return the same response for "absent" and "forbidden"
  where enumeration matters.
- Razor encodes by default. `@Html.Raw` and `MarkupString` do not — never pass
  caller-supplied content to either.
- Set `Content-Security-Policy`, `X-Content-Type-Options: nosniff` and HSTS.

## Cryptography and data

- Never invent a scheme, and never use MD5 or SHA-1 for anything security-bearing.
- Passwords: ASP.NET Core Identity's hasher, or Argon2id. Never a bare hash.
- `RandomNumberGenerator` for anything a caller must not predict. Never `Random`.
- HTTPS only. HSTS enabled. No certificate validation callback that returns true.
- Personal data is minimised, and is never written to logs or to a test fixture.

## Dependencies

- `dotnet list package --vulnerable --include-transitive` runs in CI.
- Pin versions. Do not float on a wildcard.
- A new third-party package is a review decision, and belongs in
  `.brain/decisions/` when it constrains anything.

## Deserialisation

- `System.Text.Json` with an explicit contract. Never `TypeNameHandling.All`
  under Newtonsoft, and never `BinaryFormatter` — both execute types the caller
  chooses.
