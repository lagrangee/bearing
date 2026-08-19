# Agent Live Matrix Generation

This instruction is for the Coordinating Agent. Read `docs/agents/codex-e2e.md` first. The tracked
`registry.json` is the executable semantic definition. Provider bytes, parser behavior, broker
allowlists, sandbox rules, and evidence schemas remain deterministic test contracts.

## Preflight the Matrix

Run the deterministic Fixture preflight before packaging:

```text
bun scripts/run-live-journey.ts preflight-matrix \
  --source-root <current-checkout> \
  --registry validation/live-journey/registry.json
```

The preflight validates the registry, tracked Fixture sources, and declared starting-state
assertions. It cannot approve Scenario meaning. The Coordinating Agent must review every natural
request against its Fixture and required and forbidden outcomes. The request must provide enough
information for semantic judgment, and the outcomes must constrain observable behavior rather
than a hidden owner, command, file, or confirmation sequence. Complete this review before a full
Generation starts.

## Freeze one package and Matrix definition

Use `local-rehearsal` while product, Skill, prompt, fixture, or Matrix behavior can still change:

```text
bun scripts/run-live-journey.ts prepare-local-rehearsal \
  --source-root <current-checkout> \
  --package-output <new-external-package-directory>
```

This writes `local-rehearsal-package.json` plus its generated digest sidecar. It records source
HEAD, product-sensitive worktree digest, exact tarball digest, and the digest of `registry.json`
plus all tracked Fixtures. Scenario preparation validates the basis digest and reads package name
and version from the tarball. It is not a Release Candidate and cannot satisfy a release
prerequisite.

After Candidate Freeze, create the separate `release-candidate` package basis:

```text
bun scripts/run-live-journey.ts prepare-candidate-package \
  --candidate-receipt <verified-receipt> --tarball <matching-tarball> \
  --source-root <exact-candidate-checkout> \
  --package-output <new-external-package-directory>
```

The Candidate package basis retains the verified Receipt locator and digest. Every Scenario
preparation revalidates that Receipt and binds it to the tarball, Candidate identity, exact source
checkout, and the checkout that executes the runner. Never run a formal Matrix from a different or
dirty harness checkout while pointing `--source-root` at the Candidate.

Never relabel rehearsal evidence as Candidate evidence. A product, Skill, release-facing document,
prompt semantic, Fixture, registry, or package change requires a new package and Generation. A
runner, broker, sandbox, or harness-only repair can keep the Generation only when the visible
package and Matrix identities remain exact.

When definitions or product bytes are still changing, run the affected or semantic-heavy Scenario
first as a stabilization probe in a throwaway workspace. Probe results are diagnostic only. If a
probe changes the package or Matrix definition, repeat preflight and package preparation. Start one
complete Generation only after the affected probes pass and the definitions are stable.

## Prepare independent Scenarios

Prepare the fixed private GitHub validation checkout once per local checkout. This is operator
configuration. It is not a Scenario and does not write remote work:

```text
bun scripts/run-live-journey.ts configure-github-repository \
  --source-root <fixed-private-checkout> \
  --github-repository <owner/name>
```

Choose one UUID and one external root for the Generation. Create each Scenario workspace at
`<generation-root>/<scenario-id>` and write bounded results to `<generation-root>/results`. The
`matrix-status` command reads this fixed operator layout. Prepare every Scenario in registry order:

```text
bun scripts/run-live-journey.ts prepare-scenario \
  --source-root <exact-checkout> \
  --registry validation/live-journey/registry.json \
  --scenario <scenario-id> \
  --package-manifest <local-or-candidate-package.json> \
  --workspace <generation-root>/<scenario-id> \
  --codex-home <operator-codex-home> \
  --generation-id <generation-uuid>
```

