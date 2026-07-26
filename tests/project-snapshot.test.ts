import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fingerprintFiles } from "../src/fingerprint";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

const writeCurrentGuidance = async (root: string): Promise<void> => {
  const inputs = [".bearing/state/project-summary.md"];
  const fingerprint = await fingerprintFiles(root, inputs);
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    `---
Type: next-work-guidance
ID: next-work-guidance:current
Title: Current Next Work Guidance
Generated at: 2026-07-13T20:00:00+0800
Inputs:
  - .bearing/state/project-summary.md
Input fingerprint: ${fingerprint.fingerprint}
Semantic coverage: absent
---

# Next Work Guidance

## Primary Recommendation

### Finish the Project Snapshot seam

Build the shared semantic projection before adding more destinations.

#### Supporting References

- \`.scratch/example-work/issues/11-complete-project-overview.md\`

## Alternatives

### Inspect the current Roadmap horizon

Verify that the focused Gate still expresses the accepted sequence.

#### Supporting References

- \`roadmap:test\`

### Run a Planning Audit after the seam is trustworthy

Use a whole-project semantic review after the projection is trustworthy.

#### Supporting References

- \`gate:test\`
`,
  );
};

test("builds one repository-scoped semantic Snapshot without Catalog identity", async () => {
  const root = await createValidBearingRepo();
  await writeCurrentGuidance(root);
  const sync = await runSync(root);

  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });

  expect(snapshot).toMatchObject({
    schemaVersion: 2,
    producer: { packageVersion: "0.0.0-test" },
    basis: { sitemapFingerprint: sync.fingerprint },
    summary: {
      validity: "available",
      value: { id: "project-summary:current", title: "Test Project" },
    },
    roadmapIndex: {
      validity: "available",
      value: { activeRoadmapIds: ["roadmap:test"] },
    },
    roadmaps: { validity: "available", items: [{ id: "roadmap:test" }] },
    gates: { validity: "available", items: [{ id: "gate:test", horizonState: "focused" }] },
    efforts: { validity: "available", items: [{ id: "effort:test" }] },
    audit: { validity: "absent" },
    guidance: {
      validity: "available",
      value: {
        id: "next-work-guidance:current",
        semanticFreshness: "current",
        primary: { title: "Finish the Project Snapshot seam" },
        alternatives: [
          { title: "Inspect the current Roadmap horizon" },
          { title: "Run a Planning Audit after the seam is trustworthy" },
        ],
      },
    },
  });
  expect(snapshot).not.toHaveProperty("entryId");
  expect(snapshot).not.toHaveProperty("repoRoot");
  expect(snapshot).toHaveProperty("authorities");
  expect(snapshot).toHaveProperty("assets");
  expect(snapshot).toHaveProperty("checks");
  expect(snapshot).toHaveProperty("reviews");
  expect(snapshot).toHaveProperty("maps");
  expect(snapshot).toHaveProperty("tickets");
  expect(snapshot.sources.length).toBeGreaterThan(0);
  for (const source of snapshot.sources) {
    expect(source.reference).not.toContain(source.displayLocator);
    expect(source.displayLocator.startsWith("/")).toBe(false);
  }
});

test("isolates an invalid Summary while preserving trustworthy Roadmaps", async () => {
  const root = await createValidBearingRepo();
  const summaryPath = join(root, ".bearing/state/project-summary.md");
  const summary = await readFile(summaryPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    summary.replace("## Purpose", "## Goal"),
  );
  const sync = await runSync(root);

  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });

  expect(snapshot.summary.validity).toBe("invalid");
  expect(snapshot.roadmaps.validity).toBe("available");
  expect(snapshot.attention.some((item) => item.kind === "structural-diagnostic")).toBe(true);
});

test("consumes Guidance freshness computed by Sync", async () => {
  const root = await createValidBearingRepo();
  await writeCurrentGuidance(root);
  await writeFixture(root, "CONTEXT.md", "# Changed context\n");
  const sync = await runSync(root);

  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });

  expect(snapshot.guidance.validity).toBe("available");
  if (snapshot.guidance.validity !== "available") throw new Error("Expected Guidance fixture.");
  expect(snapshot.guidance.value.semanticFreshness).toBe("current");

  await writeFixture(root, ".bearing/state/project-summary.md", "changed after guidance\n");
  const staleSync = await runSync(root);
  const stale = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: staleSync.inputs,
    sitemapFingerprint: staleSync.fingerprint,
    diagnostics: staleSync.diagnostics,
    advisoryFreshness: staleSync.advisoryFreshness,
  });
  expect(stale.guidance.validity).toBe("available");
  if (stale.guidance.validity !== "available") throw new Error("Expected retained Guidance.");
  expect(stale.guidance.value.semanticFreshness).toBe("stale");
});

test("projects adversarial native diagnostics without echoing source details into prose", async () => {
  // Given: native statuses, blocker text, and an Asset path contain formatting-shaped scalars.
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".scratch/work/issues/02-invalid-status.md",
    `# Invalid status

Type: task
Status: **bad**

## Question

Can the project remain readable?
`,
  );
  await writeFixture(
    root,
    ".scratch/work/issues/03-invalid-blocker.md",
    `# Invalid blocker

Type: task
Status: open
Blocked by: **missing**

## Question

Can the diagnostic remain plain?
`,
  );
  const mapPath = join(root, ".scratch/work/map.md");
  const map = await readFile(mapPath, "utf8");
  await writeFixture(
    root,
    ".scratch/work/map.md",
    map.replace("Status: resolved", "Status: **bad**"),
  );
  const effortPath = join(root, ".bearing/state/efforts/test.md");
  const effort = await readFile(effortPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/efforts/test.md",
    effort.replace(
      "Citations: []",
      "Citations:\n  - Asset: asset:missing\n    Note: Inspect the missing evidence.",
    ),
  );
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:missing
    Title: Missing evidence
    Kind: verification-report
    Location: evidence/**missing**.md
    Owner: effort:test
    Producer:
      Kind: executor-profile
      Name: generic-agent
    Lifecycle source: native
---

# Asset Registry
`,
  );
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/invalid-target.md",
    `---
Type: alignment-check
ID: alignment-check:invalid-target
Title: Confirm the target
Status: open
Target: asset:**bad**
Inputs: []
Input fingerprint: sha256:${"a".repeat(64)}
---

# Alignment Check
`,
  );

  // When: Sync diagnostics cross the normalized Snapshot boundary.
  const sync = await runSync(root);
  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });

  // Then: fixed plain prose reaches Diagnostics and every blocking fact reaches Attention.
  const expected = new Map([
    ["unsupported-tracker-status", "Tracker-native Ticket Status is not supported."],
    ["missing-ticket-blocker", "Tracker-native Ticket blocker does not resolve."],
    ["unsupported-map-status", "Wayfinder Map Status is not supported."],
    ["missing-asset-input", "Referenced Asset Location is unavailable."],
    ["invalid-bearing-schema", "Bearing frontmatter does not match its minimum schema."],
  ]);
  for (const [code, message] of expected) {
    const diagnostic = snapshot.diagnostics.find((candidate) => candidate.code === code);
    expect(diagnostic?.message).toBe(message);
    expect(diagnostic?.message).not.toContain("**");
    expect(
      snapshot.attention.some(
        (item) =>
          item.kind === "structural-diagnostic" &&
          item.diagnosticReference === diagnostic?.reference,
      ),
    ).toBe(true);
  }
  expect(snapshot.checks).toMatchObject({
    validity: "invalid",
    issues: [{ code: "invalid-bearing-schema" }],
  });
});
