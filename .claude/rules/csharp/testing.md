# C# — testing

Run by `dotnet test` at gate G2, with coverage from
`dotnet test --collect:"XPlat Code Coverage"`.

## Framework

- **xUnit** for unit and integration tests.
- **FluentAssertions** for assertions — failure messages name the expectation.
- **NSubstitute** for test doubles.
- **Testcontainers** for anything needing a real database or broker. Do not mock
  a database and call the result an integration test.
- **WebApplicationFactory** for API-level tests.

## Traceability

Every test that verifies a requirement carries the annotation:

```csharp
// @covers REQ-SAMPLE-001@v1
[Fact]
public void RequestingAMissingRecordIsRefused() { }
```

The version is mandatory and pins the test to the requirement text it was
written against. When a requirement's version moves, gate G3 reports the pin as
stale — re-read the new text before moving it, rather than bumping the number.

One requirement per annotation. To cover several, write several.

## Coverage

**80% line coverage minimum**, measured per project, enforced at G2.

Coverage is a floor, not a goal. 80% of meaningful assertions beats 100% of
executed lines. A test that raises coverage without being able to fail is worse
than no test — it makes the gate report safety that is not there.

Untestable code is a design problem. Do not lower the threshold to accommodate it.

## Structure

Arrange–Act–Assert, with the three parts visually separated:

```csharp
// @covers REQ-SAMPLE-014@v2
[Fact]
public async Task CancellingInsideTheWindowIsRefused()
{
    var engagement = AnEngagement.StartingIn(TimeSpan.FromHours(12));

    var result = await _service.CancelAsync(engagement.Id, CancellationToken.None);

    result.Should().BeOfType<CancellationRefused>();
}
```

## Naming

The method name states the behaviour, not the mechanism:

- `CancellingInsideTheWindowIsRefused`
- `RequestingAMissingRecordReturnsNotFound`

Not `TestCancel`, `Cancel_Test_2`, or `ShouldWork`.

## Rules

- **One behaviour per test.** Several assertions are fine when they describe one
  outcome; two `Act` steps are two tests.
- **No logic in tests.** No `if`, no `foreach` building expectations, no
  calculating the expected value with the same code being tested. Use `[Theory]`
  with `[InlineData]` for variation.
- **No shared mutable state between tests.** Each test constructs what it needs.
  Tests must pass in any order and in parallel.
- **Build test data with builders**, not by copying a 20-line object initialiser
  into every test. A builder named `AnEngagement` reads as the intent.
- **Assert on behaviour, not on calls.** Verifying a mock was called proves your
  implementation matches itself. Prefer asserting the observable outcome.
- **Never assert on an exception message string.** Assert on the type.
- **A failing test is fixed by fixing the code**, unless the test is provably
  wrong — in which case say so in the pull request.

## Integration tests

- Cover every API endpoint's success case, its authorisation failure, and its
  primary validation failure.
- Run against a real database via Testcontainers, migrated from scratch.
- Never share a database between tests running in parallel.

## What not to write

- Tests for framework behaviour. ASP.NET routing is already tested.
- Tests for auto-properties.
- Snapshot tests of large objects where nobody reads the diff.
