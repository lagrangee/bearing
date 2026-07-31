import { expect, test } from "bun:test";
import { buildAssetProjection } from "../src/project-snapshot/assets";
import { prepareSync } from "../src/sync-plan";
import { createValidBearingRepo, writeFixture } from "./helpers";

test("projects Asset provenance before trustworthy reverse relations are rebuilt", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/efforts/test.md",
    `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities:
  - authority:design
Citations:
  - Asset: asset:design
    Note: Governs the current implementation.
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/work
---

# Effort

## Intent

Exercise Asset relations.

## Work

- [Map](map.md)
`,
  );
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:design
    Title: Design baseline
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
  await writeFixture(
    root,
    ".bearing/state/authorities/design.md",
    `---
Type: authority
ID: authority:design
Title: Design
Baseline:
  - asset:design
---

# Authority

## Scope

Project design.

## Current Baseline

The registered design.
`,
  );
  const gatePath = ".bearing/state/milestone-gates/test.md";
  await writeFixture(
    root,
    gatePath,
    `---
Type: milestone-gate
ID: gate:test
Title: Test Gate
Roadmap: roadmap:test
Status: active
Effort order:
  - effort:test
Passage:
  Accepted decision: Keep the evidence attached.
  Rationale: It demonstrates the relation.
  Evidence:
    - asset:design
  Exceptions: []
---

# Gate

## Intent

Reach the boundary.

## Exit Criteria

- Resolve the fixture.
`,
  );
  const sync = await prepareSync(root);
  const projected = await buildAssetProjection({
    records: sync.decoded.records,
    sitemapFingerprint: sync.fingerprint,
    contentObservations: sync.assetContentObservations,
  });
  expect(projected.assets).toMatchObject({
    validity: "available",
    items: [
      {
        id: "asset:design",
        owner: "effort:test",
        producer: { kind: "planning-skill", name: "prototype" },
        lifecycleSource: "registry",
        disposition: "available",
        contentAvailability: "available",
        citations: [],
        adoptedByAuthorityIds: [],
        gatePassageEvidenceFor: [],
        citationCount: 0,
      },
    ],
  });
  expect(projected.sources[0]).toMatchObject({ kind: "asset", fragment: "asset:design" });
});

test("isolates an invalid Asset entry and reports missing content without Attention", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:missing
    Title: Missing source
    Kind: context
    Location: docs/missing.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: registry
    Disposition: available
  - ID: asset:formatted
    Title: "**Formatted Asset**"
    Kind: context
    Location: docs/formatted.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Assets
`,
  );
  const sync = await prepareSync(root);
  const projected = await buildAssetProjection({
    records: sync.decoded.records,
    sitemapFingerprint: sync.fingerprint,
    contentObservations: sync.assetContentObservations,
  });
  expect(projected.assets.validity).toBe("partial");
  if (projected.assets.validity !== "partial") return;
  expect(projected.assets.items[0]?.contentAvailability).toBe("missing");
  expect(projected.assets.issues).toHaveLength(1);
});

test("isolates an Asset with a traversing Location without hiding healthy entries", async () => {
  // Given: one trustworthy Asset and one structurally unsafe Asset source.
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
  - ID: ""
    Title: Empty ID Asset
    Kind: verification-report
    Location: evidence/empty.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Assets
`,
  );

  // When: the Asset Registry crosses the normalized projection boundary.
  const sync = await prepareSync(root);
  const projected = await buildAssetProjection({
    records: sync.decoded.records,
    sitemapFingerprint: sync.fingerprint,
    contentObservations: sync.assetContentObservations,
  });

  // Then: only the invalid entry is isolated and the healthy Asset remains readable.
  expect(projected.assets).toMatchObject({
    validity: "partial",
    items: [{ id: "asset:healthy", contentAvailability: "available" }],
    issues: [
      { code: "invalid-asset-schema", target: ".bearing/state/assets.md#asset:outside" },
      { code: "invalid-asset-schema", target: ".bearing/state/assets.md#entry-3" },
    ],
  });
});

test("reports a contained Asset directory as available without reading its content", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(root, "evidence/run/report.md", "verification evidence\n");
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:run
    Title: Verification run
    Kind: verification-report
    Location: evidence/run
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Assets
`,
  );
  const sync = await prepareSync(root);

  const projected = await buildAssetProjection({
    records: sync.decoded.records,
    sitemapFingerprint: sync.fingerprint,
    contentObservations: sync.assetContentObservations,
  });

  expect(projected.assets).toMatchObject({
    validity: "available",
    items: [{ id: "asset:run", displayLocation: "evidence/run", contentAvailability: "available" }],
  });
});

test("keeps an external Asset locator display-only and reports its content as unreadable", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:external
    Title: External evidence
    Kind: verification-report
    Location: https://example.test/evidence/report
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Assets
`,
  );
  const sync = await prepareSync(root);

  const projected = await buildAssetProjection({
    records: sync.decoded.records,
    sitemapFingerprint: sync.fingerprint,
    contentObservations: sync.assetContentObservations,
  });

  expect(projected.assets).toMatchObject({
    validity: "available",
    items: [
      {
        id: "asset:external",
        displayLocation: "https://example.test/evidence/report",
        contentAvailability: "unreadable",
      },
    ],
  });
});
