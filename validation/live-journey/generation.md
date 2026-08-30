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

Create one external evidence root and keep the Generation workspace, Scenario
results, and final Matrix result beneath it so every durable pointer stays
relative to that root. Prepare the complete selected registry once:

```text
bun scripts/run-live-journey.ts prepare-generation \
  --source-root <exact-checkout> \
  --registry validation/live-journey/registry.json \
  --package-manifest <absolute-package-manifest> \
  --workspace <evidence-root>/generation \
  --codex-home <operator-codex-home> \
  --prerequisite-skill-root <trusted-installed-skill-root> \
  --github-checkout <fixed-validation-checkout>
```

The command writes `<evidence-root>/generation/generation.json` and one private
manifest per selected Scenario. `generation.json` is the durable Generation
basis. It records the evidence class and exact package identity digest; registry,
Fixture-definition, and Harness digests; start time; model, reasoning effort, and
concurrency; ordered Scenario IDs; and fresh per-Scenario preparation readbacks.
Those readbacks contain the Fixture, required-Skill, permission, and optional
GitHub-baseline digests. The basis does not duplicate per-turn runtime observations.

This is the only preparation entry point for Matrix execution. Do not build a
second per-Scenario preparation path around the runner.

## 4. Run once with rolling concurrency

Run the prepared Generation once:

```text
bun scripts/run-live-journey.ts run-generation \
  --generation <evidence-root>/generation/generation.json
```

The runner starts independent Scenarios with rolling concurrency four and starts
the next eligible registry entry whenever one reaches a terminal boundary. A
Scenario may declare at most one Resource Key; Scenarios with the same key run
serially. Turns already declared for one Scenario continue sequentially in that
Scenario's one fresh conversation; this is part of its single execution
opportunity, not a retry.

The command writes `<evidence-root>/generation/execution.json`. This small
Coordinator-internal handoff contains only the Generation ID, observed peak
concurrency, and each Scenario's `completed` or `invalid` execution state. It is
not a semantic verdict, is not cited by the Matrix result, and is not a fourth
durable or release-evidence level. `complete-matrix` consumes and removes it after
the final Matrix result is written.

Each Scenario has one execution opportunity in a Generation. Do not automatically
retry, resume a failed or partial execution, reattach, restore a checkpoint, rerun
a turn, or resample a semantic failure. A model, credential, network, runner,
broker, sandbox, or Agent crash is a truthful terminal observation for that
Generation. Continue other independent Scenarios when their identities remain
valid. There is no execution timeout; long duration is recorded for later analysis.

Do not repair product, Skill, Fixture, prompt, registry, or Harness behavior inside
the Generation. Collect the complete failure set first. Classify and repair it
outside the Generation, group changes by owner, rebuild once when needed, and use
a fresh Generation for the next observation.

## 5. Evaluate complete observations

The Coordinator is the only semantic pass authority. Judge the complete
conversation, tool activity, typed outcomes, before-and-after state, and provider
observations. Accept any safe path that satisfies the user-visible contract.

After `run-generation`, author one Coordinator verdict input for every registry
entry and evaluate each generated manifest exactly once:

```text
bun scripts/run-live-journey.ts evaluate-scenario \
  --generation <evidence-root>/generation/generation.json \
  --manifest <evidence-root>/generation/scenarios/<SCENARIO-ID>/scenario-manifest.json \
  --verdicts <private-verdict-input> \
  --output <evidence-root>/results/<SCENARIO-ID>.json
```

Every registered Scenario gets exactly one terminal result containing:

- `scenarioId` and `generationId`;
- `pass`, `fail`, `blocked`, or `invalid`, plus a short Coordinator rationale;
- bounded observation pointers and digests; and
- per-turn and whole-Scenario timestamps and durations.

The starting-state identity remains in the Generation preparation readback; the
Scenario result does not repeat it.

For `DELIVERY-02`, also verify the exact authorized remote delta and clean remote
commit. Deterministic support may reject an identity mismatch, missing result,
forbidden state, or contradiction. It cannot manufacture a semantic pass.

Private transcripts, credentials, session identifiers, and unrelated
machine-private paths are not durable evidence.

## 6. Complete and learn

Complete the Matrix only after every registered Scenario has one terminal result.
Create the final result once:

```text
bun scripts/run-live-journey.ts complete-matrix \
  --source-root <exact-checkout> \
  --registry <absolute-path-to-exact-checkout>/validation/live-journey/registry.json \
  --results <evidence-root>/results \
  --generation <evidence-root>/generation/generation.json \
  --output <evidence-root>/matrix-result.json
```

The complete Matrix execution surface is therefore:

```text
prepare-generation -> run-generation -> evaluate-scenario x registry -> complete-matrix
```

The only durable evidence topology is:

1. `generation/generation.json`;
2. `results/<SCENARIO-ID>.json` once per registry entry; and
3. `matrix-result.json`, which references the Generation basis and every Scenario result.

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
