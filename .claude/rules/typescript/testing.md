# TypeScript — testing

Run by the adapter's `test` command at gate G2, with coverage at the same gate.

## Framework

- **Vitest** for unit and component tests. Jest is acceptable in a project
  already committed to it; do not run both.
- **Playwright** for end-to-end and API tests.
- **Testing Library** for component tests — query by role and accessible name,
  never by CSS class or test id unless nothing else identifies the element.
- **MSW** to stub HTTP at the network boundary rather than monkey-patching
  `fetch`.

## Traceability

Every test that verifies a requirement carries the annotation. Two forms are
recognised:

```ts
// @covers REQ-SAMPLE-001@v1
test('requesting a missing record is refused', async () => { /* ... */ });
```

```ts
test('...', async () => {
  test.info().annotations.push({ type: 'covers', description: 'REQ-SAMPLE-001@v1' });
});
```

The version is mandatory and pins the test to the requirement text it was written
against. When the requirement's version moves, gate G3 reports the pin as stale —
re-read the new text before moving it, rather than bumping the number.

One requirement per annotation. To cover several, write several.

## Coverage

**80% line coverage minimum**, enforced at G2.

Coverage is a floor, not a goal. A test that raises coverage without being able
to fail is worse than no test: it makes the gate report safety that is not there.
Rendering a component and asserting nothing is the most common example.

Untestable code is a design problem. Do not lower the threshold to accommodate it.

## Structure

Arrange–Act–Assert, visually separated:

```ts
// @covers REQ-SAMPLE-014@v2
test('cancelling inside the window is refused', async () => {
  const engagement = anEngagement({ startsIn: hours(12) });

  const result = await cancel(engagement.id);

  expect(result).toEqual({ status: 'refused', reason: 'inside-window' });
});
```

## Naming

The name states the behaviour in plain language:

- `'cancelling inside the window is refused'`
- `'returns an empty list when no records match'`

Not `'works'`, `'test cancel'`, or `'should be ok'`.

## Rules

- **One behaviour per test.** Several assertions describing one outcome are fine;
  two acts are two tests.
- **No logic in tests.** No `if`, no loops building expectations, no recomputing
  the expected value with the code under test. Use `test.each` for variation.
- **No shared mutable state.** Each test builds what it needs. Tests must pass in
  any order and in parallel. Beware module-level state that survives between them.
- **Build test data with factories**, not by copying a large object literal into
  every test.
- **Assert on behaviour, not on calls.** Verifying a mock was called proves the
  implementation matches itself.
- **Fake timers over real waits.** Never `await sleep(2000)` — that is how a
  suite becomes slow and flaky at once.
- **A failing test is fixed by fixing the code**, unless the test is provably
  wrong, which must be argued in the pull request.

## End-to-end

- Cover the critical user journeys, not every screen. E2E is the most expensive
  and most brittle layer; spend it where failure would be worst.
- Never depend on test execution order or on data another test created.
- Use Playwright's auto-waiting locators. Never a fixed timeout to "let it
  settle".
- A test that fails intermittently is quarantined and fixed, never re-run until
  green. Re-running is how a real defect gets classified as flakiness.

## What not to write

- Tests for the framework. React rendering is already tested.
- Snapshot tests of large trees. Nobody reads the diff, so they get accepted
  blindly and assert nothing.
- Tests asserting implementation details — internal state, private functions,
  call counts.
