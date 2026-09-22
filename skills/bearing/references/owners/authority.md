# Authority Owner

## Applicability

Use for Authority Scope, current Baseline Asset membership, or concise current-baseline explanation.

## Authority

Authority owns the continuously revised accepted baseline for one governed concern. Baseline Asset
membership derives the current adoption relation. There is no adoption event record or timestamp.

## Operation

1. Inspect the Authority reference, current Scope, Baseline Assets, explanation, candidate Assets,
   dependent planning objects, and diagnostics. Identify the complete current baseline and every
   affected consequence.
2. Author an adopt, replace, remove, scope, or explanation candidate. Baseline membership changes
   only through an accepted Authority candidate. Citation, Asset creation, or source change is not
   baseline acceptance. Make exact membership before and after the change and its meaning visible.
   When an adopted Asset is superseded or archived, include the necessary replacement or removal
   in the same accepted logical scope. Read current Asset eligibility; every retained or new member
   must resolve and be active. An Asset owner transfer alone leaves membership unchanged.
3. Keep Asset state unchanged unless root also selected the Asset owner for this operation. Record
   no synthetic adoption event or timestamp on the Authority.

## After this operation

- **Required:** Keep historical decision context with completed Review or Asset lifecycle when
  material; Authority remains current-only.
- **Consider:** Use Planning Review only for a material unresolved coordination question.
- **Do not infer:** Baseline membership creates an event time, Asset lifecycle change, or universal
  adoption history.

## Completion criterion

Authority Scope, Baseline Asset membership, and concise explanation express one accepted current
baseline with no synthetic adoption events.

## Write form

Write `.bearing/state/authorities/<slug>.md` with required `Type: authority`,
`ID: authority:<slug>`, plain-text `Title`, and unique `Baseline` Asset IDs. Use `Baseline: []`
when the accepted current baseline has no Asset members. Each listed Asset must exist and be
active; membership itself is current adoption. Optional `Citations` follows the shared form and
does not substitute for Baseline. The Authority has no lifecycle, adoption event, or adoption time.

Required `## Scope` and `## Current Baseline` contain nonempty plain prose. Explain an accepted
empty baseline in Current Baseline rather than leaving that section blank. Changing membership
does not rewrite Asset identity, Source, Owner, or Disposition.

### Complete current baseline example

```markdown .bearing/state/authorities/note-format.md
---
Type: authority
ID: authority:note-format
Title: Note representation
Baseline:
  - asset:note-format
---

# Note representation

## Scope

Govern the local representation that lets existing notes remain readable.

## Current Baseline

The accepted note format defines the current representation; earlier drafts remain historical context.
```
