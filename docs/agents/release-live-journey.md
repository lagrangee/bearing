# Release Live Journey Runbook

Use this runbook for each Bearing release. The Coordinating Agent owns the sequence. The Human owns
four checkpoints. Component workflows remain the authority for Candidate Freeze and Publication.

Read the [Codex E2E Policy](codex-e2e.md) before you define, run, resume, retry, or review the Codex
Matrix. That policy is the only authority for Codex model, reasoning, launch, and evidence
requirements. This runbook does not create local defaults for them.

Bind all pre-publication evidence to one exact Candidate identity:

- package version;
- source commit;
- Candidate workflow name, run ID, and run attempt;
- tarball SHA-256 from the verified Candidate Receipt.

For the Live Journey exact-Candidate binding, also record the Matrix definition digest from the
prepared local generation. This digest does not change the Release Candidate bytes; it prevents
evidence reuse after a Matrix definition change. The Matrix generation ID stays separate. Evidence
that uses the Matrix must match the Release Candidate identity, Matrix definition digest, and
generation ID.

Before the first public effect, a change to the product, Skill, release-facing documentation,
Fixture, Scenario contract, Matrix registry, or release workflow invalidates the Candidate. Start
Candidate Freeze and the complete Matrix again. Never combine evidence from different identities.

After Publication has created an exact immutable public prefix, a recovery-only tracked repair may
continue the same Candidate only when it does not change the frozen Candidate bytes, package
version, target repository, mutation order, or intended public state. Merge that repair through a
pull request with required CI and obtain fresh protected-environment approval. The repair does not
require a new Candidate Freeze or Matrix because it changes only Publication observation or
recovery mechanics; any product, package, Skill, release-facing documentation, Fixture, Scenario,
Matrix, identity, or public-semantics change remains invalidating. Preserve and revalidate every
existing public effect before the repaired workflow performs the next mutation.

Use a local Matrix rehearsal before this formal release sequence. Rehearsal and frozen-Candidate
proof use the same tracked Scenario registry, Codex policy, black-box interaction, and
Coordinator judgment. Their evidence classes stay separate: rehearsal finds and fixes defects;
only the later frozen-Candidate Matrix can satisfy the release prerequisite.

## Human checkpoints

1. Natural-language release start — accept a request such as "Release the current Bearing version."
   Do not require a command, form, or version-specific checklist.
2. Claude Code and WorkBuddy results — prompt for the two attended compatibility results only after
   the exact Candidate and Codex Matrix are ready.
3. Protected environment approval — GitHub requests this approval after the Agent dispatches the
   protected Publication workflow. The protected publication environment is the only Human `Go`.
4. Final Gate decision — present the separated evidence after public readback and ask the Human to
   accept or reject Gate Passage.

The Human does not need the Scenario registry details, release commands, retry rules, or evidence schema.
Report a blocker and its resumption point when the next checkpoint is not ready.

## 1. Qualify the Matrix locally

Build one local package and freeze the complete tracked Scenario registry and Fixture definition.
Run every independent Scenario as `local-rehearsal` evidence. This evidence can find product and
harness defects. It cannot prove Candidate readiness, Human compatibility, Publication readiness,
or Gate Passage.

Before packaging, run the Matrix preflight and complete the Coordinating Agent semantic review in
`validation/live-journey/generation.md`. Use its stabilization probes and convergence checkpoints
until the definitions and package are stable. These checks do not replace the final complete local
Generation.

Use the loop in `validation/live-journey/generation.md`. Run one turn at a time. When a turn does
not pass, classify the cause before any change:

- Product, Skill, release-facing document, prompt semantic, Fixture, or Matrix registry: repack,
  create a new Generation, and restart the affected Scenario first as a regression probe. Earlier
  Scenario passes are only historical diagnostics and do not enter the new Matrix result. After
  the probe passes, run every registered Scenario in that Generation before completing the Matrix.
- Runner, broker, sandbox, or harness: keep the Generation only when visible package and Matrix
  identities remain exact. Rerun the current turn once from its recorded local checkpoint only when
  remote state is unchanged. Restart that Scenario from a fresh Fixture after unrecorded local
  drift, any remote effect, or a crossed turn boundary.
- Transient model, network, or credential failure before behavior: preserve the attempt and permit
  one bounded retry of the same turn.
- Semantic failure: do not resample it. Record the Coordinator verdict. Continue other independent
  Scenarios only while the Generation remains active; an accepted identity-changing fix abandons
  it immediately.

The Coordinating Agent uses semantic judgment from the complete observations. It does not require
an exact command, file, confirmation count, or provider operation order. Deterministic tests remain
the authority for provider shape and harness mechanics.

Prepare every Scenario before starting Agent execution. Do not prepare or reprepare while an Agent
child is active. At most two already-prepared Agent children can run concurrently. Before a fresh
Scenario restart, wait for all active children to end. Each turn must use the runner's current
runtime-root rescan so that the child cannot read another Scenario runtime.

