import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readProjectSnapshotCache } from "../src/project-snapshot/cache";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

const materialize = async (
  root: string,
): Promise<Readonly<{ snapshot: ProjectSnapshot; duplicateDiagnosticCount: number }>> => {
  const sync = await runSync(root);
  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
  return {
    snapshot,
    duplicateDiagnosticCount: sync.diagnostics.filter(
      (diagnostic) => diagnostic.code === "duplicate-stable-id",
    ).length,
  };
};

test("isolates every colliding Roadmap when legal sources declare one Stable ID", async () => {
  // Given: two independently valid Roadmap sources declare the same Stable ID.
  const root = await createValidBearingRepo();
  const roadmap = await readFile(join(root, ".bearing/state/roadmaps/test.md"), "utf8");
  await writeFixture(root, ".bearing/state/roadmaps/duplicate.md", roadmap);

  // When: Sync materializes the repository-scoped Snapshot.
  const { snapshot, duplicateDiagnosticCount } = await materialize(root);

  // Then: neither ambiguous Roadmap is available and its Index relation is scoped partial.
  expect(duplicateDiagnosticCount).toBe(2);
  expect(snapshot.roadmaps).toMatchObject({
    validity: "invalid",
    issues: [
      { code: "duplicate-stable-id", target: ".bearing/state/roadmaps/duplicate.md" },
      { code: "duplicate-stable-id", target: ".bearing/state/roadmaps/test.md" },
    ],
  });
  expect(snapshot.roadmapIndex).toMatchObject({
    validity: "partial",
    value: { activeRoadmapIds: [], completedRoadmapIds: [], supersededRoadmapIds: [] },
    issues: [{ code: "roadmap-index-target-unavailable", target: "roadmap:test" }],
  });
});

test("isolates every colliding Gate and its ambiguous Roadmap relation", async () => {
  // Given: two independently valid Gate sources declare the same Stable ID.
  const root = await createValidBearingRepo();
  const gate = await readFile(join(root, ".bearing/state/milestone-gates/test.md"), "utf8");
  await writeFixture(root, ".bearing/state/milestone-gates/duplicate.md", gate);

  // When: Sync materializes the repository-scoped Snapshot.
  const { snapshot, duplicateDiagnosticCount } = await materialize(root);

  // Then: both Gates and the Roadmap relation that references them are scoped out.
  expect(duplicateDiagnosticCount).toBe(2);
  expect(snapshot.gates).toMatchObject({
    validity: "invalid",
    issues: [
      { code: "duplicate-stable-id", target: ".bearing/state/milestone-gates/duplicate.md" },
      { code: "duplicate-stable-id", target: ".bearing/state/milestone-gates/test.md" },
    ],
  });
  expect(snapshot.roadmaps).toMatchObject({
    validity: "invalid",
    issues: [{ code: "ambiguous-canonical-reference", target: ".bearing/state/roadmaps/test.md" }],
  });
  expect(snapshot.roadmapIndex).toMatchObject({
    validity: "partial",
    value: { activeRoadmapIds: [] },
    issues: [{ code: "roadmap-index-target-unavailable", target: "roadmap:test" }],
  });
});

