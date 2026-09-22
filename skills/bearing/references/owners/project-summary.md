# Project Summary Owner

## Applicability

Use to create or materially revise the current Project Summary.

## Authority

Project Summary owns accepted long-horizon project meaning: purpose, current design, boundaries,
future candidates, and material revisions. It is not a work log, Project Brief, or recommendation.

## Write form

Write `.bearing/state/project-summary.md`. Required frontmatter is `Type: project-summary`, fixed
`ID: project-summary:current`, and plain-text `Title`. A newly created or revised Summary also
records `Updated at` as the actual successful revision's UTC instant. Historical records may omit
that field; null is not a valid Summary revision time. Optional `Languages` is a mapping whose only
keys are `Purpose` and `Current Design`, each with an optional BCP 47 tag.

Required plain-prose sections: `## Purpose`, `## Current Design`. Required plain-list sections:
`## Boundaries`, `## Future Candidates`, `## Material Revisions`. Keep their headings even when a
list is empty. Initial creation does not invent prior revisions or future commitments.

### Complete initial example

```markdown .bearing/state/project-summary.md
---
Type: project-summary
ID: project-summary:current
Title: Local Notes
Updated at: 2026-09-01T09:00:00.000Z
---

# Local Notes

## Purpose

Let a person save and reopen notes on their own computer.

## Current Design

Notes are local files opened through a small desktop interface.

## Boundaries

- Keep note contents on the local computer.

## Future Candidates

## Material Revisions
```

## Operation

1. Inspect Project Context and the current Summary reference. Read only sources needed to support
   candidate meaning. Classify every statement as current fact, accepted meaning, or a labelled
   proposal.
2. Apply the shared materiality test. State the semantic delta and the meaning that remains
   unchanged. Return `no-op` when the current Summary is not materially misleading.
3. Author a complete candidate with distinct current intent and future candidates. Set `Updated
   at` only for the successful Summary revision.

## After this operation

- **Required:** Keep Summary update time distinct from Brief generation, provider observation, and
  native chronology.
- **Required:** When Roadmap completion selects this owner, return `no-op` if accepted project
  meaning is already current, then continue to the separately selected Project Brief owner.
- **Consider:** Refresh Project Brief only when accepted truth materially changes its current
  orientation.
- **Do not infer:** Effort conclusion, Gate Passage, or Roadmap transition automatically authors new
  Summary meaning.

## Completion criterion

The Summary contains only current accepted project meaning, the material revision is traceable, and
its revision time remains distinct from Brief generation and native chronology.
