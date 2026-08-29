# Bounded G1 installation and update rehearsals

This registry contains exactly the two real Codex rehearsals required for the 0.1.2 G1 development
contract. It deliberately stays separate from `validation/live-journey/registry.json`: these
results are not the formal Clean Installation Journey, the full Codex Matrix, Candidate evidence,
publication evidence, Effort Conclusion, Gate Readiness, or Gate Passage.

Both rehearsals must use one package basis prepared from the final tracked G1 source state:

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

Use one Generation UUID. Prepare and run `INSTALL-01` and `UPDATE-01` independently with the
standard `prepare-scenario`, `run-scenario-turn`, and `evaluate-scenario` operations in
`validation/live-journey/generation.md`, substituting this registry path. Do not run
`complete-matrix`; each bounded result stands on its own and can never satisfy a release
prerequisite.

The Coordinator must review the natural requests and semantic outcomes before execution, inspect
the complete private turn evidence, and author each verdict. The Journey Agent's self-report is not
the verdict. Keep the generated package manifest, scenario manifests, observations, verdicts, and
results outside the checkout; transcripts, Codex session identity, credentials, and unrelated
operator state remain private and are removed by evaluation.

Before the rehearsals, run the affected deterministic suites, type checking, build, and package
validation. After both results, run the full repository verification. A failure remains a failure;
do not broaden a Scenario, change model policy, relabel evidence, or substitute a new package
identity to manufacture a pass.
