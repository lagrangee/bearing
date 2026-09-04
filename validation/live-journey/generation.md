# Adaptive Live Matrix Generation

This runbook is for the top-level Human Orchestrator. Read
`docs/agents/codex-e2e.md` first. The tracked `registry.json` is the semantic definition;
deterministic support owns only mechanical validation.

## 1. Check the definition

```text
bun scripts/run-live-journey.ts check-matrix-definition \
  --source-root <current-checkout> \
  --registry validation/live-journey/registry.json
```

This starts no Agent and creates no Matrix evidence.

## 2. Prepare one package basis

For development rehearsal:

```text
bun scripts/run-live-journey.ts prepare-local-rehearsal \
  --source-root <current-checkout> \
  --package-output <new-external-package-directory>
```

For a frozen Candidate, use `prepare-candidate-package` with the verified receipt and matching
tarball. Never relabel rehearsal evidence as Candidate evidence.

## 3. Prepare the Generation

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

Preparation writes `generation.json` and all private Scenario manifests before Agent behavior. A
failed admission is `preflight blocked`. Correct the cause outside the Generation.

## 4. Conduct adaptive Scenarios

Start up to four independent Scenarios:

```text
bun scripts/run-live-journey.ts start-scenario \
  --generation <evidence-root>/generation/generation.json \
  --scenario-id <semantic-id>
```

After reading the complete Agent response, either reply naturally in the same conversation:

```text
bun scripts/run-live-journey.ts resume-scenario \
  --generation <evidence-root>/generation/generation.json \
  --scenario-id <semantic-id> \
  --reply <reply-file-or-dash>
```

or capture terminal evidence and supply the Human Orchestrator verdict:

```text
bun scripts/run-live-journey.ts finalize-scenario \
  --generation <evidence-root>/generation/generation.json \
  --scenario-id <semantic-id> \
  --verdict <json-file>
```

The verdict file is exactly:

```json
{"outcome":"pass","rationale":"Evidence-backed semantic judgment."}
```

For `fail` or `blocked`, the Orchestrator must add exactly one `failureCategory`:

```json
{"outcome":"fail","failureCategory":"agent-adherence","rationale":"The loaded contract was clear, but the Agent did not follow it."}
```

| Category | Meaning |
| --- | --- |
| `test-system` | Harness, transport, fixture, permission, or trustworthy evidence failed. |
| `activation` | The applicable Bearing Skill or required reference was not loaded. |
| `contract` | Loaded Bearing instructions were ambiguous, contradictory, or insufficient. |
| `product` | The Agent followed the contract, but Bearing code or provider behavior failed. |
| `agent-adherence` | The applicable contract was loaded and clear, but the Agent did not follow it. |

The Orchestrator chooses this semantic attribution from the conversation and evidence. Deterministic
support only validates and preserves it; attribution does not change the verdict or create release
authority. Do not ask the Agent to replay a committed failure. Target at most three
post-initial replies for simple work, but allow materially progressing behavior to finish.
When the runner reports `evidenceOutcome: rejected`, inspect only the synthetic failed observation
and finalize `blocked`; the rejected bytes and session continuity are intentionally unavailable.
A transport-interrupted Turn may support a later pass only when it has no Agent reply and no
repository or Agent Home change, and the same private session subsequently completes cleanly.

## 5. Complete the Matrix

After every Scenario selected in the Generation has one result:

```text
bun scripts/run-live-journey.ts complete-matrix \
  --source-root <exact-checkout> \
  --registry <exact-checkout>/validation/live-journey/registry.json \
  --generation <evidence-root>/generation/generation.json \
  --output <evidence-root>/matrix-result.json
```

Review the complete conversations, raw events, terminal observations, failures, blocked results,
durations, and peak concurrency. Matrix completion proves evidence integrity and completeness only.
When the Generation selected fewer than all registered Scenarios, the result is a focused partial
summary rather than complete Matrix evidence.
It does not authorize Candidate, publication, Effort, Gate, Roadmap, or release decisions.
