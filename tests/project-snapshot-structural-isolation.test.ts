import { expect, test } from "bun:test";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;
type DecisionFixture = Readonly<{
  id: string;
  status: "open";
  target: string;
}>;

test("builds a Snapshot while isolating structurally invalid source members", async () => {
  // Given: every affected projection has a trustworthy sibling or independent projection.
  const root = await createValidBearingRepo();
  await writeFixture(root, "evidence/healthy.md", "healthy\n");
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:healthy
    Title: Healthy Asset
    Kind: verification-report
    Location: evidence/healthy.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
  - ID: asset:outside
    Title: Outside Asset
    Kind: verification-report
    Location: ../outside.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Assets
`,
  );
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/healthy.md",
    decision({ id: "alignment-check:healthy", status: "open", target: "effort:test" }),
  );
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/outside.md",
    decision({ id: "alignment-check:outside", status: "open", target: "../outside.md" }),
  );
  await writeFixture(
    root,
    ".bearing/state/planning-reviews/healthy.md",
    review("planning-review:healthy", "pending", []),
  );
  await writeFixture(
    root,
    ".bearing/state/planning-reviews/outside.md",
    review("planning-review:outside", "completed", ["../outside.md"]),
  );
  await writeFixture(root, ".bearing/state/planning-audit.md", invalidAudit());
  await writeFixture(root, ".bearing/state/next-work-guidance.md", invalidGuidance());

  // When: Sync and Snapshot materialization cross the real shared projection path.
  const sync = await runSync(root);
  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });

  // Then: no member failure escapes its owning projection boundary.
  expect(snapshot.assets).toMatchObject({
    validity: "partial",
    items: [{ id: "asset:healthy" }],
    issues: [{ code: "invalid-asset-schema" }],
  });
  expect(snapshot.checks).toMatchObject({
    validity: "partial",
    items: [{ id: "alignment-check:healthy" }],
    issues: [{ code: "invalid-bearing-schema" }],
  });
  expect(snapshot.reviews).toMatchObject({
    validity: "partial",
    items: [{ id: "planning-review:healthy" }],
    issues: [{ code: "invalid-bearing-schema" }],
  });
  expect(snapshot.audit).toMatchObject({
    validity: "invalid",
    issues: [{ code: "invalid-bearing-schema" }],
  });
  expect("guidance" in snapshot).toBe(false);
  expect(snapshot.attention).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "alignment-check", id: "alignment-check:healthy" }),
      expect.objectContaining({ kind: "planning-review", id: "planning-review:healthy" }),
    ]),
  );
});

const decision = (fixture: DecisionFixture): string => `---
Type: alignment-check
ID: ${fixture.id}
Title: Confirm alignment
Status: ${fixture.status}
Target: ${fixture.target}
Inputs: []
Input fingerprint: ${FINGERPRINT}
---

# Alignment Check
`;

const review = (id: string, status: string, changedReferences: readonly string[]): string => `---
Type: planning-review
ID: ${id}
Title: Review the sequence
Status: ${status}
Scope: Entire project
Inputs: []
Input fingerprint: ${FINGERPRINT}
${
  status === "completed"
    ? `Resolution:
  Accepted decision: Keep the boundary.
  Rationale: The project remains contained.
  Changed references:
${changedReferences.map((reference) => `    - ${reference}`).join("\n")}`
    : ""
}
---

# Planning Review
`;

const invalidAudit = (): string => `---
Type: planning-audit
ID: planning-audit:current
Generated at: 2026-07-13T20:00:00+0800
Inputs: []
Input fingerprint: ${FINGERPRINT}
Coverage: incomplete
Skipped targets:
  - ../outside.md
---

# Audit
`;

const invalidGuidance = (): string => `---
Type: next-work-guidance
ID: next-work-guidance:current
Generated at: 2026-07-13T20:00:00+0800
Inputs: []
Input fingerprint: ${FINGERPRINT}
Semantic coverage: absent
---

# Guidance

## Primary Recommendation

### Stay inside the project

Preserve the trusted source boundary.

#### Supporting References

- \`../outside.md\`

## Alternatives

### Inspect the Roadmap

Confirm the accepted horizon.

#### Supporting References

- \`roadmap:test\`

### Inspect the Gate

Confirm the focused boundary.

#### Supporting References

- \`gate:test\`
`;
