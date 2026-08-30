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
Scenario observation.

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
reaches a terminal boundary. Before each turn, the runner rescans the opaque Scenario runtime roots
and denies every other runtime root to that child.

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
Agent-produced state. Each Scenario has one execution opportunity. Do not automatically retry,
resume, reattach, restore a checkpoint, or resample it. Continue independent Scenarios after one
fails while the Generation identity remains valid. Collect the complete failure set before fixing
an owner outside the Generation; any accepted identity-changing fix requires a fresh Generation.

Do not convert the Matrix into one long story or a provider-file script. The Scenario Agent does
not receive the registry, Scenario identifiers, required or forbidden outcomes, expected commands,
file names, function names, confirmation counts, or Coordinator verdict. It chooses any
contract-valid workflow that satisfies the natural request.

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

- one Generation basis with the evidence class, exact local-package or Candidate identity, Matrix
  definition, Codex CLI version, requested model, requested reasoning effort, and execution
  configuration;
- one terminal result per Scenario with its Fixture starting-state identity, timestamps, verdict,
  rationale, bounded observations, and whether the real invocation reached its terminal boundary;
  and
- one Matrix result that references every registered Scenario result.

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
