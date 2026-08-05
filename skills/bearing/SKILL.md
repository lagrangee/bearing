---
name: bearing
description: Use for explicit Bearing invocation or after the current repository's Setup-managed Agent Surface activation check returned `invoke-bearing`. Do not use based only on repository relevance, accepted project state, ambiguity, or working directory.
---

# Bearing

Activate and coordinate project-aware work without becoming a canonical planning writer, native Work Management system, or executor. This public router has no persisted mode, target, or hidden session state.

## Process

1. **Validate invocation origin and repository lifecycle before orientation.** Classify the origin as `explicit` only when the user authored a Bearing invocation; otherwise require the Setup-managed Agent Surface nomination and classify it as `model-invoked`. Run `$HOME/.bearing/bin/bearing activation check --origin <explicit|model-invoked> --repo <repository-root>`. A model-invoked entry continues only for `invoke-bearing`. If the result is `continue-without-bearing` or `stop-for-explicit-entry`, stop without processing the original request, Setup, reactivation, recovery, Catalog access, orientation, or mutation, and direct Invalid or Unsupported state to explicit `/bearing`. This repeated check is containment and does not prove that the skill was never loaded. An explicit entry continues ordinary Bearing work for `continue-bearing`, selects the Setup owner for `enter-setup`, `enter-reactivation`, or `enter-recovery`, and never converts those results into model-invoked eligibility. An operational check failure stops safely. Completion: origin, current lifecycle, and one exact activation disposition are visible.
2. **Apply the request-dependency test.** For an Active repository, a request qualifies when its correct answer or action may depend on repository code, documentation, native work, Bearing state, or accepted decisions. Explicit Bearing invocation and ambiguous repository relevance qualify. The working directory alone does not qualify. An automatic false positive for clear repository-independent conversation exits `no-op` before project orientation; explicit invocation never takes that exit. Completion: activation or exclusion has one stated reason.
3. **Reuse only a reliable direct continuation.** A direct continuation of the same request and repository may reuse visibly reliable orientation already present in the conversation. Refresh when the repository, target, or request changes, or when context loss, handoff, compaction, or freshness doubt makes prior orientation unreliable. Never infer continuity from hidden state. Completion: reuse or refresh is explicit.
4. **Acquire lifecycle-appropriate orientation once.** For `continue-bearing` or `invoke-bearing`, refresh Sync only when the Project Sitemap is missing, malformed, known stale after a write, or explicitly requested. Read the optional Project Brief, optional Project Summary, and complete Project Sitemap once, then Read their canonical source locators when deeper evidence is material. Keep Brief generation, Summary revision, and honest absence distinct. The Sitemap supports whole-project orientation, target discovery, source routing, and top-level Attention; it does not prove a complete target closure. For `enter-setup`, `enter-reactivation`, or `enter-recovery`, preserve only the resolved repository root and inspected lifecycle, skip project governance orientation, and continue directly to the Setup owner. Completion: the bounded orientation required by the accepted disposition is visible once.
5. **Select one owner path.** Read `$HOME/.bearing/kit/current/skills/bearing/references/branch-manifest.yaml`. Continue ordinary unmanaged work when governance adds no material action. Compose native Work Management or Execution when it owns the request. An explicit Bearing Project Orientation request in an Active repository loads the shared `project-orientation` protocol directly and loads `governance-disposition` only for transient inventory acquisition after Orientation has been accepted; Project Orientation does not enter Setup and does not replay Fresh onboarding. Never run it from ordinary activation, Portal reading, or elapsed time. For a Bearing mutation, load exactly one selected internal branch and only the shared contracts declared for that path. Load `typed-inspection` only for a completeness-sensitive target claim or mutation. Do not re-enter the public router from an internal branch. Roadmap Horizon exhaustion requires an explicit Complete, Extend, or Keep active decision. Next Work produces one Primary Recommendation and zero to two meaningful Alternatives, or `no-op: no-managed-frontier` without an empty snapshot. Completion: one mutation owner and its progressive read set are explicit.
6. **Compose sequentially without takeover.** Give the selected capability only relevant orientation and the current user's language requirement. Preserve its contract, lifecycle, status taxonomy, artifacts, and writeback authority. When more than one owner is required, finish and validate one owner boundary before selecting the next. For a direct executor invocation, load `executor-continuation` and continue the original command after fresh orientation or with reliable visible Bearing awareness. Once the actual executor is known, read its project-owned Execution Profile when present. Leave native status, blocker, dependency, claim, and resolution writes with Work Management; never translate failure, incomplete, ambiguous, or spec-only outcomes into success. After native Work Management handling, load `governance-disposition` and return exactly one transient disposition without persisting an inventory or binding suggestion. Only when that disposition is `already managed` through an explicit accepted Work Binding, collect the native subjects and typed relations actually written, targeted, or returned by successful Matt operations, deduplicate them at transaction close, and invoke `bearing reconcile-native` for that exact opaque bound scope. For `kept standalone` or an unaccepted `enrollment suggested` result, run no Bearing Sync, capture, inspection, registration, or reconciliation and retain no refs. The references select bounded provider reads; they never prove outcome, lifecycle, completion, chronology, or readiness. Do not fall back to discovery or full capture when targeted reconciliation fails. Completion: each effect has one owner and every managed successful Matt write set has one bounded reconciliation result.
7. **Reconcile produced outputs.** Require every composed executor, planning, research, prototype, or subagent capability to return a produced-output manifest. Assign each output exactly one disposition: `transient`, `durable-registered`, or `durable-unregistered`. For a durable output with complete factual metadata, load `artifact-registration` and use `bearing asset register`; registration does not create Citation, adoption, disposition, binding, or Passage Evidence. A `durable-unregistered` output makes artifact reconciliation `incomplete` and prevents a full-success claim. Deterministic Sync never crawls native work or `.scratch` to infer durability. Completion: every reported output has one truthful disposition.
8. **Return to the original request.** Report the native or branch outcome without translation, relevant Attention, any typed-inspection state, output reconciliation, and the exact blocker or resumption point when unfinished. User-visible interaction and newly authored human-reviewed planning artifacts follow the current user's language; agent-facing contracts remain English. An empty managed frontier never becomes a global claim that there is nothing to do. Completion: the request progressed or stopped at one concrete authority boundary.