test("isolates every colliding Asset declared inside one valid Registry", async () => {
  // Given: two independently valid Asset entries declare the same Stable ID.
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:design
    Title: First design baseline
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: planning-skill
      Name: prototype
    Lifecycle source: registry
    Disposition: available
  - ID: asset:design
    Title: Second design baseline
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: planning-skill
      Name: prototype
    Lifecycle source: registry
    Disposition: available
---

# Assets
`,
  );

  // When: Sync materializes the repository-scoped Snapshot.
  const { snapshot, duplicateDiagnosticCount } = await materialize(root);

  // Then: neither ambiguous Asset enters the normalized collection.
  expect(duplicateDiagnosticCount).toBe(2);
  expect(snapshot.assets).toMatchObject({
    validity: "invalid",
    issues: [
      { code: "duplicate-stable-id", target: ".bearing/state/assets.md#asset:design" },
      { code: "duplicate-stable-id", target: ".bearing/state/assets.md#asset:design" },
    ],
  });
});

test("isolates colliding decision identities before deriving Attention", async () => {
  // Given: two Checks and two Reviews independently declare one ID per decision type.
  const root = await createValidBearingRepo();
  const fingerprint = `sha256:${"a".repeat(64)}`;
  const check = `---
Type: alignment-check
ID: alignment-check:duplicate
Title: Confirm one decision
Status: open
Target: roadmap:test
Inputs: []
Input fingerprint: ${fingerprint}
---
`;
  const review = `---
Type: planning-review
ID: planning-review:duplicate
Title: Review one decision
Status: pending
Scope: Current project direction
Inputs: []
Input fingerprint: ${fingerprint}
---
`;
  await writeFixture(root, ".bearing/state/alignment-checks/one.md", check);
  await writeFixture(root, ".bearing/state/alignment-checks/two.md", check);
  await writeFixture(root, ".bearing/state/planning-reviews/one.md", review);
  await writeFixture(root, ".bearing/state/planning-reviews/two.md", review);

  // When: Sync materializes the repository-scoped Snapshot.
  const { snapshot, duplicateDiagnosticCount } = await materialize(root);

  // Then: ambiguous decisions are invalid and cannot become last-wins Attention items.
  expect(duplicateDiagnosticCount).toBe(4);
  expect(snapshot.checks).toMatchObject({ validity: "invalid" });
  expect(snapshot.reviews).toMatchObject({ validity: "invalid" });
  expect(snapshot.attention.filter((item) => item.kind !== "structural-diagnostic")).toEqual([]);
});

test("rejects duplicate Snapshot collection and relation identities", async () => {
  // Given: one valid Snapshot and tampered duplicate identities at collection and relation seams.
  const root = await createValidBearingRepo();
  const { snapshot } = await materialize(root);
  if (
    snapshot.roadmaps.validity !== "available" ||
    snapshot.roadmapIndex.validity !== "available"
  ) {
    throw new Error("Expected the identity fixture to contain available Roadmaps.");
  }
  const roadmap = snapshot.roadmaps.items[0];
  if (roadmap === undefined) throw new Error("Expected one Roadmap fixture item.");
  const duplicateCollection = {
    ...snapshot,
    roadmaps: { validity: "available", items: [roadmap, roadmap] },
  };
  const duplicateGateOrder = {
    ...snapshot,
    roadmaps: {
      validity: "available",
      items: [{ ...roadmap, gateOrder: ["gate:test", "gate:test"] }],
    },
  };
  const overlappingIndex = {
    ...snapshot,
    roadmapIndex: {
      validity: "available",
      value: {
        ...snapshot.roadmapIndex.value,
        completedRoadmapIds: ["roadmap:test"],
      },
    },
  };
  const sourceRecord = snapshot.sources[0];
  if (sourceRecord === undefined) throw new Error("Expected one Source Record fixture item.");
  const duplicateSources = { ...snapshot, sources: [sourceRecord, sourceRecord] };
  const attention = {
    kind: "structural-diagnostic",
    diagnosticReference: `diagnostic:${"d".repeat(64)}`,
  };
  const duplicateAttention = { ...snapshot, attention: [attention, attention] };

  // When / Then: every ambiguous identity shape is rejected at the Snapshot boundary.
  expect(projectSnapshotSchema.safeParse(duplicateCollection).success).toBe(false);
  expect(projectSnapshotSchema.safeParse(duplicateGateOrder).success).toBe(false);
  expect(projectSnapshotSchema.safeParse(overlappingIndex).success).toBe(false);
  expect(projectSnapshotSchema.safeParse(duplicateSources).success).toBe(false);
  expect(projectSnapshotSchema.safeParse(duplicateAttention).success).toBe(false);
});

test("treats a cache with duplicate collection identity as malformed", async () => {
  // Given: valid Snapshot bytes are tampered to contain two Roadmaps with one identity.
  const root = await createValidBearingRepo();
  const { snapshot } = await materialize(root);
  if (snapshot.roadmaps.validity !== "available") {
    throw new Error("Expected the cache fixture to contain available Roadmaps.");
  }
  const roadmap = snapshot.roadmaps.items[0];
  if (roadmap === undefined) throw new Error("Expected one Roadmap fixture item.");
  const target = join(root, ".bearing/cache/project-snapshot.json");
  await mkdir(join(root, ".bearing/cache"), { recursive: true });
  await writeFile(
    target,
    `${JSON.stringify({
      ...snapshot,
      roadmaps: { validity: "available", items: [roadmap, roadmap] },
    })}\n`,
    "utf8",
  );

  // When: Portal reads the untrusted cache boundary.
  const cached = await readProjectSnapshotCache(root);

  // Then: no last-wins Snapshot escapes to Overview.
  expect(cached).toEqual({ kind: "malformed", reason: "invalid-snapshot" });
});
