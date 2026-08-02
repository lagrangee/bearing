# Project Brief Refresh

Load this shared protocol only from a lifecycle-owning route after an accepted Effort conclusion, Gate Passage, Roadmap completion, or Roadmap supersession. It owns the replaceable derived Project Brief and never becomes a standalone public branch.

## Trigger Boundary

Initialization refreshes Project Summary but does not trigger Project Brief. Ticket creation, claim, resolution, ordinary Sync, Portal entry, elapsed time, and ordinary conversation never trigger this protocol. A lifecycle route accumulates accepted terminal transitions across one workflow and invokes Project Brief Refresh exactly once at the end. Separate user-authorized workflows may each refresh independently.

Roadmap completion composes the Project Summary owner first and then invokes this protocol exactly once. Roadmap supersession invokes only Project Brief Refresh and never presents supersession as a completed Summary revision. This explicit workflow boundary is not timer debounce, file watching, event coalescing, a background worker, or a Portal action.

## Semantic Input

Consume the already loaded complete semantic context from the lifecycle-owning route plus the current Project Summary. Read only incremental evidence needed to describe the accepted terminal transition. Do not re-enter public routing, reload the complete project solely for Brief generation, or infer completed state from provider-native work, ticket lifecycle, readiness, or unaccepted passage.

Author the Brief in the current user's language. It must explain project purpose, current stage, and material achieved state; remain materially shorter than the full Summary; and contain no todo, recommendation, option list, speculative Future Candidate, or fixed sentence or line count. It is Agent-authored synthesis, not deterministic extraction or truncation.

## Write Contract

Write only `.bearing/state/project-brief.md` with frontmatter `Type: project-brief`, `ID: project-brief:current`, and the current UTC `Generated at` from the successful refresh. Optional `Languages` may declare canonical BCP-47 tags independently for `Project Purpose`, `Current Stage`, and `Material Achieved State`; never infer missing tags. Require exactly these semantic plain-text sections:

```markdown
## Project Purpose

## Current Stage

## Material Achieved State
```

Capture previous bytes before writing. Validate the complete candidate before replacement, then Sync and verify the distinct typed Brief projection. A failed generation, validation, write, or Sync retains the previous successful Brief bytes and previous `Generated at`, reports a truthful scoped failure, and never relabels old prose as newly generated. Failure does not roll back an already committed lifecycle-owner write.

## Outcome

Report `applied`, `no-op`, or `partial` for the Brief stage separately from the owning lifecycle outcome. `partial` names the retained Brief state, scoped failure, and exact resumption point. Project Brief generation grants no planning, prioritization, native-work, Effort, Gate, Roadmap, or Passage authority.
