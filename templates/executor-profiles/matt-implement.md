# Executor Profile: Matt Implement

Profile key: matt-implement

Match the installed user-invoked `implement` skill when it owns execution through final review and commit.

## Native Artifacts

Preserve implementation files, project-native tests, commits, and any artifacts linked from the Matt-native Ticket resolution. The skill does not define a separate evidence ledger.

## Durable Evidence

Use committed changes, durable test or review artifacts, and Ticket resolution links when they substantiate the outcome. A conversational completion report alone is not durable.

## Fallback Receipt

Create `.scratch/<slug>/evidence/<work-item>-matt-implement.md` when the execution leaves no durable verification record. Record Work item, Execution profile, Outcome, Verification, and Produced artifacts.

## Producer Provenance

Register execution-produced Assets with `Kind: executor-profile` and `Name: matt-implement`. A `Reference` may identify a durable commit, review artifact, or native Ticket locator.
