# TypeScript — coding style

Mechanical rules are enforced by the lint and build commands at gate G1. The rest
are enforced at review.

## Compiler settings

`strict: true` in `tsconfig.json`, plus `noUncheckedIndexedAccess`,
`noImplicitOverride` and `exactOptionalPropertyTypes`. These are not relaxed
per-project.

Type errors are build failures. `// @ts-ignore` is prohibited;
`// @ts-expect-error` is allowed only with a comment giving the reason, and it
fails the build once the error goes away — which is the point.

## Types

- **`any` is prohibited.** Use `unknown` and narrow it. `any` disables the
  checker silently and spreads through every value it touches.
- Never use `!` (non-null assertion). Narrow, or handle the absent case.
- Never use `as` to force an unrelated type. `as const` and narrowing casts after
  a type guard are fine.
- Prefer `type` for unions and function shapes, `interface` for object contracts
  that may be extended. Be consistent within a file.
- Discriminated unions rather than optional-field soups. If two states cannot
  coexist, the type should say so.
- Name types for the domain, using the exact term in `.brain/glossary.md`.

## Naming

| Element | Convention |
|---|---|
| Variables, functions, methods | `camelCase` |
| Types, interfaces, classes, enums, components | `PascalCase` |
| Module-level constants | `UPPER_SNAKE_CASE` |
| Files | `kebab-case.ts`; `PascalCase.tsx` for components |
| Hooks | `useCamelCase` |

Booleans read as assertions: `isActive`, `hasExpired`, `shouldRetry`, `canEdit`.

No Hungarian prefixes: not `IEngagement`, not `TProps`, not `_private`.

## Immutability

- `const` by default. `let` only when reassignment is genuine. Never `var`.
- `readonly` on interface properties and `readonly T[]` on array parameters.
- Never mutate a parameter, and never mutate an argument you were handed.
- Build new values with spread, `map`, `filter`, `toSorted`. Never `push`,
  `splice` or `sort` on shared state — `sort` mutates in place.
- `as const` for literal tables and configuration objects.

## Async

- `async`/`await` throughout. Never mix with `.then()` chains in one function.
- **No floating promises.** Every promise is awaited, returned, or explicitly
  marked `void`. Enable the lint rule; an unhandled rejection kills the process.
- `Promise.all` for independent work; sequential `await` only when order matters.
- `Promise.allSettled` when one failure must not cancel the rest.
- Never `async` on a function passed to `forEach` — it does not wait.

## Error handling

- Throw `Error` or a subclass. Never throw a string or an object literal.
- Never `catch {}`. Never catch merely to `console.log` and continue.
- `catch (e: unknown)` — narrow before use. A caught value is not an `Error`
  until proven.
- Errors crossing a boundary carry a message that is safe to show; the detail
  goes to the log with a correlation id.
- Expected failures are return values, not throws. Reserve throws for the
  genuinely exceptional.

## Modules and shape

- Named exports. Default exports rename themselves at every import site.
- No barrel `index.ts` re-exporting a whole directory — it defeats tree-shaking
  and creates import cycles.
- Files: 200–400 lines typical, **800 hard maximum**.
- Functions under 50 lines, nesting depth at most 4. Early returns.
- One React component per file.

## Prohibited

- `any`, `@ts-ignore`, `!` non-null assertion.
- `eval`, `new Function`, `setTimeout` with a string body.
- `console.log` in committed code. Use the project logger.
- `== `/`!=` — always `===` / `!==`.
- Enums with implicit numeric values. Prefer a `const` object with `as const`.
- Commented-out code.
