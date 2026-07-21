import { expect, test } from "bun:test";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

const writeAuditBasedGuidance = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    `---
Type: next-work-guidance
ID: next-work-guidance:current
Generated at: 2026-07-13T20:01:00+0800
Inputs:
  - .bearing/state/planning-audit.md
Input fingerprint: sha256:${"a".repeat(64)}
Semantic coverage: complete
Based on audit: planning-audit:current
---

# Next Work Guidance

## Primary Recommendation

### Continue the current Gate

Use the audited project horizon.

#### Supporting References

- \`gate:test\`

## Alternatives

### Inspect the Roadmap

Review the accepted sequence.

#### Supporting References

- \`roadmap:test\`

### Review the native Map

Inspect the current work frontier.

#### Supporting References

- \`.scratch/work/map.md\`
`,
  );
};

const project = async (root: string) => {
  const sync = await runSync(root);
  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
  return { snapshot, sync };
};

test("isolates audit-based Guidance when the Planning Audit is absent", async () => {
  // Given: structurally valid Guidance declares the missing current Audit as its semantic basis.
  const root = await createValidBearingRepo();
  await writeAuditBasedGuidance(root);

  // When: Sync and the shared Snapshot projection run from the same repository truth.
  const { snapshot, sync } = await project(root);

  // Then: the broken relation invalidates only Guidance and unrelated orientation stays readable.
  expect(sync.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "broken-canonical-reference",
      target: ".bearing/state/next-work-guidance.md",
    }),
  );
  expect(snapshot.audit).toEqual({ validity: "absent" });
  expect(snapshot.guidance).toEqual({
    validity: "partial",
    value: expect.objectContaining({ semanticCoverage: "complete" }),
    issues: [
      expect.objectContaining({
        code: "unavailable-next-work-guidance-audit-basis",
        message: "Next Work Guidance depends on an unavailable Planning Audit.",
      }),
    ],
  });
  expect(snapshot.summary.validity).toBe("available");
  expect(snapshot.roadmaps.validity).toBe("available");
});

test("isolates audit-based Guidance when the Planning Audit is invalid", async () => {
  // Given: the declared current Audit exists but cannot cross its source schema boundary.
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/planning-audit.md",
    `---
Type: planning-audit
ID: planning-audit:current
Generated at: 2026-07-13T20:00:00+0800
Inputs: []
Input fingerprint: sha256:${"b".repeat(64)}
Coverage: impossible
Skipped targets: []
---

# Planning Audit
`,
  );
  await writeAuditBasedGuidance(root);

  // When: the shared Snapshot projection resolves the advisory graph.
  const { snapshot } = await project(root);

  // Then: both advisory singletons expose scoped invalidity without losing the Project Brief.
  expect(snapshot.audit.validity).toBe("invalid");
  expect(snapshot.guidance).toEqual({
    validity: "partial",
    value: expect.objectContaining({ semanticCoverage: "complete" }),
    issues: [
      expect.objectContaining({
        code: "unavailable-next-work-guidance-audit-basis",
        message: "Next Work Guidance depends on an unavailable Planning Audit.",
      }),
    ],
  });
  expect(snapshot.summary.validity).toBe("available");
});
