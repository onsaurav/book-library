# C# — coding style

Mechanical rules are enforced by `dotnet format --verify-no-changes` and
`dotnet build -warnaserror` at gate G1. The rest are enforced at review.

Where C# idiom differs from the general principle, **this file wins**.

## Naming

| Element | Convention |
|---|---|
| Types, methods, properties, events | `PascalCase` |
| Interfaces | `IPascalCase` |
| Parameters, locals | `camelCase` |
| Private fields | `_camelCase` |
| Constants, `static readonly` | `PascalCase` — **not** `UPPER_SNAKE_CASE` |
| Async methods | `PascalCase` with an `Async` suffix |

That constant rule is a deliberate departure from the cross-language default.
`SCREAMING_CASE` in C# reads as ported code.

Booleans read as assertions: `IsActive`, `HasExpired`, `CanRetry`.

Name for the domain, using the exact term from `.brain/glossary.md`. A class
called `EngagementManager` names nothing — say what it does.

## Nullability

`<Nullable>enable</Nullable>` in every project. This is not optional and is not
suppressed per-file.

- Never write `!` (null-forgiving) without a comment on the same line saying why
  it is safe. If you cannot write that comment, the code is wrong.
- Prefer `is null` / `is not null` over `== null`.
- Validate at the boundary, not repeatedly inside. Once past validation, a
  non-nullable parameter is non-null.

## Immutability

Default to immutable. Mutability is a decision that needs a reason.

- `record` (or `record struct`) for data that has no identity beyond its values.
- `init` accessors rather than public setters.
- `readonly` on every field that is not reassigned; `readonly struct` where it applies.
- Expose `IReadOnlyList<T>` / `IReadOnlyDictionary<K,V>`, never `List<T>`.
- Never mutate a parameter. Return a new value.
- `with` expressions for derived copies.

## Async

- Async all the way down. Never `.Result`, `.Wait()`, or `.GetAwaiter().GetResult()` —
  they deadlock under a synchronisation context and hide the failure.
- Every async method that can be cancelled accepts a `CancellationToken` and
  passes it on.
- `ConfigureAwait(false)` in library code. Not needed in ASP.NET Core apps.
- No `async void` except event handlers. It cannot be awaited and its exceptions
  cannot be caught.
- `Task.WhenAll` for independent work; sequential `await` only when order matters.

## Error handling

- Exceptions are for the exceptional. Expected failures — not found, invalid
  input, conflict — are return values, not throws.
- Never `catch (Exception)` without rethrowing. Never `catch { }`.
- `throw;` to rethrow. `throw ex;` destroys the stack trace.
- Throw the most specific type that fits. `ArgumentNullException.ThrowIfNull` for
  argument guards.
- Exception messages state what failed and with which input. Never a secret, a
  token, or personal data.
- Never use exceptions for control flow.

## Size and shape

- Files: 200–400 lines typical, **800 hard maximum**.
- Methods under 50 lines. Longer means it is doing more than one thing.
- Maximum nesting depth 4. Use guard clauses and early returns.
- One public type per file, and the file is named for it.
- `var` when the type is obvious from the right-hand side; the explicit type when
  it is not.
- File-scoped namespaces.

## Prohibited

- `#region` — it hides length instead of fixing it.
- `dynamic`, except at a genuine interop boundary with a comment.
- Public mutable static state.
- `Console.WriteLine` for logging. Use `ILogger` with structured properties.
- Commented-out code. Git remembers it; the file should not.
- `DateTime.Now` — use `DateTimeOffset.UtcNow`, or an injected clock so it can be
  tested.
