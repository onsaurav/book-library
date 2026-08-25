# requirements/

What the client agreed to, as structured data a machine can check.

## What belongs here

- `<module>.yaml` — one file per module, lowercased module code. An array of
  requirement objects conforming to `schema/requirement.schema.json`.
- `AMBIGUITIES.md` — every point where a source document does not actually say
  what it appears to say, phrased as a question for the client.

## Format

Validated by `scripts/validate-requirements.js`, which runs as gate G3. See
`schema/requirement.example.yaml` for a fully populated example.

```yaml
- id: REQ-SAMPLE-001          # frozen once status reaches `agreed`
  title: ...                  # 10-120 chars
  module: SAMPLE              # must match the id segment
  priority: must              # must | should | could | wont
  status: draft               # draft -> agreed -> in_progress -> verified -> signed_off
  version: 1
  source: ...                 # BRD section, call date — something checkable
  acceptance:                 # at least one; `then` must be observable
    - given: ...
      when: ...
      then: ...
```

## Rules

**Ids are frozen.** Never reused, renumbered or renamed once `agreed`. A
requirement that changes meaning gets a new `version`, not a new id. Incrementing
the version resets status to `draft` and appends the old state to `history`.

**An open ambiguity blocks `draft -> agreed`.** The `ambiguities` list must be
empty. Ambiguities are closed by the client answering them — never by an agent,
or anyone else, choosing the reading that is easier to build.

**`verified` requires evidence.** At least one `verified_by` entry, pointing at a
test that annotates the requirement at its current version.

**The YAML and `AMBIGUITIES.md` are two views of one list.** They must not
diverge.

## What does not belong here

Design, implementation notes, or how something will be built. A requirement says
what must be true, not how. Put the how in `decisions/`.
