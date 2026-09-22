# Roadmap Owner

## Applicability

Use for Roadmap horizon creation, revision, Gate order, extension, completion, or supersession.
When the Human has decided to create an independent outcome horizon, select the Roadmap owner even
when that horizon will answer a question about value, feasibility, or continuation.

## Authority

Roadmap owns one peer rolling outcome horizon and the ordered Milestone Gates in that horizon. It
does not own Effort lifecycle, Gate Passage, or native completion.

## Operation

1. Inspect the complete Roadmap reference, ordered Gates, contributing Efforts, relevant
   Authorities, and direct diagnostics. Make one exact horizon and all order effects explicit.
2. Author one coherent candidate. When creation or extension also creates Gate records, the
   Milestone Gate owner must already be selected by root; other inspected domains need no owner.
3. For an exhausted horizon, explain and obtain one decision: **Complete Roadmap** records achieved
   outcome, **Extend Horizon** adds accepted future Gates, or **Leave Active for Now** preserves the
   open horizon and states why. Record a current event time only with an accepted Roadmap event.

## After this operation

- **Required:** After an accepted Roadmap completion, root selects the Project Summary owner and
  then the Project Brief owner in the same visible operation. After accepted supersession, root
  selects only the Project Brief owner. Each owner evaluates materiality and can return `no-op`.
- **Do not infer:** Gate readiness, Passage, Effort completion, or an empty frontier completes or
  extends a Roadmap.

## Completion criterion

One accepted horizon and Gate order are current, all changed owners were selected by root, and terminal
meaning came from the user rather than evidence alone.

## Write form

Write each Roadmap at `.bearing/state/roadmaps/<slug>.md` and its membership in
`.bearing/state/roadmap-index.md`. The index is a container with required `Type: roadmap-index` and
unique `Roadmaps` Stable IDs in order, including `[]` when empty. It has no `ID` or required body
sections. Every Roadmap belongs to the index exactly once; adding a Roadmap does not replace peers.

A Roadmap requires `Type: roadmap`, `ID: roadmap:<slug>`, plain-text `Title`, `Status`,
`Focused gate`, and unique `Gate order` (possibly `[]`). `Status` is `active`, `completed`, or
`superseded`. `Focused gate` is an ordered Gate's ID or `null`; an active Roadmap's focused Gate
must be active. Use null when no focus was accepted, and clear focus on completion or supersession.
Every ordered Gate names this Roadmap as its owner. The required `## Intent` contains plain prose.
Optional `Citations` follows the shared form.

Record `Started at` for a new accepted horizon. `Completed at` applies only to completion and
`Superseded at` only to supersession; preserve the actual start when recording either event.
These event fields may be missing or null on historical records, but each new accepted event
records its own UTC instant. A status change is a separate accepted owner operation.

### Complete initial examples

This fictional horizon is accepted while its first Gate and Effort are only planned. No active
focus or native work has been accepted.

```markdown .bearing/state/roadmap-index.md
---
Type: roadmap-index
Roadmaps:
  - roadmap:local-notes
---

# Roadmap Index
```

```markdown .bearing/state/roadmaps/local-notes.md
---
Type: roadmap
ID: roadmap:local-notes
Title: Local note persistence
Status: active
Focused gate: null
Gate order:
  - gate:notes-persist
Started at: 2026-09-01T09:00:00.000Z
---

# Local note persistence

## Intent

Establish that a person can save a note and reopen the same content locally.
```

### Complete completed-horizon alternative

This replaces the Roadmap example only after the Human has accepted completion of the achieved
horizon. It is a shape example, not permission to conclude the planned records above.

```markdown .bearing/state/roadmaps/local-notes.md
---
Type: roadmap
ID: roadmap:local-notes
Title: Local note persistence
Status: completed
Focused gate: null
Gate order:
  - gate:notes-persist
Started at: 2026-09-01T09:00:00.000Z
Completed at: 2026-09-03T10:00:00.000Z
---

# Local note persistence

## Intent

Establish that a person can save a note and reopen the same content locally.
```
