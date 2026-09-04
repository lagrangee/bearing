# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`.

Provider contract: `matt-skills/v1`

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- Provider-native scope is the feature directory `.scratch/<feature-slug>/`; its PRD, Map, and
  issues are native subjects inside that scope.
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Delivery operations

Used for implementation issues created by `/to-tickets`.

### Canonical Local Delivery shape

The `/to-tickets` Local ticket template is the base schema. Preserve this Markdown preamble when
creating or updating a Delivery:

```markdown
# <NN> — <Ticket title>

**What to build:** <the accepted delivery outcome>

**Blocked by:** <ticket references, or None — can start immediately>

**Status:** <current triage state>

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
```

Keep the title, `What to build`, `Blocked by`, `Status`, and acceptance checklist in the Markdown
preamble before any `##` authored section. Additive `## Comments` or `## Answer` sections follow
that base shape.

- Completion: when the accepted work and its checks are complete, append the truthful result under
  an `## Answer` heading and set `Status: resolved`.
- Human implementation handoff: set `Status: ready-for-human` only when implementation remains for
  the Human. This is nonterminal and is reported as a handoff, not completion.

## Wayfinding operations

Used by `/wayfinder`. The map is a file with one child file per ticket.

- Map: `.scratch/<effort>/map.md` - the Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope body. A `Status:` line records `active` or `resolved` for the Local Markdown provider. Keep an empty list section empty; never add a bare dash or placeholder list item.
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- Blocking: every new ticket carries one `Blocked by` field near the top. Use `Blocked by: None — can start immediately` for an empty blocker set; otherwise use comma-separated numeric ticket IDs such as `Blocked by: 42, 43`. An entry may append its exact title after a spaced em-dash (`42 — Title`). Historical tickets that omit the field remain readable as unblocked. Semicolons, prose without the declared em-dash title form, empty entries, and trailing undeclared text are invalid and must fail closed. A ticket is unblocked when every listed ticket is `resolved`.
- Frontier: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- Claim: set `Status: claimed` and save before any work.
- Resolve: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
