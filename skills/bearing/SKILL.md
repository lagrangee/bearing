---
name: bearing
description: Use for explicit Bearing invocation, any request whose correct answer or action may depend on a repository or accepted project state, and requests with ambiguous repository relevance. Do not use for clear repository-independent conversation.
---

# Bearing

Activate and coordinate project-aware work without becoming a canonical planning writer, native Work Management system, or executor. This public router has no persisted mode, target, or hidden session state.

## Process

1. **Apply the request-dependency test.** A request qualifies when its correct answer or action may depend on repository code, documentation, native work, Bearing state, or accepted decisions. Explicit Bearing invocation and ambiguous repository relevance qualify. The working directory alone does not qualify. An automatic false positive for clear repository-independent conversation exits `no-op` before project orientation; explicit invocation never takes that exit. Completion: activation or exclusion has one stated reason.
2. **Reuse only a reliable direct continuation.** A direct continuation of the same request and repository may reuse visibly reliable orientation already present in the conversation. Refresh when the repository, target, or request changes, or when context loss, handoff, compaction, or freshness doubt makes prior orientation unreliable. Never infer continuity from hidden state. Completion: reuse or refresh is explicit.
3. **Acquire Minimal Orientation once.** Resolve the repository root and inspect `.bearing/manifest.json`. An absent manifest selects the Setup branch while preserving the original request. For an enabled repository, refresh Sync only when the Project Sitemap is missing, malformed, known stale after a write, or explicitly requested. Read the optional Project Summary and complete Project Sitemap once, then Read their canonical source locators when deeper evidence is material. The Sitemap supports whole-project orientation, target discovery, source routing, and top-level Attention; it does not prove a complete target closure. Completion: repository identity, enablement, projection freshness, purpose, and relevant frontier are visible.
4. **Select one owner path.** Read `$HOME/.bearing/kit/current/skills/bearing/references/branch-manifest.yaml`. Continue ordinary unmanaged work when governance adds no material action. Compose native Work Management or Execution when it owns the request. For a Bearing mutation, load exactly one selected internal branch and only the shared contracts declared for that path. Load `typed-inspection` only for a completeness-sensitive target claim or mutation. Do not re-enter the public router from an internal branch. Roadmap Horizon exhaustion requires an explicit Complete, Extend, or Keep active decision. Next Work produces one Primary Recommendation and zero to two meaningful Alternatives, or `no-op: no-managed-frontier` without an empty snapshot. Completion: one mutation owner and its progressive read set are explicit.
5. **Compose sequentially without takeover.** Give the selected capability only relevant orientation and the current user's language requirement. Preserve its contract, lifecycle, status taxonomy, artifacts, and writeback authority. When more than one owner is required, finish and validate one owner boundary before selecting the next. For a direct executor invocation, load `executor-continuation` and continue the original command after fresh orientation or with reliable visible Bearing awareness. Once the actual executor is known, read its project-owned Execution Profile when present. Leave native status, blocker, dependency, claim, and resolution writes with Work Management; never translate failure, incomplete, ambiguous, or spec-only outcomes into success. Completion: each effect has one owner.
6. **Reconcile produced outputs.** Require every composed executor, planning, research, prototype, or subagent capability to return a produced-output manifest. Assign each output exactly one disposition: `transient`, `durable-registered`, or `durable-unregistered`. For a durable output with complete factual metadata, load `artifact-registration` and use `bearing asset register`; registration does not create Citation, adoption, disposition, binding, or Passage Evidence. A `durable-unregistered` output makes artifact reconciliation `incomplete` and prevents a full-success claim. Deterministic Sync never crawls native work or `.scratch` to infer durability. Completion: every reported output has one truthful disposition.
7. **Return to the original request.** Report the native or branch outcome without translation, relevant Attention, any typed-inspection state, output reconciliation, and the exact blocker or resumption point when unfinished. User-visible interaction and newly authored human-reviewed planning artifacts follow the current user's language; agent-facing contracts remain English. An empty managed frontier never becomes a global claim that there is nothing to do. Completion: the request progressed or stopped at one concrete authority boundary.

## Read Set

- Latest prompt and visible recent conversation
- `.bearing/manifest.json`
- `.bearing/state/project-summary.md` when present
- `.bearing/cache/project-sitemap.md`
- `$HOME/.bearing/kit/current/skills/bearing/references/branch-manifest.yaml`
- At most one selected internal branch and its declared shared contracts; none for direct executor continuation
- `executor-continuation` only for a direct executor invocation
- Material canonical sources selected from orientation
- A project-owned Execution Profile only after the actual executor is known

## Write Set

Never mutate canonical planning state or native work from this router. It may run deterministic Sync, compose one owning capability at a time, and invoke the package-owned factual Asset Registration Route. Each composed owner retains its own write set and rollback contract.

## Outcomes

- `applied`: the original request completed and every owned write and durable output reconciled.
- `no-op`: the request was clearly repository-independent, or project context required no managed action.
- `awaiting-decision`: an owning capability requires explicit user acceptance.
- `blocked`: enablement, source truth, inspection, provider terminal writeback, or an owning capability cannot proceed safely.
- `incomplete`: target coverage, native outcome, or durable-output reconciliation is truthfully incomplete.

## Recovery

Refresh orientation from current visible context after repository, target, request, or freshness change. Preserve a composed capability's native failure and recovery report. Never reconstruct a missing typed closure, infer a native terminal write, or silently register an output after incomplete metadata.

## Completion Criterion

The request-dependency decision is explicit, Minimal Orientation ran at most once for the current reliable episode, one owner path was loaded at a time, native lifecycle was preserved, and every produced output and managed write has a truthful terminal state.
