# Bearing Milestone Gate

Own one decision boundary and its human passage review. This internal branch continues from established public orientation and never re-enters the public router.

## Process

1. **Orient.** Read `$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md`. If uninitialized, compose the Setup branch and resume. Read the target Gate, owning Roadmap and order, contributing Efforts, native Maps and Tickets, Fog, relevant Authorities, Assets and citations, diagnostics, open Checks, pending Reviews, and derived readiness. Completion: one Gate and every trustworthy contributor are explicit.
2. **Choose the operation.** Create or revise a boundary, review passage, split independently passable boundaries, or supersede a boundary. A Gate uses `Type: milestone-gate`, `ID: gate:<slug>`, `Title`, `Roadmap`, `Status: planned | active | passed | superseded`, ordered `Effort order`, optional `Citations`, `## Intent`, and `## Exit Criteria`. `Effort order` must exactly enumerate the Gate's current contributors and is the only owner of their planning priority; never derive it from Stable IDs, timestamps, provider state, filesystem order, or capture order. Creation records `Planned at`; activation records `Activated at`; accepted Passage records `Accepted at`; supersession records `Superseded at`. This capability generates current UTC Source Event Time for each newly accepted event inside the same atomic canonical mutation. Existing event fields are immutable, and legacy missing history remains `Time unavailable` without inference. Write semantic Intent prose as plain UTF-8 text without inline Markdown, HTML, links, code spans, or formatting tokens. Completion: the operation matches one coherent decision boundary.
3. **Evaluate readiness.** `unknown` blocks passage because source truth is unreliable. `ready-for-review` opens human evaluation of Exit Criteria. `not-ready` may pass only when the candidate explicitly lists Exceptions and dispositions every unfinished contributing Effort or dependent reference. Readiness never proves passage. Completion: each criterion, evidence Asset, exception, conflict, and unfinished item is accounted for.
4. **Propose the decision.** Present status change, Rationale, Evidence Asset IDs, explicit Exceptions, relation dispositions, and exact write set. Split or supersession identifies every contributing Effort and dependent reference; required Effort binding changes become Alignment Check branch prerequisites. Completion: material consequences are visible and an Accepted Decision is obtained.
5. **Apply atomically.** Re-read decision inputs after every prerequisite resolves. Write the Gate, its exact `Effort order`, and the owning Roadmap order or focus transition coupled to this Gate operation. A passed Gate records `Passage` with `Accepted decision`, `Accepted at`, `Rationale`, `Evidence`, and `Exceptions`; when it was focused, update Roadmap focus to the next ordered active/planned Gate or `null`. Preserve Effort sidecars and native work lifecycle. Completion: Gate, contributor order, passage record, Roadmap transition, event times, and dependent references validate together.
6. **Refresh orientation.** Run `$HOME/.bearing/bin/bearing sync --repo <repo-root>` and inspect readiness, Roadmap Horizon, and affected Attention. Completion: the Project Sitemap reflects the decision without claiming the Roadmap completed automatically.

## Read Set

- Established public orientation, including manifest, Summary, and Sitemap; do not reload it
- Target Gate and owning Roadmap
- Contributing Efforts, Maps, Tickets, Fog, blockers, and resolutions
- Relevant Authorities, Assets, citations, Checks, Reviews, and diagnostics

## Write Set

- Target `.bearing/state/milestone-gates/<slug>.md`
- Owning Roadmap only for the accepted Gate order or focus transition coupled to creation, split, passage, supersession, or disposition
- Disposable sync outputs

Never rewrite native work to manufacture readiness.

## Outcomes

- `applied`: the accepted Gate operation and all dependent transitions validate.
- `no-op`: the requested review confirms no canonical change.
- `awaiting-decision`: passage, exceptions, split, supersession, or disposition is not accepted.
- `blocked`: readiness is unknown or required inputs cannot be trusted.

## Recovery

Treat concurrent native or planning changes as a new review. Roll back the full multi-file set on failure. A missing next Gate clears Roadmap focus and derives exhaustion; it never authorizes Roadmap completion.

## Completion Criterion

The Gate expresses one accepted decision boundary, its status and Passage are evidence-grounded, every affected relation is dispositioned, Roadmap focus is coherent, native work is preserved, and sync confirms the canonical graph.
