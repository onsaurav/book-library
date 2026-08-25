# JavaScript — testing

Run by the adapter's `test` command at gate G2, with coverage at the same gate.

## Framework

**`node:test`, built into Node 20.** It is the default for a plain-JS project
because it adds no dependency at all:

```json
{ "scripts": { "test": "node --test tests/" } }
```

This matters beyond tidiness. A project whose requirements forbid unnecessary
dependencies cannot answer for a test runner it did not need — and Node ships
one. Reach for Vitest or Jest only when something is genuinely required that
`node:test` lacks, and record the reason as an ADR rather than a preference.

**Playwright** for end-to-end, when there is a browser to drive.

## Traceability

Every test that verifies a requirement carries the annotation:

```js
// @covers REQ-SAMPLE-001@v1
test('requesting a missing record is refused', async () => { /* ... */ });
```

The version is mandatory and pins the test to the requirement text it was written
against. When the requirement's version moves, gate G3 reports the pin as stale —
re-read the new text before moving it, rather than bumping the number.

One requirement per annotation. To cover several, write several.

**Test files must sit where the adapter looks**: `*.test.js`, `*.spec.js`, or
anywhere under `tests/`. A test outside those patterns runs locally and is
invisible to G3, which is worse than having no test, because the gate reports
coverage it cannot see.

## Coverage

**80% line coverage minimum**, enforced at G2.

```
node --test --experimental-test-coverage tests/
```

Coverage is a floor, not a target. A file at 100% whose assertions check nothing
is worse than one at 70% that checks the behaviour that matters.

## Structure

Arrange, act, assert — in that order, with the arrangement visible in the test
rather than hidden in a shared fixture.

- No shared mutable state between tests. Each builds what it needs.
- `t.after()` for cleanup, so it runs even when the test throws.
- Temporary files go in a fresh directory per test and are removed afterwards.

## Naming

The test name states the behaviour, not the function:

```js
test('a Book with no Author is refused', ...)      // yes
test('validateBook returns false', ...)            // no
```

Someone reading the failure output should know what broke without opening the
file.

## Rules

- **Test behaviour through the public interface.** A test that reaches into
  module internals fails on every refactor and proves nothing about the contract.
- **Never assert on an implementation detail** — call counts, private fields,
  the order of an unordered collection.
- **A test that has never failed has not been verified.** Make it fail once
  deliberately before trusting it.
- **Fix the implementation, not the test**, unless the test itself is wrong — and
  if it is wrong, the requirement it cites probably needs re-reading.

## What not to write

- Tests for framework or standard-library behaviour.
- Snapshot tests of anything a human has not read.
- A test whose only assertion is that nothing threw.
