# Milestone Gate Owner

## Applicability

Use for Gate definition, revision, ordering contribution, lifecycle, split, supersession, or human
Passage review.

## Authority

Milestone Gate owns one decision boundary, its Exit Criteria, lifecycle, contributing Effort order,
and accepted Passage record. The user alone accepts Passage.

## Write form

Write `.bearing/state/milestone-gates/<slug>.md` with required `Type: milestone-gate`,
`ID: gate:<slug>`, plain-text `Title`, `Roadmap`, `Status`, and unique `Effort order` (possibly `[]`).
`Status` is `planned`, `active`, `passed`, or `superseded`. The owning Roadmap includes this Gate in
its Gate order. Effort order exactly covers every Effort whose Target gate is this Gate; each such
Effort names the same Roadmap. Required sections are plain-prose `## Intent` and plain-list
`## Exit Criteria`, with at least one criterion for a valid Gate projection.
Optional `Citations` follows the shared form.

Record `Planned at` for new planning, `Activated at` for an accepted activation, and `Superseded at`
only for accepted supersession. A planned Gate has no activation event. These fields may be
missing or null historically; a new accepted event uses the current UTC instant.

For accepted Passage, set `Status: passed` and write `Passage` with plain-text `Accepted decision`,
`Rationale`, `Accepted at` for this accepted event, and required `Evidence` and `Exceptions` arrays.
Each Evidence mapping has exactly `Locator` (a normalized repository-relative durable locator) and
plain-text `Relevance`; Exceptions contains plain-text entries, or `[]`. Keep these directly on
Passage. The historical decoder may tolerate a missing or null Accepted at, but a new Passage may
not manufacture acceptance or time. Non-passed new records omit Passage.

### Complete planned example

```markdown .bearing/state/milestone-gates/notes-persist.md
---
Type: milestone-gate
ID: gate:notes-persist
Title: Notes survive reopening
Roadmap: roadmap:local-notes
Status: planned
Effort order:
  - effort:save-notes
Planned at: 2026-09-01T09:00:00.000Z
---

# Notes survive reopening

## Intent

Decide whether the first local persistence behavior is dependable enough to retain.

## Exit Criteria

- A saved note reopens with the same content.
- The person reviewing the behavior accepts the result and known limits.
```

### Complete passed alternative

This alternative represents a separate Human-accepted Passage with its own retained evidence.
Neither the sample locator nor a syntactically valid Passage proves that the review happened.

```markdown .bearing/state/milestone-gates/notes-persist.md
---
Type: milestone-gate
ID: gate:notes-persist
Title: Notes survive reopening
Roadmap: roadmap:local-notes
Status: passed
Effort order:
  - effort:save-notes
Planned at: 2026-09-01T09:00:00.000Z
Activated at: 2026-09-01T10:00:00.000Z
Passage:
  Accepted decision: Pass the local persistence Gate.
  Accepted at: 2026-09-03T09:00:00.000Z
  Rationale: The reviewer accepted saved-content behavior within the stated limits.
  Evidence:
    - Locator: docs/reviews/local-persistence.md
      Relevance: Records the reviewed save-and-reopen behavior and its limits.
  Exceptions: []
---

# Notes survive reopening

## Intent

Decide whether the first local persistence behavior is dependable enough to retain.

## Exit Criteria

- A saved note reopens with the same content.
- The person reviewing the behavior accepts the result and known limits.
```

### Complete superseded alternative

This alternative is a different decision from Passage. Supersession records no invented Passage
or replacement-Gate field; any replacement Gate and order changes need their own accepted records.

```markdown .bearing/state/milestone-gates/notes-persist.md
---
Type: milestone-gate
ID: gate:notes-persist
Title: Notes survive reopening
Roadmap: roadmap:local-notes
Status: superseded
Effort order:
  - effort:save-notes
Planned at: 2026-09-01T09:00:00.000Z
Superseded at: 2026-09-03T09:00:00.000Z
---

# Notes survive reopening

## Intent

Retain the original local persistence boundary after its accepted replacement by a broader review.

## Exit Criteria

- A saved note reopens with the same content.
- The person reviewing the behavior accepts the result and known limits.
```

## Operation

1. Inspect the complete Gate reference, owning Roadmap, every contributing Effort, trustworthy
   native evidence, relevant Authorities, and diagnostics. Make every criterion and evidence
   limitation explicit.
2. For Passage, compare Exit Criteria with evidence and exceptions. `ready-for-review` permits human
   review; readiness never proves Passage. Record each accepted historical evidence item directly
   on Passage as one concise durable locator and relevance note. Do not register Passage proof as
   an Asset or derive it through an Asset reverse relation. Keep every criterion, exception,
   unfinished dependency, and unknown or incomplete evidence visible.
3. Author the exact Gate candidate. Passage exists only after Human acceptance and carries that
   accepted event time. Citation changes remain with the citing Gate; another domain changes only
   when its owner was selected by root.

## After this operation

- **Required:** Keep direct Passage evidence, readiness, and human Passage acceptance as separate
  facts.
- **Required:** Contributing Efforts can produce evidence before Passage. Never require Gate
  Passage before an accepted contributing Effort is planned or activated.
- **Required:** After an accepted Gate Passage, root selects the Project Brief owner for the bounded
  terminal-orientation evaluation.
- **Consider:** A material accepted Passage may justify a Roadmap horizon decision.
- **Do not infer:** Green tests, resolved Tickets, diagnostics, provider completion, or an accepted
  Effort transition passes the Gate.

## Completion criterion

The Gate boundary and contribution order are current, Passage exists only by human acceptance, and
evidence remains truthful and independently owned.
