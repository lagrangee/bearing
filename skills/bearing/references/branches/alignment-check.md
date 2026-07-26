# Bearing Alignment Check

Turn one material target-scoped drift question into a reviewable decision point. This internal branch continues from established public orientation and never re-enters the public router.

## Process

1. **Set one target.** Read `$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md`. If uninitialized, compose the Setup branch and resume. Resolve one explicit Stable ID, Tracker Reference, file, or proposed change. Read its Effort, Roadmap, Gate, declared Authorities, Authority baselines, Planning Citations, relevant Assets, ADRs, diagnostics, and any equivalent open Check. Completion: one target and one material question are explicit.
2. **Build current inputs.** Follow required references transitively, record the ordered repository-local `Inputs`, and compute the V1 `Input fingerprint`. Exclude the Check being created or refreshed. Completion: every comparison claim is traceable to current bytes.
3. **Judge materiality.** Compare the target or proposal with accepted intent and governing baselines. No material finding returns `no-op` and creates no pass record. A material finding creates or refreshes one open Check; reuse only an equivalent unresolved question. Completion: the finding states consequence, not merely textual difference.
4. **Frame candidates.** The Check uses `Type: alignment-check`, `ID: alignment-check:<slug>`, `Title`, `Status: open`, `Target`, ordered `Inputs`, `Input fingerprint`, optional `Citations`, and a body containing the finding and distinct resolution candidates. Write every human-readable semantic value under the shared Planning Transaction's Normalized Semantic Text rule. Present what would remain, change, or become an explicit exception. Completion: each candidate names its planning consequences and owner.
5. **Resolve only with acceptance.** The user may decide now or leave the Check open. An accepted resolution records plain-text `Resolution.Accepted decision`, `Rationale`, and structural `Changed references`, using an explicit empty list when current direction remains. Apply only target-scoped Effort, Authority, Asset Registry, citation, and dependent-reference mutations owned here. Roadmap- or Gate-exclusive mutations return `awaiting-decision` with the required capability and keep the Check open. Completion: acceptance and owned write scope align.
6. **Apply and sync.** Re-read inputs, run the shared transaction, validate the Check and every changed reference, then run `$HOME/.bearing/bin/bearing sync --repo <repo-root>`. Completion: the open or resolved decision point and Attention projection are current.

## Read Set

- Established public orientation, including manifest, Summary, and Sitemap; do not reload it
- One target and its containing Effort when present
- Required Roadmap, Gate, Authorities, baselines, Assets, citations, ADRs, and diagnostics
- Equivalent open Check when present

## Write Set

- One `.bearing/state/alignment-checks/<slug>.md` when a Material Finding exists
- Accepted target-scoped Effort, Authority, Asset Registry, citation, or dependent-reference changes owned by this capability
- Disposable sync outputs

## Outcomes

- `applied`: a material Check was created, refreshed, or accepted and resolved with all owned changes.
- `no-op`: current inputs reveal no Material Finding or an identical current Check needs no refresh.
- `awaiting-decision`: a Check remains open or another mutation owner is required.
- `blocked`: the target, input graph, fingerprint, or transaction is untrustworthy.

## Recovery

Changed Inputs invalidate the finding and candidates. Refresh an equivalent open Check in place; preserve resolved history and create a new Check for a later conflict. Roll back every coordinated write on failure.

## Completion Criterion

One material target question is either absent, durably open, or explicitly resolved; all claims use current inputs; only owned references changed; and refreshed Attention shows the truthful state.
