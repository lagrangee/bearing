# Codex E2E Policy

This is the repository-wide execution policy for every Codex E2E Matrix, independent Live
Scenario, live gated E2E, and Codex release smoke in this repository.

## Required model configuration

Every Codex E2E Scenario must run with:

- Model: `gpt-5.6-luna`
- Reasoning effort: `high`

The launch must make both values explicit. A conforming invocation includes:

```text
codex exec --model gpt-5.6-luna --config 'model_reasoning_effort="high"'
```

Scenario-specific sandbox, output, prompt, and working-directory arguments can be added without
weakening these values. The shared launcher denies direct sandbox network access. A Scenario can
reach a selected remote provider only through an existing bounded runner-owned capability that
preserves the declared scope. No Scenario receives general network egress or a product loopback
surface.

Do not inherit the model or reasoning effort from operator configuration, a profile, an environment
default, or a previous session. Do not use another model as a fallback. Unavailability blocks that
Scenario result.

## Runtime isolation

The support runner creates one fresh Codex runtime home inside each isolated Scenario Agent home.
It copies only the operator `auth.json` needed for the real invocation into one runtime-owned
regular file and denies that file to Agent tools through the verified permission profile. It does
not expose the operator locator, configuration, instructions, skills, session history, or other
runtime state as product context. Agent-mediated installation integrates Skills only inside the
isolated home.

The Scenario Agent receives only its natural user requests, exact package, isolated Agent home, and
visible repository or provider state. It must not inspect the authentication file, infer or inspect
the operator home, or inspect the Coordinator-only source checkout. Any such read invalidates the
Generation. Do not produce a Matrix result from that Generation; diagnose the fault outside the
Generation and use a fresh Generation for the next observation.

The Scenario manifest and tracked registry are Coordinator-only because they contain Scenario
identity and semantic criteria. They stay outside the Agent repository and home. For the complete
Codex child lifetime, the runner removes read permission from the manifest and uses the native
Codex named permission profile to deny every read from the complete Coordinator source checkout,
including Git objects, plus the exact registry when a test fixture places it elsewhere. The runner restores
Coordinator access only after the child exits. Agent-readable prompts and installation files
contain no criteria or answer hints.

Scenario preparation and Agent execution are separate harness phases. Complete the Generation
preflight and all selected Scenario preparation before launching an Agent child. Run prepared
Scenarios with rolling concurrency four: start the next registry entry whenever an active Scenario
reaches a terminal boundary. Turns declared in one Scenario continue sequentially in that
Scenario's one fresh conversation. That normal continuation is part of its single execution
opportunity; it does not authorize recovery of a failed or partial execution. Before each turn, the
runner revalidates the prepared launch. All Scenario runtimes live below one private temporary
container; the final permission profile denies that container and re-allows only the current
Scenario repository and home. Admission probes that exact final profile before Agent behavior.

For the GitHub Scenario, the runner can add only the operator's GitHub account selection to the
isolated home. It does not copy a token or unrelated GitHub configuration to disk. A short-lived
per-turn broker resolves the token through the operator credential store and exposes only a bounded
`gh` command capability for the fixed private validation repository. Every write is limited to
Issues identified by the exact current scope key; creation must carry that key, and relation source
and target Issues must already carry it. The Human does not authorize
each turn again after authorizing the validation run.

The token must not enter the Agent environment, manifest, transcript, or durable evidence. The
existing bounded broker fails closed for credential reads, cross-repository targets, destructive
API methods, file-backed inputs, and Agent-supplied GraphQL. Missing isolated access blocks the
Scenario before behavior. Do not add another broker, filesystem mailbox, polling protocol, product
loopback, or general capability framework.

## Matrix and Scenario contract

The tracked Matrix is `validation/live-journey/registry.json`. It contains a complete, stable set of
independent behavior-driven Scenarios. Each Scenario starts from one verified identity-bound
Fixture and one fresh Agent conversation. Scenarios do not share sessions, transcripts, or
Agent-produced state. Each Scenario has one execution opportunity. A failure or partial execution
ends it. Do not automatically retry,
resume, reattach, restore a checkpoint, or resample it. Continue independent Scenarios after one
fails while the Generation identity remains valid. Collect the complete failure set before fixing
an owner outside the Generation; any accepted identity-changing fix requires a fresh Generation.
No elapsed-time threshold terminates a Scenario; timing is an optimization observation.

`check-matrix-definition` is a standalone deterministic definition check for the registry,
Fixtures, Skill declarations, fixed model and effort, and declared capabilities. It starts no
Agent, creates no Generation or result, and is not a second Matrix execution surface. Every real
execution still begins with `prepare-generation`, which performs the fresh Generation preflight.

The only Matrix execution surface is:

```text
prepare-generation -> run-generation -> evaluate-scenario x registry -> complete-matrix
```

