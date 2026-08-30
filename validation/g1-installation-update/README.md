# Bounded G1 installation and update rehearsals

This registry contains exactly the two real Codex rehearsals required for the 0.1.2 G1 development
contract. It deliberately stays separate from `validation/live-journey/registry.json`: these
results are not the formal Clean Installation Journey, the full Codex Matrix, Candidate evidence,
publication evidence, Effort Conclusion, Gate Readiness, or Gate Passage.

Check the bounded registry definition before packaging:

```text
bun scripts/run-live-journey.ts check-matrix-definition \
  --source-root <exact-checkout> \
  --registry validation/g1-installation-update/registry.json
```

This is a deterministic definition check, not a second execution surface. It
starts no Agent and creates no Generation or result. `prepare-generation` below
still performs the fresh package, Fixture, Skill, permission, isolation, and
starting-state preflight for this Generation.

Both rehearsals must then use one package basis prepared from the final tracked G1 source state:

```text
bun scripts/run-live-journey.ts prepare-local-rehearsal \
  --source-root <exact-checkout> \
  --registry validation/g1-installation-update/registry.json \
  --package-output <new-external-package-directory>
```

For this bounded registry, package preparation also resolves the fixed published
`@lagrangee/bearing@0.1.1` artifact and records its exact tarball digest in the package basis.
`UPDATE-01` installs that artifact as the older complete Kit; it does not synthesize an older
version by changing target-package metadata. `INSTALL-01` additionally fails preparation unless
the Coordinator records a verified macOS `/bin/zsh` runtime identity, which is then fixed in the
Scenario manifest and launch environment.

Use one Generation UUID and the same Generation-level runner surface as the full Matrix:

```text
bun scripts/run-live-journey.ts prepare-generation \
  --source-root <exact-checkout> \
  --registry validation/g1-installation-update/registry.json \
  --package-manifest <package-output>/local-rehearsal-package.json \
  --workspace <new-external-evidence-root>/generation \
  --codex-home <operator-codex-home> \
  --prerequisite-skill-root <trusted-installed-skill-root> \
  --generation-id <uuid>

bun scripts/run-live-journey.ts run-generation \
  --generation <new-external-evidence-root>/generation/generation.json
```

The two Scenarios remain isolated and semantically independent, but one `run-generation` schedules
both from their prepared manifests. It writes a disposable Coordinator handoff,
`execution.json`, containing only the Generation ID, actual peak concurrency, and
each Scenario's `completed` runner state only after the whole run succeeds. That
state is not a semantic outcome or another evidence level. Any Harness, runner,
isolation, or effect uncertainty rejects `run-generation` and writes no
`execution.json`; neither Scenario can then be evaluated. Discard the private
workspace and use a fresh Generation rather than authoring a result set from it.

After a successful `run-generation`, the Coordinator authors the two verdict inputs and evaluates
both registry entries:

```text
bun scripts/run-live-journey.ts evaluate-scenario \
  --generation <new-external-evidence-root>/generation/generation.json \
  --manifest <new-external-evidence-root>/generation/scenarios/INSTALL-01/scenario-manifest.json \
  --verdicts <private-install-verdict-input> \
  --output <new-external-evidence-root>/results/INSTALL-01.json

bun scripts/run-live-journey.ts evaluate-scenario \
  --generation <new-external-evidence-root>/generation/generation.json \
  --manifest <new-external-evidence-root>/generation/scenarios/UPDATE-01/scenario-manifest.json \
  --verdicts <private-update-verdict-input> \
  --output <new-external-evidence-root>/results/UPDATE-01.json
```

Stop after the two Scenario results. Do not aggregate this bounded registry with
`complete-matrix`; each result stands on its own and can never satisfy a release prerequisite.
Because `complete-matrix` is intentionally not called, delete `execution.json`
after both results are complete. Retain each result together with every observation
it references. Delete the entire private Generation workspace only when the two
bounded results are retired with it or their observation pointers are no longer
needed. This is ordinary cleanup, not a new CLI command, cleanup protocol, or state
machine.

The Coordinator must review the natural requests and semantic outcomes before execution, inspect
the complete private turn evidence, and author each verdict. The Journey Agent's self-report is not
the verdict. Keep all generated material outside the checkout while the bounded review is active;
transcripts, Codex session identity, credentials, and unrelated operator state remain private and
are removed by evaluation or the ordinary workspace cleanup above.

Before the rehearsals, run the affected deterministic suites, type checking, build, and package
validation. After both results, run the full repository verification. A failure remains a failure;
do not broaden a Scenario, change model policy, relabel evidence, or substitute a new package
identity to manufacture a pass.
