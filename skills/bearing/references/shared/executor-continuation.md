# Direct Executor Continuation

Load this shared contract only when the user directly invokes an executor for a repository-dependent request. It coordinates the continuation around the executor without taking over implementation or native work lifecycle.

## Entry

A fresh direct invocation completes Bearing activation and the necessary Minimal Orientation before execution. A Bearing-aware continuation for the same request and repository reuses visibly reliable orientation and resumes the executor within the same user command. Never ask the user to invoke the executor a second time. Repository, target, or request change, context loss, handoff, compaction, or freshness doubt requires a fresh orientation.

Before executor entry, resolve one explicit Matt Delivery Ticket through the configured Work Management contract. Supply its identity, acceptance criteria, dependencies, blockers, native scope, current user-language requirement, and either its established Effort and Work Binding context or the explicit fact that it is unbound. An ambiguous Ticket identity or Spec-only invocation is a truthful nonterminal outcome and does not enter execution. Never guess a Ticket from recency, title similarity, a Spec, or the current directory.

Read the project-owned Execution Profile only after the actual executor is known and its portable capability locator matches. When no specialized registration matches, use the package-owned Generic contract and disclose that fact at reconciliation. Generic governs execution evidence reconciliation only: it never selects or changes the executor and grants no native Ticket lifecycle authority.

## Owner Pipeline

The executor exclusively owns implementation, tests, review, commit, its native outcome, and its produced-output manifest. Bearing exclusively owns output disposition, factual registration through `artifact-registration`, and deterministic Sync. The configured Work Management provider exclusively owns native terminal resolution through its concrete provider completion contract.

Run these owners sequentially. Do not let an executor mutate a Ticket lifecycle merely because it implemented ticket scope. Do not let Bearing forge or directly edit a provider terminal state. Never complete, pass, or otherwise mutate an Effort or Milestone Gate as execution reconciliation.

## Artifact Reconciliation

Classify every output as `transient`, `durable-registered`, or `durable-unregistered`. Register a durable output only from complete factual metadata. `Produced For` records the explicit work item for which an Asset was produced; native evidence independently substantiates the provider outcome. Never infer one from the other, turn Produced For into Citation or passage evidence, or register a conversational completion report.

## Terminal Reconciliation

Only a successful terminal outcome under the actual executor contract, with verified acceptance criteria and complete artifact reconciliation, may proceed to native completion. A matched Execution Profile interprets artifacts, evidence, fallback receipt, and provenance only; it never defines or translates the executor outcome taxonomy. Preserve the native outcome exactly; for example, `completed` remains `completed` and is never translated to Bearing `applied`. Invoke the concrete Work Management provider completion contract, observe its returned terminal state, then run Sync.

When the provider completion contract is unavailable, run deterministic Sync after artifact reconciliation, require zero diagnostics, then make a truthful stop. Zero diagnostics confirms projection consistency only; it does not authorize native Ticket lifecycle mutation or cure the unavailable provider stage. Report implementation, verification, commit, artifact reconciliation, Sync fingerprint and diagnostics, the unavailable native stage, and the exact resumption point. Do not forge a resolved Ticket, label the request fully applied, or imply Gate completion.

Preserve failure, incomplete, ambiguous, and spec-only outcomes exactly as returned. Reconcile any outputs already produced, run deterministic Sync, and return the native outcome without authorizing native terminal resolution, successful completion reconciliation, or a Gate or Effort change. A provider failure or nonterminal result remains its own truthful outcome and blocks the full-success claim.

## Live Validation Hooks

- `direct-executor:fresh`: record fresh activation and orientation before executor entry.
- `direct-executor:aware`: record visible reliable orientation reuse and same-command executor entry.
- `direct-executor:reconciled`: record executor outcome, produced-output dispositions, factual registrations, provider terminal result, Sync fingerprint, and diagnostics.
- `direct-executor:nonterminal`: record the preserved executor outcome or unavailable provider contract, completed owner stages, Sync fingerprint and diagnostics, and exact resumption point.

These identifiers are evidence hooks for later live validation, not runtime state, lifecycle aliases, or authority to fabricate a provider result.
