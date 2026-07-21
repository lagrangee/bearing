# Executor Profile: Superpowers Executing Plans

Profile key: superpowers-executing-plans

Match `superpowers:executing-plans` when it owns the plan execution and final completion report.

## Native Artifacts

Preserve the written plan, implementation changes, project-native tests, commits, and durable artifacts produced by its verification steps. Batch reports remain conversational unless written to the repository.

## Durable Evidence

Use durable plan updates, commits, test artifacts, and project-native verification outputs. Do not treat an unwritten batch summary as evidence.

## Fallback Receipt

Create `.scratch/<slug>/evidence/<work-item>-superpowers-executing-plans.md` when native outputs do not durably record the outcome and verification. Include the standard five receipt fields.

## Producer Provenance

Register execution-produced Assets with `Kind: executor-profile` and `Name: superpowers-executing-plans`. Use `Reference` only for a durable plan, commit, or evidence locator.
