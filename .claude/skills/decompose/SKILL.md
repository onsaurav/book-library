---
name: decompose
description: Turn a client brief into atomic requirements plus an ambiguity register. Use at discovery, and again on every scope variation.
allowed-tools: Read, Grep, Glob, Write, Task
---

# decompose

Turns whatever the client gave you into structured requirements and an honest
list of everything they did not actually say.

**Paste the brief when you invoke this.** If you did not, ask for it and stop.

---

## 1. Record the brief unedited

Write the client's words, verbatim, to `.brain/requirements/BRIEF.md`:

```markdown
# Source brief

Received: <date>, from <who>, via <call | email | message>

> <their exact words>

<Anything else that was said, or "Nothing else was said.">
```

**Do not tidy it up.** The vagueness is evidence. When someone later asks "was
pagination ever mentioned?", this file is the answer.

If a brief already exists, append the new one under a dated heading rather than
replacing it.

## 2. Check the glossary

Read `.brain/glossary.md`.

If it is still the shipped template, or it does not define the terms this brief
uses, fill in what is genuinely settled and list the rest under **"Appears in
source documents, not yet defined"**. Do not invent definitions — an undefined
term is an ambiguity, not a gap for you to close.

## 3. Decompose

Invoke `spec-agent` with the brief. It writes:

- `.brain/requirements/<module>.yaml` — every requirement at `status: draft`,
  `version: 1`, ids allocated sequentially from the highest already used
- `.brain/requirements/AMBIGUITIES.md` — one section per open question

The module code comes from `.brain/install-state.json`. Never invent one.

## 4. Create the answer sheet

Write `.brain/requirements/ANSWERS.md` with a heading per question and space
beneath each:

```markdown
# Answers

Paste the client's reply here, under the question it answers. Their words, not
a summary. Then run `/resolve-ambiguities`.

## Is a Book a title, or a physical copy?

<their answer>
```

This is the file the client's reply lands in, and it is what `/resolve-ambiguities` reads to
write the acceptance criteria and clear the questions. Keeping it means the
wording behind every criterion stays in the repository.

## 5. Report, honestly

State: how many requirements, how many ambiguities, and which requirement's
`source` you were least confident about.

**If fewer than five ambiguities came back, the decomposition was too shallow.**
A twelve-word brief hides more than four questions. Say so and run it again
rather than presenting it as finished.

---

## Rules

- **Nothing reaches `agreed`.** Everything stays `draft` until the client answers
  its ambiguities. You do not have the authority to close one, and neither does
  the developer.
- **Never resolve an ambiguity by choosing** the obvious reading, the common
  convention, or the easier build. Record it.
- **Write only inside `.brain/requirements/`.**
- **Work on a branch**, never on `main`. `.brain/` changes reach `main` through a
  reviewed pull request.

## Then what

Send `AMBIGUITIES.md` to whoever can answer it — the questions as written, not a
summary.

When the reply comes back, paste it into `.brain/requirements/ANSWERS.md` and run
`/resolve-ambiguities`. That writes the acceptance criteria, clears the answered questions
from both files, and moves whatever is now unambiguous to `agreed`.

Building starts after that, not before.