`prepare-generation` writes the durable `generation.json` basis and all private Scenario
manifests. `run-generation` executes those prepared Scenarios once and writes the internal
`execution.json` handoff only when every Scenario reaches a valid completed runner boundary.
`evaluate-scenario` writes one terminal result for every registry entry.
`complete-matrix` writes the one Matrix result after the exact result set exists. Do not expose a
second per-Scenario preparation or turn-execution command.

Do not convert the Matrix into one long story or a provider-file script. The Scenario Agent does
not receive the registry, Scenario identifiers, required or forbidden outcomes, expected commands,
confirmation counts, Coordinator-only answers, or hidden implementation choices. A natural user
request or Fixture work item may name the real task target needed to ask for the work, such as a
README or public function; that target is part of the request, not a leak. The Agent chooses any
contract-valid workflow that satisfies the natural request.

Structured Skill invocation is explicit-only at the current noninteractive host boundary. In
particular, `codex exec` cannot inject a structured invocation for a Skill that disables model
invocation. A natural prompt therefore cannot prove that Wayfinder or another named Skill ran.
Automated Matrix Scenarios score user-visible contract outcomes, not a required Skill name or
invocation path. This boundary does not create a manual gate or authorize a second runner.

Provider-native byte shape, parser behavior, exact schema, broker allowlists, sandbox behavior,
credential isolation, and evidence schema belong at deterministic contract seams. The Live Matrix
tests whether the Agent can read those contracts, make semantic judgments, preserve consent and
scope, compose owners, and report truthful outcomes.

The Coordinating Agent is the only semantic evaluation authority. It uses the complete observed
workflow and flexible semantic judgment. Deterministic support can reject identity mismatch,
missing turns, forbidden state, unauthorized remote changes, or another contradiction. It cannot
manufacture a semantic pass.

The shared launcher owns the fixed model arguments and rejects caller overrides. Every Scenario,
negative, focused-probe, rehearsal, and release launch uses the same policy.

## Evidence

Current Matrix evidence has only three durable levels:

- one Generation basis, `generation.json`, with the evidence class and exact package identity digest; registry,
  Fixture-definition, and Harness digests; start time; fixed model, reasoning effort, and
  concurrency; ordered Scenario IDs; and fresh Fixture, Skill, permission, and optional GitHub
  preparation readbacks;
- one terminal result per Scenario with the Generation and Scenario IDs, Coordinator authority,
  semantic outcome, rationale, bounded observation pointers and digests, and per-turn and
  whole-Scenario start and end timestamps; and
- one Matrix result that references every registered Scenario result and the Generation basis, then
  records the terminal summary, Generation end timestamp, actual peak concurrency, and slow
  observations.

The Generation start timestamp is recorded in its basis. Scenario and Turn results record their
own start and end timestamps; durations are derived from those pairs. Do not add Preparation,
Queue, evaluation, publication, or other phase timing state.

A valid complete Matrix has exactly one `pass`, `fail`, or `blocked` terminal result for every
registered Scenario. `invalid` and `not-run` are not durable Scenario or Matrix outcomes, and a
missing result prevents completion. A Generation-level Harness, isolation, or effect fault
rejects `run-generation` as a whole, writes no `execution.json`, and therefore permits neither
evaluation nor Matrix completion. Diagnose it outside the Generation and use a fresh Generation.

The Scenario result itself does not copy separate before-state or after-state evidence classes;
its bounded observation pointers identify the state the Coordinator inspected.

`execution.json` carries only the Generation ID, actual peak concurrency, and each Scenario's
`completed` execution state between the runner, evaluator, and aggregator. It exists only for a
valid Generation; any Harness, runner, isolation, or effect uncertainty rejects the run without
writing this handoff. It is not a semantic result, is not cited by the Matrix result, and is not a
fourth durable or release-evidence level. `complete-matrix` removes the handoff after writing a
valid final result. The Codex CLI version belongs to verified per-turn runtime observations, not the Generation
basis. A Scenario result does not repeat the Fixture starting-state identity already bound by the
Generation preparation readback.

Evidence does not retain credentials, unnecessary full transcripts, session identifiers,
machine-specific private paths, or unrelated operator configuration. A higher-level release result
can cite Scenario results without repeating model fields.

Historical reports remain historical and are not current Matrix inputs. A Scenario used as
evidence for a new package or Candidate is rerun under this policy. Local rehearsal evidence cannot
become Candidate evidence by relabeling or reuse.

## Change boundary

Changing the required Codex model or reasoning effort is a repository-level test-policy decision.
An Effort, Ticket, runbook, environment variable, or operator preference cannot weaken it locally.

## Release Live Journey

Before coordinating a Bearing release, or defining, running, or reviewing a release Live Journey,
read and follow the [Release Live Journey Runbook](release-live-journey.md).
