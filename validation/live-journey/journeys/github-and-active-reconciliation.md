# GitHub and Active Reconciliation

This instruction is for the Coordinating Agent. Do not give this file, the Matrix definition, Case
identities, acceptance criteria, expected commands, or expected file effects to the Journey Agent.
Give the Journey Agent only one natural-language request at a time through the support runner.
Use this instruction as part of `validation/live-journey/generation.md`; it is not an independent
release proof.

## Preparation

Complete the Clean Journey first. Reuse its verified Candidate Manifest, exact package identity,
installed Agent home, Matrix generation, and fixed Codex policy. Use one existing clean checkout of
the dedicated private GitHub Validation Repository. Do not create a repository for a Candidate.

Configure the fixed repository once per Bearing checkout. The configuration stays inside the local
Git directory, is not Candidate content, and refuses silent replacement. If it does not exist, stop
and ask the Human to nominate one existing dedicated private repository. Do not create a repository
or select a historical one by guess. The support runner then verifies the configured identity,
private issue-write access, clean checkout origin, fresh candidate scope, and a sanitized baseline
inventory before it starts a new Codex session. It records hashes and structural facts, not
credentials, issue prose, repository names, or full transcripts.

```text
bun scripts/run-live-journey.ts configure-github-repository --source-root <candidate-checkout> --github-repository <owner/name>
bun scripts/run-live-journey.ts prepare-github --clean-manifest <clean-candidate-manifest> --github-checkout <fixed-private-repository-checkout>
bun scripts/run-live-journey.ts run-github-turn --manifest <github-candidate-manifest> --turn <number> --prompt-file <one-natural-request>
bun scripts/run-live-journey.ts run-github-turn --manifest <github-candidate-manifest> --turn <next-number> --prompt-file <one-natural-continuation>
bun scripts/run-live-journey.ts evaluate-github --manifest <github-candidate-manifest> --verdicts <coordinator-verdicts> --authorized-issues <candidate-issue-number-array> --codex-cli-version <observed-version> --coordinator-identity <identity> --duration-ms <duration> --output <new-result>
```

Use the generated candidate scope key in the natural feature name and in every new root or child
issue title. This is a real user constraint that makes current Candidate work distinguishable from
historical validation work. Do not tell the Journey Agent that the key is a test hook or disclose a
Case identity.

## Natural-language interaction

1. Ask the Agent to use the existing GitHub repository configuration and create one fresh native
   planning scope for the named candidate feature. Accept binding only that native scope to one
   fixture Effort. Do not bind or edit a historical scope.
2. Ask the Agent to deliver the candidate scope through Work Management and Execution. Include one
   real dependency so claim, blocking, implementation evidence, and resolution are observable.
   Bearing may provide bound context, but Work Management and Execution must own native lifecycle
   and evidence writes.
3. Ask the Agent to check active Repository Configuration without requesting a change. A healthy
   configuration must return an exact no-op without Fresh onboarding or an Apply question.
4. Introduce one bounded drift inside a Bearing-managed Agent Surface block. Ask for diagnosis,
   decline any broader repair, then accept repair of that exact managed target only. Do not
   authorize label, repository-setting, historical-scope, or unrelated local changes.
5. Make one remote delta inside the current candidate scope. Ask the Agent to reconcile only the
   affected native references and relations. If exact reconciliation fails, do not authorize a
   full-scope capture, all-scope verification, or unrelated remote mutation.
6. Ask for typed native Inspect, Planning Lineage, and Portal readback of the exact bound scope. Do
   not ask the Agent to conclude the Effort or pass a Milestone Gate.

## Evaluation

Evaluate the four GitHub Cases from the raw conversation and tool events, repository snapshots,
native/provider outcomes, and typed readback. The Journey Agent's self-report is not a verdict.
Supply only the issue numbers that the Human explicitly authorized for the current candidate scope.
The runner compares the final remote inventory with the baseline and rejects repository-setting,
label, historical issue, or historical relationship changes outside that set.

Record one short evidence-backed Coordinator judgment for each GitHub Case. Remove the private
transcripts and remote inventories after the bounded result is written. The real private-repository
Journey remains required for the frozen Candidate; mocked provider success is support evidence only.
