# Codex E2E Policy

This is the repository-wide policy for every Codex E2E Matrix, independent Live Scenario,
live gated E2E, and Codex release smoke in this repository.

## Required launch

Every Scenario launches Codex explicitly with:

- model `gpt-5.6-luna`;
- reasoning effort `high`; and
- Fast mode enabled.

A conforming invocation includes:

```text
codex exec --model gpt-5.6-luna --config 'model_reasoning_effort="high"' --enable fast_mode
```

Do not inherit these values from operator configuration and do not fall back to another model.
Unavailability is `preflight blocked`.

## Runtime and capability isolation

Every Scenario receives a fresh repository, Agent home, runtime home, private TMPDIR, exact package,
and declared Skill set. The Agent cannot read the operator home, source checkout, registry, hidden
semantic fields, sibling Scenarios, credentials, session state, or Coordinator evidence. The native
permission profile is default-deny outside the current Scenario roots and verified toolchain inputs.

The runner copies only the authentication file required by Codex into runtime-owned storage and
denies it to Agent tools. General network access and product loopback are prohibited. The GitHub
Scenario may use only the existing short-lived broker for the configured private validation
repository and current fixture scope. Tokens and ephemeral broker values cannot enter prompts,
conversation evidence, raw events, terminal evidence, or results. Exact ephemeral values are
redacted before durable publication, then the output is checked again.

The Coordinator workspace must stay outside `/tmp`, `/private/tmp`, `/var/tmp`, and
`/private/var/tmp`. A new directory under the macOS per-user `TMPDIR` is allowed when its real path
is outside those fixed roots.

## Scenario contract

The tracked registry is `validation/live-journey/registry.json`. It contains exactly twelve
independent, semantically named Scenarios. Each Scenario declares five semantic fields:

1. Fixed Validation Fixture
2. Initial Prompt
3. Human Position
4. Bearing Intent
5. Terminal Evidence

The ID is identity, not a sixth semantic field. Human Position and Bearing Intent are
Coordinator-only. The Scenario Agent receives only the natural Initial Prompt, later natural Human
replies, installation entry when applicable, and observable repository or provider state. It does
not receive Scenario identity, criteria, expected commands, fixed follow-up Turns, or hidden
answers.

User-invoked-only Skills appear literally in the Initial Prompt only where the real journey requires
them. Later replies continue the same private Codex conversation without repeating the invocation.
Direct delivery does not invent an `$implement` invocation.

## Adaptive Human Orchestrator

The current top-level Codex is the sole Human Orchestrator. It reads each complete Agent response,
authors the next concise natural reply, and decides when the Scenario is terminal. Deterministic
support never chooses a reply and never manufactures `pass`, `fail`, or `blocked`.

Simple Scenarios target no more than three replies after the Initial Prompt. This is a soft
interaction budget, not a timeout or result rule. Productive discussion or execution may continue;
repetitive drill-down is recorded as workflow friction.

A committed wrong writeback, unauthorized mutation, false completion, missing required owner
return, or other already-observed Bearing contract violation is terminal `fail`. Do not reveal the
missing internal operation or ask the Agent to retry it. A trustworthy transport interruption may
resume only the same conversation before a semantic result exists. If continuity cannot be proven,
finalize `blocked`. A semantic result cannot be restarted, retried, or resampled inside its
Generation.

At most four Scenarios may be active. One Scenario has at most one active Turn. Independent
Scenarios may continue after another fails so the Generation yields the complete truthful result
set.

## Mechanical execution surface

`check-matrix-definition` is a deterministic registry and Fixture check. It starts no Agent and is
not a second semantic suite. A real execution has exactly five mechanical lifecycle operations:

```text
prepare-generation
start-scenario
resume-scenario
finalize-scenario
complete-matrix
```

- `prepare-generation` freezes package, registry, Fixture, Harness, model configuration, prepared
  Scenario set, and optional GitHub identities before behavior.
- `start-scenario` sends the tracked Initial Prompt to one new conversation.
- `resume-scenario` sends one Orchestrator-authored reply to that same conversation.
- `finalize-scenario` captures declared terminal surfaces and records the Orchestrator verdict and
  rationale.
- `complete-matrix` requires exactly one identity-bound result for every registered Scenario and
  publishes only a summary.

There is no fixed-Turn runner, deterministic semantic evaluator, automatic convergence pass,
automatic focused-probe stage, or automatic release mapping. Identity-changing corrections happen
outside the Generation and require a fresh Generation.

## Evidence

Durable evidence has three levels:

- one `generation.json` basis binding package, registry, Fixture, Harness, model, Scenario, and
  optional GitHub preparation identities;
- one result per Scenario citing a redacted raw Codex event stream, readable complete conversation,
  bounded terminal observations, contiguous Turn timestamps, Scenario timestamps, semantic outcome,
  and Orchestrator rationale; and
- one Matrix result citing the exact Generation and Scenario result set and summarizing outcomes,
  durations, slow observations, and actual peak concurrency.

Session identity stays private. Durable references must remain below the Matrix evidence root,
exclude credentials and session state, and pass digest verification. Deterministic checks may reject
missing or changed evidence, unsafe paths, identity mismatch, incomplete Turns, credential leakage,
or an incomplete result set. If Turn bytes fail the required secret scan, publish only a synthetic
failed observation that names the rejection class, then let the Orchestrator seal `blocked`; never
publish the rejected bytes or establish resumable session state. Scan each complete readable
conversation before replacing its durable copy. Seal the exact Orchestrator verdict before terminal
capture, and seal the Scenario result before runner-owned cleanup. These checks do not evaluate
Bearing Intent.

Matrix output has no deterministic relationship to Candidate readiness, publication, release,
Effort conclusion, Gate Passage, or Roadmap completion. A green deterministic suite does not imply a
semantic pass, and a structurally complete Matrix does not authorize release.

## GitHub lifecycle

The GitHub Scenario uses one reusable configured template. Each Generation creates one uniquely
named Matrix milestone, applies the stable `matrix-fixture` label, and creates one fresh parent plus
one fresh `ready-for-agent` child in that milestone. The natural prompt names only the work item;
tracker selection comes from repository configuration.

Runner cleanup begins only after terminal evidence capture. It closes remaining fixture Issues
without changing the verdict and closes the Generation milestone after all GitHub evidence is
captured. A later preflight may recover only stale open Matrix milestones and their own fixture
Issues; it cannot touch unrelated work or promote old evidence.

## Release Live Journey

Changing the required model, reasoning effort, Fast mode, registry semantics, or isolation contract
is a repository-level policy decision. Before coordinating a Bearing release, or defining, running,
or reviewing a release Live Journey, read and follow the
[Release Live Journey Runbook](release-live-journey.md). Live Matrix evidence is an input to Human
review, never deterministic release authority.