Continue until one local package passes every registered Scenario. A failed-Scenario-first probe
reduces feedback time but is not Matrix evidence by itself. Merge accepted fixes through protected
`main`, then begin source finalization. The frozen Candidate runs the complete Matrix again because
its source, bytes, workflow identity, and evidence class differ.

Completion criterion: one current local package passes the complete Matrix and every accepted fix
is ready to enter protected `main`, without creating Candidate or public release state.

## 2. Finalize the release source

Start this stage only after all accepted Candidate-sensitive product, Skill, documentation, Matrix,
release-workflow, and deterministic-cleanup changes are in protected `main`. Confirm that no other
accepted Candidate-sensitive delivery is waiting to merge.

On one exact source commit, select the intended stable package version. Read back the public package
metadata and lockfile identity, one final dated changelog section, and the release notes derived from
that same section. The target version must not remain `Unreleased`. Read the release-facing README,
Agent installation guidance, static demo, feedback routes, security guidance, and Known Exceptions
from the same source. Record Known Exceptions as an explicit list or as confirmed none.

Finalization uses an ordinary Pull Request into protected `main`. Both the implementation PR and the
exact main merge commit must have the six required CI contexts. Only then record `Release Content
Complete` with the exact source commit, package version, changelog and release-notes identity,
release-facing content basis, and CI basis.

This stage does not dispatch Candidate Freeze or Publication. It creates no Candidate, npm version,
tag, GitHub Release, environment approval, or Gate outcome. Any later Candidate-sensitive tracked
change invalidates `Release Content Complete` and requires a new exact-main finalization readback.
Private evidence capture does not change the source identity.

Completion criterion: one exact main source is final, has successful required CI, and is ready for
the component-owned Candidate Freeze without creating Candidate or public release state.

## 3. Inspect prerequisites

Reload current canonical lifecycle facts and current provider or CI evidence. Confirm all of these
facts before Candidate Freeze:

- each required component Effort is canonically concluded;
- release-facing README, Agent installation guidance, static demo, feedback routes, and security
  route guidance are final;
- bounded validation cleanup has current evidence in the existing six-context CI topology;
- the intended version and source commit are on `main`; and
- Known Exceptions are explicit and do not contradict a required release prerequisite.

Resolved Tickets, green tests, Receipts, provider completion, or Portal readback are supporting
evidence. They do not replace canonical Effort conclusions. If a fact is missing, stale, partial, or
conflicting, stop and identify the exact prerequisite owner and resumption point.

Completion criterion: every required prerequisite has a current, identity-bearing source of truth.

## 4. Coordinate Candidate Freeze

Dispatch the component-owned Candidate Freeze for the exact source commit and package version. Wait
for its successful terminal result. Download the private Candidate artifact and verify the Candidate
Receipt and tarball without changing either file.

Record the exact Candidate identity from the verified receipt. Keep the workflow run identity and
frozen bytes together. A mutable branch, `latest`, an unpacked working tree, or a different tarball is
not the Candidate.

Completion criterion: one verified Candidate Receipt and its matching frozen tarball are available
locally, and their source commit still satisfies the release prerequisites.

## 5. Enter the exact Candidate locally

Use `prepare-candidate-package` to bind the verified Receipt, matching tarball, exact source
checkout, executing runner checkout, and current tracked Matrix definition. The generated package
basis retains the Receipt locator and digest; each Scenario preparation revalidates the basis,
Receipt, tarball package metadata, and exact checkout before Agent behavior. Choose one new
Generation UUID. Use
`prepare-scenario` for every registry entry with that same package and Generation. Give each
Scenario a new external workspace and the same operator authentication source.
Read `bun scripts/run-live-journey.ts --help` for the current command surface.

The generated `README.local.md` lets the installation Scenario follow the public Agent guidance
while consuming frozen local bytes. Other Scenarios receive the installed exact package and their
verified precondition. `DELIVERY-02` also receives the fixed private validation checkout. The
runner validates package, registry, Fixture, remote identity, and prompt bytes before turn 1. Do not
install from mutable source or public `latest`.

Completion criterion: every Scenario manifest resolves to the same verified Candidate, Matrix
digest, Generation, and required isolated baseline.

## 6. Run the frozen Candidate Matrix

Follow `validation/live-journey/registry.json`, the Codex E2E policy, and the support-runner
interface. Run every independent Scenario. The Coordinating Agent evaluates each Scenario from the
complete conversation, tool activity, before-and-after state, provider outcomes, diagnostics,
typed Inspect, and relevant Portal or remote readback. The Scenario Agent's self-report and
deterministic tooling are not semantic pass authorities.

Continue independent Scenarios after a semantic failure while the Candidate Generation remains
active. Apply the same recovery classification as the local rehearsal. A changed Candidate or
tracked definition abandons the Generation and requires a new complete Generation. Never carry a
Scenario pass across that identity change.

Completion criterion: the single typed Matrix result records every registered Scenario. Release
readiness requires every Scenario to be `pass`.

## 7. Collect Human compatibility

