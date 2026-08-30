# Bounded G1 installation and update rehearsals

This registry contains exactly the two real Codex rehearsals required for the 0.1.2 G1 development
contract. It deliberately stays separate from `validation/live-journey/registry.json`: these
results are not the formal Clean Installation Journey, the full Codex Matrix, Candidate evidence,
publication evidence, Effort Conclusion, Gate Readiness, or Gate Passage.

Preflight the bounded registry before packaging:

```text
bun scripts/run-live-journey.ts preflight-matrix \
  --source-root <exact-checkout> \
  --registry validation/g1-installation-update/registry.json
```

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
both from their prepared manifests. It writes an internal `execution.json` containing only peak
concurrency and `completed` or `invalid` execution state; that file is not another evidence level.

After execution, the Coordinator authors the two verdict inputs and evaluates both registry entries:

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

The Coordinator must review the natural requests and semantic outcomes before execution, inspect
the complete private turn evidence, and author each verdict. The Journey Agent's self-report is not
the verdict. Keep the generated package manifest, scenario manifests, observations, verdicts, and
results outside the checkout; transcripts, Codex session identity, credentials, and unrelated
operator state remain private and are removed by evaluation.

Before the rehearsals, run the affected deterministic suites, type checking, build, and package
validation. After both results, run the full repository verification. A failure remains a failure;
do not broaden a Scenario, change model policy, relabel evidence, or substitute a new package
identity to manufacture a pass.
