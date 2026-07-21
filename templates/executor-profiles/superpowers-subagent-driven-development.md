# Executor Profile: Superpowers Subagent-Driven Development

Profile key: superpowers-subagent-driven-development

Match `superpowers:subagent-driven-development` when it owns implementation, task review, and final branch review.

## Native Artifacts

Preserve implementation commits, project-native tests, task briefs, durable implementer or reviewer reports, and final review artifacts. Treat `.superpowers/sdd/progress.md` as recovery state unless the repository deliberately preserves it.

## Durable Evidence

Use commits and durable task or review reports that identify the verified result. Ephemeral subagent messages and temporary review packages are not durable evidence.

## Fallback Receipt

Create `.scratch/<slug>/evidence/<work-item>-superpowers-sdd.md` when no durable report links the final outcome, verification, and produced artifacts. Include the standard five receipt fields.

## Producer Provenance

Register execution-produced Assets with `Kind: executor-profile` and `Name: superpowers-subagent-driven-development`. `Reference` may identify a durable commit or report, not a subagent or thread ID.
