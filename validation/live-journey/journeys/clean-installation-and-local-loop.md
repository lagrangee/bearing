# Clean Installation and Local Loop

This instruction is for the Coordinating Agent. Do not give this file, the Matrix definition, Case
identities, acceptance criteria, expected commands, or expected file effects to the Journey Agent.
Give the Journey Agent only one natural-language request at a time through the support runner.

## Preparation

Prepare one generation from the exact Candidate Receipt and tarball. Use the generated fresh Agent
home and disposable Local Markdown repository. The preparation result owns the local entry overlay,
Candidate Manifest, fixture paths, Matrix digest, and fixed Codex launch contract.

Read `docs/agents/codex-e2e.md`, then use the tracked support runner:

```text
bun scripts/run-live-journey.ts prepare-clean --candidate-receipt <receipt> --tarball <tgz> --source-root <candidate-checkout> --workspace <new-external-workspace> --codex-home <operator-codex-home>
bun scripts/run-live-journey.ts run-clean-turn --manifest <candidate-manifest> --turn <number> --prompt-file <one-natural-request>
bun scripts/run-live-journey.ts run-clean-turn --manifest <candidate-manifest> --turn <next-number> --prompt-file <one-natural-continuation>
bun scripts/run-live-journey.ts evaluate-clean --manifest <candidate-manifest> --verdicts <coordinator-verdicts> --codex-cli-version <observed-version> --coordinator-identity <identity> --duration-ms <duration> --output <new-result>
```

## Natural-language interaction

1. Ask the Agent to install Bearing by following the generated `README.local.md`. Tell it not to
   configure the current repository until the Human decides.
2. After installation and before setup consent, ask for one ordinary repository-only edit. Then
   inspect the observation to confirm that the edit did not cause Bearing activation, reads, CLI
   calls, governance prose, or writes.
3. Confirm setup. Nominate an executor that is not installed. After the Agent rejects it and asks
   for a valid decision, choose Skip. Let the Agent complete Fresh Repository Configuration and one
   Project Orientation. Confirm that installation and setup stayed separate and that setup created
   no implicit planning object or Work Binding.
4. Make one natural new-feature request that contains two separable native scopes. When asked,
   explicitly place one scope in Bearing Scope through an Effort and Work Binding, and keep the
   other as Standalone Native Work. Do not supply Case vocabulary or an expected implementation.
5. Ask the Agent to continue the accepted bound scope through native planning, Execution, evidence
   disposition, native writeback, and exact targeted reconciliation. Use normal Human answers when
   a material decision is required. Do not repeat setup or request another full orientation.
6. Ask for typed Inspect and Portal Planning Lineage readback of the exact bound result. Do not ask
   the Agent to conclude the Effort or pass a Milestone Gate.

## Evaluation

Use the raw conversation and tool events only during evaluation. Compare before and after snapshots,
native and provider outcomes, typed Inspect, and Portal readback. The Journey Agent's self-report is
not a verdict. Record one short evidence-backed Coordinator judgment for each Clean Case, then use
the support runner to create the bounded Clean Journey result. Do not retain credentials, full
transcripts, session identifiers, machine-specific paths, or unrelated repository content in that
result.
