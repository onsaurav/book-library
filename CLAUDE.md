# <PROJECT NAME>

This file is a **router**. It holds no project knowledge itself — only where
knowledge lives and when to go and read it. Load what the task needs, not
everything.

Start with `.brain/index.md`. It maps the record and says when to read each part.

## Where to look

| If you are about to... | Read first |
|---|---|
| Use a domain term, or name anything | `.brain/glossary.md` — always, before writing |
| Write or change a requirement | `.brain/requirements/`, plus `CONVENTIONS.md` for the frozen id rules |
| Propose an approach | `.brain/rejected/` — before suggesting it, not after |
| Change architecture, or anything an ADR governs | `.brain/decisions/` |
| Assume something is possible | `.brain/constraints/` |
| Write a test | The requirement it covers. Annotate it `@covers REQ-<MODULE>-<NNN>@v<version>` |
| See which prompts changed files (not `/tdd`, not format) | `.claude/prompt-changes.md` |
| See requirement status (dashboard) | `.claude/reports/dashboard.html` and `dashboard.json` — kept current by hooks |

## Not negotiable

- **Never write to `.brain/` outside a reviewed pull request.** Not even a typo.
- **Never rename a requirement id** once its status is `agreed`.
- **Never resolve an ambiguity by choosing.** Record it. The client answers it.
- **Requirements and decisions are append-only.** Supersede, never rewrite.

## Commands

| Command | Use it when |
|---|---|
| `/decompose` | A client brief arrives, or scope changes. Produces requirements + ambiguities |
| `/resolve-ambiguities` | The client answered. Paste their reply into ANSWERS.md first |
| `/feature-plan REQ-...` | Starting a work item, before any code |
| `/tdd REQ-...` | Building an approved slice. Tests first, then the minimum code to go green |
| `/fix` | The build or a test is red. Repairs it — no new scope |
| `/find-variation` | An ask arrives that may be extra work. Decides in-scope vs chargeable |
| `/change-record` | Recording an agreed scope change |
| `/feedback-capture` | A client reacted to delivered work |
| `/impact-analysis CHG-...` | Before the commercial decision on a change |
| `/regression-select` | The full suite is too slow to run blind — derives which tests a `CHG` or `REQ` should re-run |
| `/adr-write` | A real choice between alternatives |
| `/pr-prepare` | Before opening a pull request |
| `/checkpoint` | End of a working session. Proposes brain updates as a pull request |
| `/verifyReq` | Any time you want the truth about the record — read-only |
| `/metrics` | "How are we doing?" or gate-promotion evidence |
| `/client-report` | Weekly update, milestone, or sign-off attachment |
| `/dashboard` | Open the visual project overview in a browser |
| `/librarian` | On request, or weekly — proposes brain edits, never writes them |

Not every command installs on every project: `install.js --profile` picks
`spine`, `delivery` (default) or `os`. See the toolkit's own README for what
each tier ships.

_Setup and run instructions go below — nothing else. Knowledge lives in `.brain/`._
