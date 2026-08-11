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

A change to the product, Skill, release-facing documentation, fixture, Journey, Case contract, or
release workflow invalidates the Candidate. Start Candidate Freeze and the full three-Journey Matrix
again. Never combine evidence from different identities.

## Human checkpoints

1. Natural-language release start — accept a request such as "Release the current Bearing version."
   Do not require a command, form, or version-specific checklist.
2. Claude Code and WorkBuddy results — prompt for the two attended compatibility results only after
   the exact Candidate and Codex Matrix are ready.
3. Protected environment approval — GitHub requests this approval after the Agent dispatches the
   protected Publication workflow. The protected publication environment is the only Human `Go`.
4. Final Gate decision — present the separated evidence after public readback and ask the Human to
   accept or reject Gate Passage.

The Human does not need the Matrix Case order, release commands, retry rules, or evidence schema.
Report a blocker and its resumption point when the next checkpoint is not ready.

## 1. Inspect prerequisites

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

## 2. Coordinate Candidate Freeze

Dispatch the component-owned Candidate Freeze for the exact source commit and package version. Wait
for its successful terminal result. Download the private Candidate artifact and verify the Candidate
Receipt and tarball without changing either file.

Record the exact Candidate identity from the verified receipt. Keep the workflow run identity and
frozen bytes together. A mutable branch, `latest`, an unpacked working tree, or a different tarball is
not the Candidate.

Completion criterion: one verified Candidate Receipt and its matching frozen tarball are available
locally, and their source commit still satisfies the release prerequisites.

## 3. Enter the exact Candidate locally

Use the tracked support runner to prepare a fresh local generation. Read
`bun scripts/run-live-journey.ts --help` for the current command surface. Supply the verified
Candidate Receipt, matching tarball, exact source root, a fresh workspace, and a fresh isolated Agent
home.

Use the generated ignored `README.local.md` as the installation entry. It lets an Agent follow the
real public installation behavior while consuming frozen local bytes. Verify the generated Candidate
manifest, local entry overlay, fixture, and Matrix digest before an Agent turn starts. Do not install
from mutable source or public `latest`.

Completion criterion: the local manifest and overlay resolve to the verified Candidate identity and
the prepared generation has no identity mismatch.

## 4. Run the Codex Matrix

Follow the tracked Matrix manifest, English Journey instructions, and support-runner interfaces. Run
the Clean, GitHub, and Safety Journeys as one generation. The Coordinating Agent evaluates all 18
Cases from conversation, tool activity, before-and-after state, provider outcomes, diagnostics, typed
Inspect, and Portal readback. Journey Agent self-report and deterministic tooling are not semantic
pass authorities.

Continue independent Journeys after a semantic failure to collect the issue set. Mark dependent or
contaminated Cases `not-run`. A pre-behavior model, network, credential, or harness block can resume
only the affected Journey with the same Candidate and Matrix identities in a fresh fixture. A
semantic failure is not resampled. An identity or tracked-definition change requires a new full
generation.

Completion criterion: the single typed Matrix result records all 18 required Cases. Release
readiness requires every Case to be `pass`.

## 5. Collect Human compatibility

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

Do not copy the 18 Codex Cases into either lane. A clean profile, screenshots, full transcript, or
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

## 6. Dispatch protected Publication

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

## 7. Read back the public release

After successful Publication, run the tracked read-only public readback against the Candidate
Receipt. Verify exact npm identity and provenance, immutable tag target, GitHub Release notes and
asset digests, and Pages deployment source. Then open the public README, linked Agent installation
guidance, static demo, feedback routes, and private vulnerability reporting route.

Keep this readback bounded. It does not publish, reinstall the package, run packaged CLI smoke,
launch an Agent, rerun the Browser suite, or rerun the Matrix. Report an unavailable or conflicting
surface with the exact public prefix and resumption point. Preserve already-public immutable state.

Completion criterion: exact public identity and every required user-entry route match the Candidate
Receipt and intended release content, or the result names the exact incomplete public prefix.

## 8. Hand off final evidence

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
owner, unchanged state, and exact resumption point. Keep evidence already valid for the same identity.
Restart Candidate Freeze and the full Matrix when a tracked change invalidates that identity.

A concise blocker is sufficient. Resume from the named stage after its owner restores the required
fact. Keep the four Human checkpoints as the complete interaction contract; do not create additional
approval artifacts or release ceremonies.
