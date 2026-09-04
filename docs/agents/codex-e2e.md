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

GitHub preflight records external effects as soon as it creates a milestone or Issue. A later
preparation failure retains the Generation, repository, milestone, and known Issue identities,
attempts cleanup for every known object, and reports cleanup as `complete` or `unverified` with the
unverified targets. Its blocked admission reports `externalEffectsObserved: true`.

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

Local Matt-native Fixture artifacts are fixed, versioned materializations of the pinned Matt Kit
setup, specification, ticket, and Wayfinder contracts plus explicitly declared provider extensions.
Admission verifies their receipt and exact bytes; profile materialization may only select or copy
those verified artifacts. It never authors a replacement native document from Harness prose or
runs an Agent to regenerate the Fixture inside a Generation.

User-invoked-only Skills appear literally in the Initial Prompt only where the real journey requires
them, and the Harness sends that declaration as Codex's structured Skill input rather than relying
on prompt text to simulate invocation. Before starting the conversation, the Harness reloads the
app-server Skill catalog for the Scenario repository and requires one enabled exact
name-and-entrypoint identity match; the catalog path is the path sent in the structured input and recorded in the Turn
observation. Later replies continue the same private Codex conversation without repeating the
invocation. Direct delivery does not invent an `$implement` invocation.

## Adaptive Human Orchestrator

The current top-level Codex is the sole Human Orchestrator. It reads each complete Agent response,
authors the next concise natural reply, and decides when the Scenario is terminal. Deterministic
support never chooses a reply and never manufactures `pass`, `fail`, or `blocked`. For every
non-passing verdict, the Orchestrator also records one semantic failure category: `test-system` for
harness, transport, fixture, permission, or evidence failure; `activation` when the applicable Skill
or required reference was not loaded; `contract` when loaded instructions were ambiguous,
contradictory, or insufficient; `product` when followed instructions reached faulty Bearing code or
provider behavior; or `agent-adherence` when clear loaded instructions were not followed.
Deterministic support validates and preserves this attribution but never derives it. Attribution
does not alter the verdict or create release authority. Select the earliest causally sufficient
category; an Agent's unsupported claim that a Skill was unavailable is not activation evidence.

Simple Scenarios target no more than three replies after the Initial Prompt. This is a soft
interaction budget, not a timeout or result rule. Productive discussion or execution may continue;
repetitive drill-down is recorded as workflow friction.

A committed wrong writeback, unauthorized mutation, false completion, missing required owner
return, or other already-observed Bearing contract violation is terminal `fail`. Do not reveal the
missing internal operation or ask the Agent to retry it. A trustworthy transport interruption may
resume only the same conversation before a semantic result exists. If continuity cannot be proven,
finalize `blocked`. A recovered pass requires the interrupted Turn to contain no Agent reply and no
repository or Agent Home change, followed through the retained private session by a clean completed
Turn. A semantic result cannot be restarted, retried, or resampled inside its Generation.

Judge owner composition at turn boundaries. An exact owner-required concurrency claim before
Bearing admission is not by itself a failure. At most one applicable provider synchronization may
follow the settled native writes of one Turn; a later Turn with new writes may synchronize again.
A Human Handoff does not require synchronization. Before the Agent reports Workflow Completion for
a request with pending bound native subjects, one reconciliation must cover the complete Pending
Native Write Set. A skipped Human-Handoff synchronization carries its unsynchronized subjects into
the next Turn. Repeated same-Turn capture or reconciliation is a workflow failure rather than a
recovery path.

At most four Scenarios may be active. One Scenario has at most one active Turn. Independent
Scenarios may continue after another fails so the Generation yields the complete truthful result
set.

A mechanical failure before Codex invocation rolls back only the unobserved start reservation, so
the same Scenario may still start once. After one Turn has durable observation or resumable session
continuity, the Scenario retains its active slot until finalization even when that Turn is incomplete.
Cross-process recovery must prove both the lifecycle owner and spawned Codex child have terminated;
missing child identity abandons the Generation rather than guessing or killing an unknown process.
Sealing a result releases the slot; later cleanup failure cannot reopen or mutate conversation or
result evidence.

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
- `complete-matrix` requires exactly one identity-bound result for every Scenario selected in the
  Generation and publishes only their summary. A complete Matrix selects all registered Scenarios;
  a focused Generation remains explicitly partial.

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
- one Matrix result citing the exact Generation and selected Scenario result set and summarizing
  outcomes, durations, slow observations, and actual peak concurrency.

Session identity stays private. Durable references must remain below the Matrix evidence root,
exclude credentials and session state, and pass digest verification. Deterministic checks may reject
missing or changed evidence, unsafe paths, identity mismatch, unrecovered incomplete Turns,
credential leakage, or an incomplete result set. If Turn bytes fail the required secret scan, publish only a synthetic
failed observation that names the rejection class, then let the Orchestrator seal `blocked`; never
publish the rejected bytes or establish resumable session state. Scan each complete readable
conversation before replacing its durable copy. Seal the exact Orchestrator verdict before terminal
capture, and seal the Scenario result before runner-owned cleanup. Git terminal commands stream no
more than 256 KiB per output and record an explicit truncation marker at that boundary. These checks
do not evaluate Bearing Intent.

A post-invocation mechanical rejection also records its bounded execution stage and a sanitized,
length-limited Error name and message in both the synthetic event and main Turn observation. It
never records a stack, raw rejected output, credential, private session identity, or ephemeral
capability value; a diagnostic that cannot pass the required safety scan is replaced by an explicit
unavailable summary.

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
