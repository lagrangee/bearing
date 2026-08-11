# Codex E2E Policy

This is the repository-wide execution policy for every current or future Codex E2E matrix case, automated Codex journey, Codex live gated E2E, and Codex release smoke journey in this repository.

## Required model configuration

Every Codex E2E journey must run with:

- Model: `gpt-5.6-luna`
- Reasoning effort: `high`

The launch must make both values explicit. A conforming invocation includes:

```text
codex exec --model gpt-5.6-luna --config 'model_reasoning_effort="high"'
```

Journey-specific isolation, sandbox, output, profile, prompt, and working-directory arguments may be added without weakening these two required values.

Do not inherit the model or reasoning effort from operator configuration, a profile, an environment default, or a previous session. Do not select a low-cost substitute, retry with another model, or fall back when `gpt-5.6-luna` with `high` reasoning is unavailable. Unavailability blocks that Codex E2E result.

## Matrix and harness contract

A matrix or plan may declare the requirement once when it unambiguously applies to every Codex journey row. Each harness or runbook must still construct or show the explicit model and reasoning arguments used for every launch, including resumed, retried, negative, reproduction, release-smoke, and expanded non-blocking journeys.

If a shared launcher is introduced, it must own these fixed arguments and reject caller overrides that select a different model or reasoning effort. Do not duplicate a configurable default across individual journeys.

## Evidence

Current candidate evidence must record:

- the exact source/package candidate identity;
- the Codex CLI version;
- requested model `gpt-5.6-luna`;
- requested reasoning effort `high`;
- whether the real Codex invocation started and reached its expected terminal boundary.

The evidence need not retain credentials, full transcripts, session identifiers, machine-specific paths, or unrelated operator configuration. A higher-level release receipt may cite the journey evidence without repeating the model fields.

Historical reports and receipts remain historical and are not rewritten. A historical journey used as evidence for a new candidate must be rerun under this policy.

## Change boundary

Changing the required Codex model or reasoning effort is a repository-level test-policy decision. An Effort, ticket, release runbook, environment variable, or operator preference may not weaken it locally.

## Release Live Journey

Before coordinating a Bearing release, or defining, running, or reviewing a release Live Journey,
read and follow the [Release Live Journey Runbook](release-live-journey.md).
