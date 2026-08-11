# Live Journey Matrix Generation

This instruction is for the Coordinating Agent. Read `docs/agents/codex-e2e.md` before work.

## One generation

Use one exact Candidate Receipt and one tracked Matrix definition. Prepare Clean first. Prepare
GitHub and Safety from the verified Clean manifest. The three Journey results must have the same
generation ID, Candidate identity, Matrix definition digest, Codex CLI and launch policy, and
Coordinator identity.

Run all three Journeys even when one independent Journey finds a semantic failure. In a Journey,
mark a later Case `not-run` when an earlier failure contaminates its required state. Do not replace
a `fail` by sampling the same behavior again.

Only a `blocked` result caused by model, network, credential, or harness failure before tested
behavior starts can make the affected Journey eligible for a rerun. Keep the Candidate and Matrix
identity unchanged and use a fresh fixture. Record the block reason and the false
`testedBehaviorStarted` fact in the Coordinator verdict. The bounded Journey result binds those
facts and its fixture digest. The rerun check consumes that result; it does not accept replacement
reason or behavior-boundary assertions from its caller. A product, Skill, fixture, Journey, Case
contract, Candidate, or Matrix change starts a new complete generation. Never combine Case passes
from different generations.

## Semantic evaluation

The Coordinating Agent is the only semantic evaluation authority. Give each Journey Agent only the
natural request and real state described in the Journey instruction. Do not give it this file,
Matrix definitions, Case identifiers, pass criteria, expected commands, or expected file effects.

For every Case, record one of `pass`, `fail`, `blocked`, or `not-run`, one bounded single-line
judgment basis, generated observation pointers, and an optional relative sanitized failure pointer.
Every `blocked` Case also records its bounded pre-behavior block disposition.
Do not retain credentials, unrelated operator configuration, machine-specific private paths,
unnecessary transcripts, session identifiers, or unrelated repository content.

The support runner validates identity, fixed launch fields, hard observables, evidence shape, and
the complete 18-Case aggregation. It can reject contradictory evidence. It does not create a
semantic Case pass.

## Complete the result

After the three bounded Journey results exist, create the only Matrix result:

```text
bun scripts/run-live-journey.ts complete-matrix \
  --clean-result <workspace>/clean-result.json \
  --github-result <workspace>/github-result.json \
  --safety-result <workspace>/safety-result.json \
  --output <workspace>/matrix-result.json
```

The output satisfies the release prerequisite only when all 18 required Cases are `pass`. Any
other outcome makes the generation non-passing. This result is release evidence only. It does not
conclude an Effort, publish a release, or pass a Milestone Gate. Before the support runner writes
each bounded Journey result and the final generation result, it requires Gitleaks 8.30.1 and scans
the exact durable bytes. An unavailable or different scanner version, or a finding, stops that
write without retaining scanner output. The release CLI has no scanner override.

Historical G1 or G2 Gate wrappers, the Setup Reliability matrix, and the Architecture Contraction
candidate suite are not inputs to this generation. Their owners decide their retention or removal.
