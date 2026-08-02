# Bearing Effort Lifecycle

Own explicit planning, activation, and conclusion events for one or more precisely enumerated Efforts. This internal branch continues from Established public orientation and does not reload or re-enter the public router.

## Process

1. **Orient to the exact Effort set.** Read `$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md`. If uninitialized, compose the Setup branch and resume. Read each target Effort, its Roadmap, Target Gate, Work Binding, trustworthy provider evidence, native work, dependent references, diagnostics, and any Planning Review that authorizes a project-wide lifecycle change. Completion: every target, dependency, and current lifecycle is explicit.
2. **Choose one explicit transition.** Create a planned Effort, activate a planned Effort, or conclude an active Effort. Lifecycle is `planned | active | concluded`. A conclusion records `completed | withdrawn | superseded`, a plain-text rationale, and a replacement Effort when and only when superseded. Planning writes `Planned at`; activation writes `Activated at`; conclusion writes `Concluded at`. Existing event fields are immutable. Completion: each target has one valid next event and no inferred transition.
3. **Preserve independent evidence.** Provider Completion, Map lifecycle, native Ticket lifecycle, Gate Readiness, and Gate Passage may inform a proposal but never transition an Effort. A ready-for-review Gate and an accepted Gate Passage remain independent from Effort conclusion. Completion: evidence and canonical lifecycle effects are separately stated.
4. **Obtain explicit user acceptance.** Present the transition, disposition and replacement when applicable, rationale, consequences for Gate Readiness, exact write set, and preserved data. For a project-wide lifecycle cutover, require one accepted Planning Review with the exact Effort set. Completion: explicit user acceptance covers every lifecycle mutation.
5. **Build the atomic virtual result.** Re-read all inputs. For an ordinary new event, generate the current UTC Source Event Time inside the owning operation and include it in the same atomic canonical mutation. A null event time represents `Time unavailable` only under explicit historical migration authority; current acceptance time, chat time, file metadata, Git history, Provider Observation Time, Sync time, or later prose never becomes a historical event time. Validate lifecycle shape, conclusion shape, replacement chain, Roadmap and Target Gate ownership, bindings, and all dependent references before writing. Completion: the entire candidate parses and its exact bytes are ready.
6. **Apply and verify.** Atomically write only the enumerated Effort records and, for an accepted project-wide cutover, its one directly authorizing Planning Review record. Roll back the full set on any failure. Run `$HOME/.bearing/bin/bearing sync --repo <repo-root>`, require zero structural diagnostics, and typed-inspect every affected Effort and Gate. Completion: canonical lifecycle, derived readiness, and independent Passage truth are coherent.
7. **Refresh derived orientation after conclusion.** For a successful Effort conclusion only, read `$HOME/.bearing/kit/current/skills/bearing/references/shared/project-brief-refresh.md` on demand and enqueue Project Brief Refresh for the end of the current workflow. Creation and activation do not trigger it. If a later accepted Gate or Roadmap terminal transition occurs in the same orchestration, the coordinator still invokes the shared refresh exactly once. A Brief failure is reported as a separate partial stage and never rolls back the concluded Effort. Completion: lifecycle and derived orientation outcomes remain owner-separated.

## Read Set

- Established public orientation, including manifest, Summary, and Sitemap; do not reload it
- Exact target Efforts, Roadmaps, Target Gates, Work Bindings, native scopes, and provider evidence
- Dependent references, diagnostics, Checks, and the directly authorizing Planning Review when applicable

## Write Set

- Exact target `.bearing/state/efforts/<slug>.md` files
- At most one directly authorizing `.bearing/state/planning-reviews/<slug>.md` for an accepted project-wide lifecycle cutover
- Disposable sync outputs

Never mutate a Roadmap, Gate, Gate Passage, Work Binding, native artifact, native lifecycle, Authority, Citation, or Asset under Effort lifecycle ownership.

## Outcomes

- `applied`: every explicitly accepted lifecycle event and its source time validate atomically.
- `no-op`: current lifecycle already matches the accepted event without a new transition.
- `partial`: the accepted Effort conclusion validates while the later Project Brief stage failed and retained its previous successful state.
- `awaiting-decision`: transition, conclusion disposition, rationale, replacement, or historical migration authority is not accepted.
- `blocked`: current lifecycle, dependencies, replacement chain, binding evidence, or virtual result cannot be trusted.

## Recovery

Changed inputs invalidate the candidate write set. Restore every original Effort and remove only a transaction-created Planning Review on failure. Never repair uncertainty by reading Provider Completion, Map lifecycle, Gate Readiness, or Gate Passage as an automatic transition.

## Completion Criterion

Every target Effort has one explicit Bearing-owned lifecycle, each applicable event has a UTC time from the same atomic canonical mutation or explicit historical `Time unavailable`, every conclusion is complete, independent native and Gate truth is preserved, and refreshed typed inspection agrees with canonical sources.
