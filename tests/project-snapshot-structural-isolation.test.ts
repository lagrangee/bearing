import { expect, test } from "bun:test";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;
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
    ".bearing/state/planning-reviews/healthy.md",
    review("planning-review:healthy", "pending", []),
  );
  await writeFixture(
    root,
    ".bearing/state/planning-reviews/outside.md",
    review("planning-review:outside", "completed", ["../outside.md"]),
  );
  await writeFixture(root, ".bearing/state/planning-audit.md", invalidAudit());

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
      expect.objectContaining({ kind: "planning-review", id: "planning-review:healthy" }),
    ]),
  );
});

const review = (id: string, status: string, changedReferences: readonly string[]): string => `---
Type: planning-review
ID: ${id}
Title: Review the sequence
Status: ${status}
Question: Should the project keep this boundary?
Scope: project
Inputs: []
Input fingerprint: ${FINGERPRINT}
${
  status === "completed"
    ? `Resolution:
  Accepted decision: Keep the boundary.
  Accepted at: 2026-07-13T20:05:00+0800
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
