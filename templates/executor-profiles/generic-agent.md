# Executor Profile: Generic Agent

Profile key: generic-agent

Use for an agent that owns end-to-end execution but has no stronger installed profile.

## Native Artifacts

Preserve source changes, project-native documents, commits, and test outputs at the locations chosen by the repository. This profile assumes no executor-native evidence ledger.

## Durable Evidence

Treat only durable repository artifacts or stable native execution outputs as evidence. Chat text and transient command output are not durable evidence.

## Fallback Receipt

Create `.scratch/<slug>/evidence/<work-item>-generic-agent.md` before resolving managed work when no durable native evidence exists. Record Work item, Execution profile, Outcome, Verification, and Produced artifacts.

## Producer Provenance

Register execution-produced Assets with `Kind: executor-profile` and `Name: generic-agent`. Use `Reference` only for a durable native locator.
