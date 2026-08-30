# Agent Live Matrix Generation

This instruction is for the Coordinating Agent. Read
`docs/agents/codex-e2e.md` first. The tracked `registry.json` is the semantic
definition. Deterministic tests remain the authority for provider bytes, parser
behavior, broker allowlists, sandbox rules, and result schemas.

The Live Matrix is a release aid. It is not a workflow engine and must not become
a blocker that costs more than the feedback it provides.

## 1. Preflight the Matrix

Run the deterministic Fixture preflight before packaging:

```text
bun scripts/run-live-journey.ts preflight-matrix \
  --source-root <current-checkout> \
  --registry validation/live-journey/registry.json
```

Static Fixture materialization is reusable until a tracked Scenario or Fixture
definition changes. Every Generation still performs fresh, low-cost readbacks of
the exact package, registry, Fixture, required Skills, model and reasoning effort,
permission boundary, and the GitHub starting state when that Scenario is selected.
Preflight failure is `preflight blocked`; no Agent behavior starts.

The Coordinator reviews each natural request against its Fixture and required and
forbidden user-visible outcomes. Criteria must not prescribe commands, paths,
confirmation counts, or hidden implementation choices.

## 2. Freeze one package and definition

Use `local-rehearsal` while product, Skill, prompt, Fixture, or Matrix behavior
can still change:

```text
bun scripts/run-live-journey.ts prepare-local-rehearsal \
  --source-root <current-checkout> \
  --package-output <new-external-package-directory>
```

After Candidate Freeze, use the verified Candidate Receipt and matching tarball:

```text
bun scripts/run-live-journey.ts prepare-candidate-package \
  --candidate-receipt <verified-receipt> --tarball <matching-tarball> \
  --source-root <exact-candidate-checkout> \
  --package-output <new-external-package-directory>
```

One Generation binds one package identity, Matrix definition, Fixture definition,
Harness identity, and execution configuration. Never relabel rehearsal evidence
as Candidate evidence. Any identity-changing correction requires a fresh package
when applicable and a fresh Generation.

## 3. Prepare isolated Scenarios

Each Scenario receives a fresh repository or provider baseline, Agent home, Codex
conversation, prompts, observations, and private transcript. It cannot read the
registry, Coordinator criteria, operator home, source checkout, or another
Scenario runtime.

Prepare all selected Scenarios before Agent execution starts. Preparation verifies
the Generation basis and materialized starting state; it must not perform the
behavior under test. `DELIVERY-02` may use only the existing bounded GitHub
capability for the fixed private validation repository. No Scenario receives
general network access or a product loopback capability.

Use the current single Generation command surface reported by:

```text
bun scripts/run-live-journey.ts --help
```

Do not build an alternative Scenario entry point around the runner.

## 4. Run once with rolling concurrency

Run independent Scenarios with rolling concurrency four. Start up to four, and
start the next registry entry whenever one reaches a terminal boundary. A
Scenario may declare at most one Resource Key; Scenarios with the same key run
serially.

Each Scenario has one execution opportunity in a Generation. Do not automatically
retry, resume, reattach, restore a checkpoint, rerun a turn, or resample a semantic
failure. A model, credential, network, runner, broker, sandbox, or Agent crash is a
truthful terminal observation for that Generation. Continue other independent
Scenarios when their identities remain valid.

Do not repair product, Skill, Fixture, prompt, registry, or Harness behavior inside
the Generation. Collect the complete failure set first. Classify and repair it
outside the Generation, group changes by owner, rebuild once when needed, and use
a fresh Generation for the next observation.

## 5. Evaluate complete observations

The Coordinator is the only semantic pass authority. Judge the complete
conversation, tool activity, typed outcomes, before-and-after state, and provider
observations. Accept any safe path that satisfies the user-visible contract.

Every registered Scenario gets exactly one terminal result containing:

- `scenarioId`, Generation and starting-state identities;
- `pass`, `fail`, `blocked`, or `invalid`;
- a short rationale and required or forbidden outcome observations;
- bounded evidence pointers; and
- start and end timestamps.

For `DELIVERY-02`, also verify the exact authorized remote delta and clean remote
commit. Deterministic support may reject an identity mismatch, missing result,
forbidden state, or contradiction. It cannot manufacture a semantic pass.

Private transcripts, credentials, session identifiers, and unrelated
machine-private paths are not durable evidence.

## 6. Complete and learn

Complete the Matrix only after every registered Scenario has one terminal result.
The only durable topology is:

1. one Generation basis;
2. one terminal result per Scenario; and
3. one Matrix result that references those terminal results.

The Matrix passes only when every required Scenario passes. A rehearsal always
records `releasePrerequisiteSatisfied: false`; only an all-pass exact Candidate
result can record `true`. Neither result concludes an Effort, publishes a
release, or passes a Milestone Gate.

Record total duration, per-Scenario and per-turn duration, and peak concurrency.
Highlight observations over ten minutes for later analysis. These numbers are
optimization signals, not timeout fuses or reasons to keep repairing and rerunning
the same Generation.

Focused probes are diagnostic only. After accepted fixes, one complete fresh
Generation is the evidence; passes from older identities are historical context
and are never assembled into a current Matrix result.