For `DELIVERY-02`, also supply the clean fixed private checkout with `--github-checkout` and start
with `--journey-attempt 1`. The runner verifies the checkout-local fixed repository configuration,
private remote identity, access, fresh candidate scope key, and remote baseline. It copies no token.
Each turn receives a temporary bounded broker capability; the operator does not authorize each turn
again. If a harness failure crosses a turn boundary after visible state changes, preserve the
Generation, move the failed Scenario workspace out of the active Scenario slot, prepare a fresh
`DELIVERY-02` workspace with the next `--journey-attempt`, and rerun that Scenario from turn 1. The
attempt changes only the isolated remote scope identity; it does not change package or Matrix
identity.

Each Scenario gets a fresh repository or provider baseline, Agent home, Codex session, prompts,
observations, and private transcripts. Do not reuse another Scenario's Agent output or session.
The harness may materialize a verified precondition. It must not materialize the behavior under
test. The Coordinator manifest and tracked registry contain the criteria and stay outside the Agent
repository and home. While the Codex child runs, the manifest has no read permission and the native
Codex named permission profile denies all reads from the complete Coordinator source checkout,
including Git objects, plus the exact registry if it is outside that checkout.

## Run one Scenario

Run each generated prompt in order:

```text
bun scripts/run-live-journey.ts run-scenario-turn \
  --manifest <scenario-manifest.json> \
  --turn <positive-integer> \
  --prompt-file <generated-prompt>
```

The Scenario Agent sees only the natural request, exact package, isolated Agent home, and visible
repository or provider state. It never sees the registry, required outcomes, forbidden outcomes,
expected commands, expected files, or Coordinator verdict.

Classify a failed attempt before recovery:

- Product, Skill, prompt semantic, Fixture, or Matrix contract: change the source, repack, start a
  new Generation, and restart that Scenario first as a regression probe. After it passes, run every
  registered Scenario in the same Generation before completing the Matrix.
- Runner, broker, sandbox, or harness: keep the Generation only while package and Matrix identity
  remain exact. Use one `harness` retry of the current turn from its recorded local checkpoint when
  remote state is unchanged. Local repository progress from the rejected attempt may be resumed;
  unrecorded local drift, any remote effect, or a crossed turn boundary requires a fresh Scenario.
- Transient model, network, or credential failure before behavior: preserve the attempt and permit
  one bounded retry of the same turn.
- Semantic failure: do not resample it. Evaluate it truthfully. Continue other independent
  Scenarios only while the Generation remains active; an accepted identity-changing fix abandons
  it immediately.

After the Coordinating Agent classifies an eligible failure, run the same generated prompt once
more with `--retry-reason model`, `network`, `credential`, or `harness`. The first three reasons are
valid only before tested behavior. `harness` is valid after a rejected behavior attempt only when
remote state stayed unchanged and the current repository matches the recorded local checkpoint.
Unrecorded drift or a crossed turn boundary requires a fresh Scenario. The runner rejects a second
retry.

## Convergence checkpoints

Inspect progress after each bounded Scenario result and before any pause or resume:

```text
bun scripts/run-live-journey.ts matrix-status \
  --source-root <current-checkout> \
  --registry validation/live-journey/registry.json \
  --generation-root <generation-root>
```

Run a short internal refinement checkpoint after 5, 10, 15, and 20 bounded results, after 30 minutes
without a new bounded result, before a second identity-changing repair in one rehearsal,
or when the same failure class twice indicates a repeated pattern. A progress update is not a
pause. If none of these signals indicates divergence, continue immediately.

At a checkpoint, record the current package and Matrix identity, completed and invalidated
Scenarios, wall time versus Agent-turn duration, and failures grouped as product or Skill, Scenario
or Fixture, runner or harness, or transient environment. Refine only the layer supported by that
evidence. A product or Skill change requires product-contract evidence. A Scenario or Fixture
change returns to preflight and an affected stabilization probe. A runner-only repair preserves the
Generation only when Agent-visible identity stays exact. Resume without a Human checkpoint unless
the evidence exposes a new product decision outside the accepted Matrix contract.

## Product-change evidence gate

Classify the mismatch before editing. A clear implementation defect against a documented contract
belongs to the product implementation. A clear Scenario or Fixture mismatch against that contract
belongs to the Scenario or Fixture. A runner, broker, sandbox, or evidence defect belongs to the
harness. Preserve the contract while repairing any of these layers.

