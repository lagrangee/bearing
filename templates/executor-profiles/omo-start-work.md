# Executor Profile: OMO Start Work

Profile key: omo-start-work

Match `omo:start-work` or `start-work` when it executes a Prometheus plan through its final writeback gates.

## Native Artifacts

Preserve `.omo/plans/`, `.omo/boulder.json`, `.omo/start-work/ledger.jsonl`, task-owned worktree changes and commits, and the manual-QA artifacts named by ledger entries.

## Durable Evidence

Prefer the native evidence ledger entries and their referenced QA, review, debugging, and cleanup artifacts. Register only durable artifacts needed beyond the executor's own recovery lifecycle.

## Fallback Receipt

No fallback receipt is needed when the final ledger entry identifies the work item, outcome, verification, and durable produced artifacts. Create the standard scope-local receipt when those facts are absent or the native ledger is not durable for this repository.

## Producer Provenance

Register execution-produced Assets with `Kind: executor-profile` and `Name: omo-start-work`. `Reference` may point to the durable ledger or artifact locator, never a session ID, model name, or transient command.