Give Claude Code and WorkBuddy the same exact Candidate used by Codex. Then proactively request one
result for each attended lane. The Human can use the real product at a practical depth. Each lane
must cover these checkpoints in one coherent flow:

1. Agent-mediated installation from the exact local Candidate entry.
2. The activation boundary before and after Human-confirmed setup.
3. Repository Configuration without product-specific Bearing behavior.
4. One explicit feature-scope decision.
5. One representative complex owner-composed workflow.
6. Exact reconciliation and typed or Portal readback.
7. A truthful outcome that matches observed state.

Do not copy the Codex Scenario registry into either lane. A clean profile, screenshots, full transcript, or
separate report is not required. Accept the Human's concise `pass`, `fail`, or `anomaly` result with
enough detail to locate a blocker.

The WorkBuddy result must come from real WorkBuddy Desktop behavior. CodeBuddy CLI, a deep link,
Codex, Claude, or manual file manipulation cannot substitute for that lane. The product keeps one
capability-oriented installation contract; it does not add a WorkBuddy compatibility layer.

A missing Human result is missing evidence. Another Agent's pass, silence, or Agent inference does
not complete a lane. For `fail` or `anomaly`, preserve the exact Candidate identity, observed blocker,
and resumption point. Keep the lane incomplete until the Human reports a new observation against the
same identity. Do not replace the failed or anomalous lane with another Agent, compatibility layer,
or inferred result. Use a new full generation if the Candidate or tracked behavior changes.

Completion criterion: both attended lanes have a Human-reported result for the same exact Candidate,
and both required lanes are `pass` before Publication dispatch.

## 8. Dispatch protected Publication

Re-read the Candidate Receipt and confirm that component readiness, the Matrix result, both Human
compatibility results, and Known Exceptions still match its exact identity. Read the package version,
source commit, Candidate workflow/run identity, and frozen digest directly from that receipt. Dispatch
only the component-owned protected main Publication capability with those inputs.

The protected publication environment asks the Human for checkpoint 3. Do not add a chat approval or
approve on the Human's behalf. The Publication workflow owns frozen-byte verification, npm mutation,
installed-package and signature smoke, immutable tag creation, GitHub Release creation, and monotonic
recovery. The Coordinating Agent does not perform those mutations locally.

A bounded retry can continue only for the same Candidate, scope, target, and workflow semantics. A
material identity or semantic change requires fresh protected-environment approval.

Completion criterion: the protected Publication workflow has one truthful terminal outcome for the
exact Candidate. A partial or failed outcome preserves its actual monotonic prefix.

## 9. Read back the public release

After successful Publication, run the tracked read-only public readback against the Candidate
Receipt. Verify exact npm identity and provenance, immutable tag target, GitHub Release notes and
asset digests, and Pages deployment source. Then open the public README, linked Agent installation
guidance, static demo, feedback routes, and private vulnerability reporting route.

Run the readback with the exact values from the Candidate Receipt:

```text
bun run release:public-smoke -- --candidate-receipt <absolute-path> \
  --version <exact-version> --source-commit <exact-commit> \
  --workflow-name <candidate-workflow-name> --workflow-run-id <run-id> \
  --workflow-run-attempt <run-attempt> --frozen-sha256 <tarball-sha256>
```

The command writes one JSON result to standard output. An incomplete result exits nonzero and names
the exact public prefix and resumption point. It does not write evidence files or change a public
surface. The Coordinating Agent may redirect the output into its existing private evidence location.

Keep this readback bounded. It does not publish, reinstall the package, run packaged CLI smoke,
launch an Agent, rerun the Browser suite, or rerun the Matrix. Report an unavailable or conflicting
surface with the exact public prefix and resumption point. Preserve already-public immutable state.

Completion criterion: exact public identity and every required user-entry route match the Candidate
Receipt and intended release content, or the result names the exact incomplete public prefix.

## 10. Hand off final evidence

Present component readiness, Candidate proof, the one Matrix result, Claude Code result, WorkBuddy
result, Publication outcome, public readback, and Known Exceptions as separate facts. Publication,
public readback, and Gate Passage are separate outcomes. None implies another.

At Human checkpoint 4, ask for the final Gate decision. Record only the Human's actual decision. Do
not infer Passage from successful automation, compatibility, Publication, public availability, or
silence. Gate acceptance does not automatically conclude the release Effort; use the owning Bearing
Planning Transaction when the Human authorizes that lifecycle change.

Completion criterion: the Human can identify the exact Candidate, see each evidence boundary, and
make the Gate decision without reconstructing the release sequence.

## Failure and resumption

For each stop, report the failed stage, exact Candidate identity when one exists, observed blocker,
owner, recorded current state, and exact resumption point. Keep evidence already valid for the same
identity. Restart Candidate Freeze and the full Matrix when a tracked change invalidates that
identity.

A concise blocker is sufficient. Resume from the named stage after its owner restores the required
fact. Keep the four Human checkpoints as the complete interaction contract; do not create additional
approval artifacts or release ceremonies.