A Skill semantic contract change that changes an owner, authority, consent, lifecycle, trigger,
recovery rule, or user-visible meaning requires a Human decision before editing. An ambiguous or
contradictory product contract has the same boundary. Scenario pass is evidence only; it is never
authority to redefine Bearing. Do not change a Skill semantic contract or Matrix semantics merely
to turn a failure into a pass.

Before changing Bearing implementation to match a documented contract, verify all of these facts:

- The natural request, required outcomes, and forbidden outcomes define a valid user result without
  prescribing one implementation path.
- The Fixture and selected provider contract are correct for that request.
- The Journey used the exact package and isolated runtime, and the Agent loaded the required
  references.
- The observed behavior violates a documented Bearing product contract. A difference from the
  Coordinator's preferred path is not product evidence.
- The proposed change is the smallest contract-aligned correction, has focused regression coverage,
  and will be rerun first in the affected stabilization Scenario.

If any fact is absent, keep Bearing unchanged. Correct the owning Scenario or Fixture when it
misstates the contract, correct the runner or harness when mechanics are wrong, or record the
semantic result truthfully. When the evidence exposes a new product decision, stop at that exact
boundary and present the contract conflict to the Human.

## Coordinator evaluation

The Coordinating Agent is the only semantic pass authority. Read the complete conversation, tool
activity, typed outcomes, before-and-after state, and provider observations. Use judgment. Do not
mechanically compare a command sequence or file layout.

Judge from the user's observable outcome: intent understanding, candidate completeness,
proportionality, consent, authority, side effects, and truthful completion. Accept any safe path
that satisfies the Scenario contract. A different file choice, command order, wording, or
confirmation count is not a failure unless it violates a documented contract or a hard observable.

Write one Coordinator verdict with `outcome`, `rationale`, and every registered required and
forbidden outcome exactly once. Each observation names whether the outcome was observed and cites
one or more final generated `observations/turn-NN-attempt-MM.json` pointers. A bounded retry also
creates `attempts/turn-NN.json`, which binds its reason to the prior attempt. A transient retry
requires unchanged pre-behavior state. A `harness` retry may resume the recorded local checkpoint
only while remote state remains unchanged. For the GitHub Scenario, also record the exact
`authorizedRemoteIssueNumbers` that the accepted
Scenario scope created. The runner rejects any other candidate-key or historical remote delta. A
completed delivery also has one clean commit on the Scenario's isolated remote branch. The
credential broker permits only that bounded push and verifies the remote commit before the Agent
reconciles the affected scope. Then run:

```text
bun scripts/run-live-journey.ts evaluate-scenario \
  --manifest <scenario-manifest.json> \
  --verdicts <coordinator-verdict.json> \
  --output <results>/<scenario-id>.json
```

The prepared Scenario manifest fixes the typed `codex-coordinator` identity for the whole
Generation. Evaluation reads that identity from the manifest; do not enter it again per Scenario.

Deterministic support rejects identity mismatches, missing turns, invalid evidence, forbidden
remote changes, and a `pass` that contradicts hard observations. It cannot create a semantic pass.
Private transcripts, the isolated Agent home, and session identifiers are not durable result
evidence and are removed after evaluation. Bounded observations, remote inventories, and the typed
Scenario result remain.

## Complete the Matrix

Continue independent Scenarios after any failure. Complete the result only after every registered
Scenario has one bounded result:

```text
bun scripts/run-live-journey.ts complete-matrix \
  --source-root <exact-checkout> \
  --registry validation/live-journey/registry.json \
  --results <results-directory> \
  --output <matrix-result.json>
```

All Scenario results must bind the same evidence class, Generation, package, Matrix digest, Codex
runtime, and Coordinator. The Matrix passes only when every Scenario passes. A rehearsal always
records `releasePrerequisiteSatisfied: false`; only an all-pass exact Candidate result can record
`true`. Neither result concludes an Effort, publishes a release, or passes a Milestone Gate.
