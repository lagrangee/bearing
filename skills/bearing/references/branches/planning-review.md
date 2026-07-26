# Bearing Planning Review

Resolve one project-wide material question through an explicit accepted outcome. This capability may be invoked directly or composed by `/bearing` for a current user request.

## Process

1. **Select the Review.** Read `$HOME/.bearing/kit/current/docs/agents/bearing/protocol.md`. If uninitialized, compose `/bearing-setup` and resume. Use an explicit pending Review, the sole pending Review, or ask for target scope. Read its Inputs, fingerprint, findings, diagnostics, Summary, Roadmaps, Gates, Efforts, Authorities, Assets, Checks, and candidate write set. Completion: one current project-wide question is explicit.
2. **Refresh when needed.** Recompute the Review input set and fingerprint. Refresh an equivalent pending Review when inputs changed, preserving its ID; preserve completed Reviews as history. A materially different question gets a new Review. Completion: the question and candidates match current project truth.
3. **Frame the outcome.** Present distinct candidates to continue current direction, rebalance active work, or revise prior intent, plus consequences and exact changed references. A decision to continue may have an empty change set but still requires explicit acceptance. Completion: every candidate is actionable and ownership-correct.
4. **Apply owned changes.** After acceptance, re-read the full set and apply only project-wide Effort, Authority, Asset Registry, citation, and dependent-reference changes within this capability's ownership. Project Summary-, Roadmap-, or Gate-exclusive changes keep the Review pending and return `awaiting-decision` with the required capability; resume this Review afterward. Completion: no exclusive field is mutated by coordination convenience.
5. **Complete the record.** A Review uses `Type: planning-review`, `ID: planning-review:<slug>`, `Title`, `Status: pending | completed`, `Scope`, ordered `Inputs`, `Input fingerprint`, optional `Citations`, and, when completed, `Resolution` with `Accepted decision`, `Rationale`, and `Changed references`. Write every human-readable semantic value under the protocol's Normalized Semantic Text rule; keep IDs, Inputs, fingerprints, and changed references structural. Mark completed only after all accepted changes validate. Completion: record and graph are atomically coherent.
6. **Refresh orientation.** Run `$HOME/.bearing/bin/bearing sync --repo <repo-root>` and verify Attention, Summary, and affected nodes reflect the accepted outcome. Completion: the project-wide decision is durable and visible.

## Read Set

- Global protocol, manifest, Summary, and Sitemap
- One pending Planning Review and its current fingerprint inputs
- Affected Roadmaps, Gates, Efforts, Authorities, Assets, Checks, diagnostics, and dependencies

## Write Set

- One `.bearing/state/planning-reviews/<slug>.md`
- Accepted project-wide Effort, Authority, Asset Registry, citation, and dependent-reference changes owned here
- Disposable sync outputs

## Outcomes

- `applied`: the Review was refreshed or its accepted outcome completed atomically.
- `no-op`: a completed Review is unchanged or a pending Review is already current.
- `awaiting-decision`: user outcome or a Roadmap/Gate prerequisite remains.
- `blocked`: inputs or the coordinated transaction cannot be trusted.

## Recovery

Changed inputs invalidate the candidate outcome. Keep the Review pending until every accepted change and prerequisite validates. Roll back the full write set on failure; never report a partially applied project-wide decision as completed.

## Completion Criterion

One current project-wide material question is either pending with clear candidates or completed with explicit acceptance, rationale, and fully validated changed references; ownership boundaries hold and Attention is refreshed.
