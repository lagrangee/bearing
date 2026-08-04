# Direct Executor Continuation

Load this shared contract only when the user directly invokes an executor for a repository-dependent request. It coordinates the continuation around the executor without taking over implementation or native work lifecycle.

## Entry

A fresh direct invocation completes Bearing activation and the necessary Minimal Orientation before execution. A Bearing-aware continuation for the same request and repository reuses visibly reliable orientation and resumes the executor within the same user command. Never ask the user to invoke the executor a second time. Repository, target, or request change, context loss, handoff, compaction, or freshness doubt requires a fresh orientation.

Before executor entry, resolve one explicit Matt Delivery Ticket through the configured Work Management contract. Supply its identity, acceptance criteria, dependencies, blockers, native scope, current user-language requirement, and either its established Effort and Work Binding context or the explicit fact that it is unbound. An ambiguous Ticket identity or Spec-only invocation is a truthful nonterminal outcome and does not enter execution. Never guess a Ticket from recency, title similarity, a Spec, or the current directory.

An explicit unbound Ticket remains a valid standalone Work Management and Execution request. Continue under those owners, then return `kept standalone`. Do not load a Bearing Execution Profile, register its outputs, run deterministic Sync, capture or inspect its scope, retain affected refs, or invoke targeted reconciliation. Bearing does not require an enrollment ceremony for standalone completion.

Read the project-owned Execution Profile only after the actual executor is known and its portable capability locator matches. When no specialized registration matches, use the package-owned Generic contract and disclose that fact at reconciliation. Generic governs execution evidence reconciliation only: it never selects or changes the executor and grants no native Ticket lifecycle authority.

## Owner Pipeline

The executor exclusively owns implementation, tests, review, commit, its native outcome, and its produced-output manifest. Bearing exclusively owns output disposition, factual registration through `artifact-registration`, and deterministic Sync. The configured Work Management provider exclusively owns native terminal resolution through its concrete provider completion contract.

Run these owners sequentially. Do not let an executor mutate a Ticket lifecycle merely because it implemented ticket scope. Do not let Bearing forge or directly edit a provider terminal state. Never complete, pass, or otherwise mutate an Effort or Milestone Gate as execution reconciliation.

## Artifact Reconciliation

Classify every output as `transient`, `durable-registered`, or `durable-unregistered`. Register a durable output only from complete factual metadata. `Produced For` records the explicit work item for which an Asset was produced; native evidence independently substantiates the provider outcome. Never infer one from the other, turn Produced For into Citation or passage evidence, or register a conversational completion report.

## Terminal Reconciliation

Only a successful terminal outcome under the actual executor contract, with verified acceptance criteria and complete artifact reconciliation, may proceed to native completion. A matched Execution Profile interprets artifacts, evidence, fallback receipt, and provenance only; it never defines or translates the executor outcome taxonomy. Preserve the native outcome exactly; for example, `completed` remains `completed` and is never translated to Bearing `applied`. Invoke the concrete Work Management provider completion contract and observe its returned terminal state. For an explicit accepted Work Binding, treat all successfully written, targeted, or returned native subjects and typed relations from those concrete operations as one managed Matt Native Work Transaction. Without changing the provider's return payload, deduplicate that Bearing-owned affected set at transaction close and invoke `$HOME/.bearing/bin/bearing reconcile-native --repo <repo-root> --scope <opaque-native-scope>` with one `--ref` per affected subject and one JSON `--relation` per affected relation. The command performs deterministic rematerialization; do not follow it with generic Sync. An unbound or standalone transaction never enters this paragraph.

Affected references are read targets only. They never establish the provider outcome, lifecycle, completion, chronology, readiness, or transaction success. Targeted reconciliation must return revalidated provider evidence for the final native facts. On unavailable, partial, or failed reconciliation, retain the prior observation as non-current, report its scoped diagnostics and exact resumption point, and stop. Never broaden the failure into Discovery, recovery, full verification, or an ordinary Sync acquisition; those remain separate explicit operations.

When the provider completion contract is unavailable, run deterministic Sync after artifact reconciliation, require zero diagnostics, then make a truthful stop. Zero diagnostics confirms projection consistency only; it does not authorize native Ticket lifecycle mutation or cure the unavailable provider stage. Report implementation, verification, commit, artifact reconciliation, Sync fingerprint and diagnostics, the unavailable native stage, and the exact resumption point. Do not forge a resolved Ticket, label the request fully applied, or imply Gate completion. Because no successful native transaction occurred, this unavailable path does not invoke targeted reconciliation.

Preserve failure, incomplete, ambiguous, and spec-only outcomes exactly as returned. Reconcile any managed outputs already produced. When no successful managed Matt write occurred, return the native outcome without authorizing native terminal resolution, successful completion reconciliation, or a Gate or Effort change. When a nonterminal provider result nevertheless includes successful writes inside an accepted Work Binding, reconcile exactly that affected write set and preserve the nonterminal result. Standalone writes remain entirely outside Bearing persistence. A provider failure or nonterminal result remains its own truthful outcome and blocks the managed full-success claim.

## Live Validation Hooks

- `direct-executor:fresh`: record fresh activation and orientation before executor entry.
- `direct-executor:aware`: record visible reliable orientation reuse and same-command executor entry.
- `direct-executor:reconciled`: record executor outcome, produced-output dispositions, factual registrations, provider terminal result, Sync fingerprint, and diagnostics.
- `direct-executor:nonterminal`: record the preserved executor outcome or unavailable provider contract, completed owner stages, Sync fingerprint and diagnostics, and exact resumption point.

These identifiers are evidence hooks for later live validation, not runtime state, lifecycle aliases, or authority to fabricate a provider result.