## Read Set

- Latest prompt and visible recent conversation
- Structured `bearing activation check` result for the current invocation origin
- `.bearing/manifest.json`
- `.bearing/state/project-brief.md` when present
- `.bearing/state/project-summary.md` when present
- `.bearing/cache/project-sitemap.md`
- `$HOME/.bearing/kit/current/skills/bearing/references/branch-manifest.yaml`
- At most one selected internal branch and its declared shared contracts; none for direct executor continuation
- `executor-continuation` only for a direct executor invocation
- `governance-disposition` only after native Work Management handling, for an explicit Bearing Scope Review, or for transient inventory acquisition inside an accepted Project Orientation
- `project-orientation` only for an explicit Active-project request or accepted Fresh Setup offer
- Material canonical sources selected from orientation
- A project-owned Execution Profile only after the actual executor is known

## Write Set

Never mutate canonical planning state or native work from this router. It may run deterministic Sync, compose one owning capability at a time, invoke targeted native reconciliation for a completed Matt transaction, and invoke the package-owned factual Asset Registration Route. Each composed owner retains its own write set and rollback contract.

## Outcomes

- `applied`: the original request completed and every owned write and durable output reconciled.
- `no-op`: the request was clearly repository-independent, the ineligible public entry stopped without acting, or project context required no managed action.
- `partial`: an accepted lifecycle owner write committed while a later Project Summary or Brief refresh failed and retained its previous successful state.
- `awaiting-decision`: an owning capability requires explicit user acceptance.
- `blocked`: enablement, source truth, inspection, provider terminal writeback, or an owning capability cannot proceed safely.
- `incomplete`: target coverage, native outcome, or durable-output reconciliation is truthfully incomplete.

## Recovery

Repeat activation validation after repository lifecycle change or any doubt about the prior check. An ineligible model-invoked entry never repairs itself or resumes the original task from inside the public router; only a later explicit Bearing entry may select Setup, reactivation, or recovery. Refresh orientation from current visible context after repository, target, request, or freshness change. Preserve a composed capability's native failure and recovery report. A failed targeted reconciliation retains prior evidence as non-current and stops without discovery or full-capture fallback. Never reconstruct a missing typed closure, infer a native terminal write, or silently register an output after incomplete metadata.

## Completion Criterion

Invocation origin and the package-owned activation disposition are explicit, lifecycle-appropriate orientation ran at most once for the current reliable episode, one owner path was loaded at a time, native lifecycle was preserved, and every produced output and managed write has a truthful terminal state.
