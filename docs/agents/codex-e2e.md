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
reach a selected remote provider or a required loopback product surface only through a bounded
runner-owned capability that preserves the declared scope. No Scenario receives general network
egress.

Do not inherit the model or reasoning effort from operator configuration, a profile, an environment
default, or a previous session. Do not use another model as a fallback. Unavailability blocks that
Scenario result.

## Runtime isolation

The support runner creates one fresh Codex runtime home inside each isolated Scenario Agent home.
It can link only the operator `auth.json` needed for the real invocation. It does not expose the
operator configuration, instructions, skills, session history, or other runtime state as product
context. Agent-mediated installation integrates Skills only inside the isolated home.

The Scenario Agent receives only its natural user requests, exact package, isolated Agent home, and
visible repository or provider state. It must not follow the authentication link, infer or inspect
the operator home, or inspect the Coordinator-only source checkout. Any such read invalidates the
Scenario observation.

The Scenario manifest and tracked registry are Coordinator-only because they contain Scenario
identity and semantic criteria. They stay outside the Agent repository and home. For the complete
Codex child lifetime, the runner removes read permission from the manifest and uses the native
Codex named permission profile to deny every read from the complete Coordinator source checkout,
including Git objects, plus the exact registry when a test fixture places it elsewhere. The runner restores
Coordinator access only after the child exits. Agent-readable prompts and installation files
contain no criteria or answer hints.

Scenario preparation and Agent execution are separate harness phases. Complete all Scenario
preparation before launching an Agent child. Do not prepare or reprepare a Scenario while any Agent
child is active. Up to two already-prepared Agent children can run concurrently. Before a fresh
reprepare, wait for all active children to end. Before each turn, the runner rescans the opaque
Scenario runtime roots and denies every other runtime root to that child.

For the GitHub Scenario, the runner can add only the operator's GitHub account selection to the
isolated home. It does not copy a token or unrelated GitHub configuration to disk. A short-lived
per-turn broker resolves the token through the operator credential store and exposes only a bounded
`gh` command capability for the fixed private validation repository. Every write is limited to
Issues identified by the exact current scope key; creation must carry that key, and relation source
and target Issues must already carry it. The Human does not authorize
each turn again after authorizing the validation run.

The token must not enter the Agent environment, manifest, transcript, or durable evidence. The
broker uses authenticated messages over one fixed Unix-domain socket, remains available for the
complete Codex child lifetime, and removes the socket after the turn. Its Generation-local socket
path and local capability value stay stable across resumed turns; its process and token remain
per-turn. The broker fails closed for credential reads, cross-repository targets, destructive API
methods, file-backed inputs, and Agent-supplied GraphQL. Missing isolated access blocks the Scenario before
behavior. A socket collision is a harness failure. Do not add a filesystem mailbox, polling
protocol, or application retry.

## Matrix and Scenario contract

The tracked Matrix is `validation/live-journey/registry.json`. It contains a complete, stable set of
independent behavior-driven Scenarios. Each Scenario starts from one verified identity-bound
Fixture and one fresh Agent conversation. Scenarios do not share sessions, transcripts, or
Agent-produced state. Continue independent Scenarios after one fails while the Generation remains
active. An accepted identity-changing fix abandons that Generation instead of spending time on an
obsolete package or Matrix definition.

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

The shared launcher owns the fixed model arguments and rejects caller overrides. Every initial,
resumed, retried, negative, reproduction, and release launch uses the same policy.

## Evidence

Current Matrix evidence records:

- the evidence class and exact local-package or Candidate identity;
- the Matrix definition and Generation identities;
- the Scenario and Fixture starting-state identities;
- the Codex CLI version, requested model, and requested reasoning effort;
- whether every real Codex invocation started and reached its terminal boundary; and
- the Coordinating Agent's rationale and required and forbidden outcome observations.

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
