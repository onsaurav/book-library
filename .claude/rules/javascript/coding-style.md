# JavaScript — coding style

For projects that run plain `.js` with no build step. If the project compiles
TypeScript, `rules/typescript` applies instead — not both.

Mechanical rules are enforced by the lint command at gate G1. The rest are
enforced at review.

## No build step is a constraint, not a licence

A plain-JS project is chosen so the thing you run is the thing you wrote. That
only holds if nothing rewrites the source on its way to execution. No bundler, no
transpiler, no minifier in the path between `git clone` and `npm start`.

If a dependency needs a build step, the choice is to drop the dependency or to
stop being a plain-JS project. Do not add a build and keep calling it one.

## Types without a type system

The checker is gone; the discipline is not.

- **Every exported function carries a JSDoc block** with `@param` and `@returns`.
  It is the only contract a caller has.
- Run type checking anyway where the project allows it — `// @ts-check` at the
  top of a file, or `checkJs` — but **never introduce a `tsconfig.json` solely to
  satisfy tooling.** A JavaScript project is detected by its `package.json`.
- Validate at the boundary instead of trusting a signature. Anything from a
  request, a file or an environment variable is unknown until checked.

## Modules

- Pick CommonJS or ESM per project and never mix. Mixed module systems produce
  failures that only appear at runtime, in one environment.
- `'use strict';` at the top of every CommonJS file.
- No circular imports. If two modules need each other, a third module is missing.

## Naming

- `camelCase` for values and functions, `PascalCase` for constructors and
  classes, `UPPER_SNAKE_CASE` for module-level constants.
- Booleans read as assertions: `isOpen`, `hasOwner`, `canDelete`.
- **Names come from the glossary.** If the client says Book, the variable is
  `book`, not `item`, `record` or `entry`.

## Equality and coercion

- `===` and `!==` always. The single exception is `== null` to catch both `null`
  and `undefined`, and only when both are genuinely meant.
- No truthiness checks on values that can legitimately be `0`, `''` or `false`.
  Test the thing you actually mean: `if (count === 0)`, not `if (!count)`.
- `Number.parseInt` with an explicit radix. Never rely on implicit conversion.

## Immutability

- `const` by default; `let` only where reassignment is the point. Never `var`.
- Return new objects and arrays rather than mutating arguments. A function that
  edits what it was given has a second, undocumented return value.
- `Object.freeze` on exported constants that must not drift.

## Async

- `async`/`await` throughout. No mixing with `.then()` chains in the same
  function.
- Every promise is awaited or explicitly returned. A floating promise swallows
  its own rejection.
- Concurrent work uses `Promise.all`; sequential `await` in a loop is a
  deliberate choice, not an accident.

## Error handling

- `throw new Error(...)` with a message that says what failed and with what
  input. Never throw a string.
- Catch only what you can handle. A `catch` that logs and continues must say in a
  comment why continuing is correct.
- Never swallow an error to make a test pass.

## Prohibited

- `eval`, `new Function`, and string arguments to `setTimeout`.
- `process.exit()` outside a CLI entry point — it skips cleanup and makes the
  code untestable.
- `console.log` in production paths. Use the project's logger.
- Committed `.only` or `.skip` in tests.
