import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

const runInitialSync = (root: string) =>
  runSync(root, { providerObservationIntent: "initial-baseline" });

test("projects every Bearing-owned event role without borrowing observation or Sync time", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    `---
Type: roadmap
ID: roadmap:test
Title: Test Roadmap
Status: active
Focused gate: gate:test
Gate order:
  - gate:test
Started at: 2026-07-30T01:02:03.456Z
---

# Roadmap: Test

## Intent

Prove the fixture.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    `---
Type: milestone-gate
ID: gate:test
Title: Test Gate
Roadmap: roadmap:test
Status: active
Effort order:
  - effort:test
Planned at: null
Activated at: 2026-07-30T02:03:04Z
---

# Milestone Gate: Test

## Intent

Reach the fixture boundary.

## Exit Criteria

- All fixture work resolves.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/planning-reviews/adopt-test.md",
    `---
Type: planning-review
ID: planning-review:adopt-test
Title: Adopt the test evidence
Status: completed
Scope: Test
Inputs: []
Input fingerprint: sha256:${"a".repeat(64)}
Resolution:
  Accepted decision: Adopt the test evidence.
  Accepted at: 2026-07-30T03:04:05.678Z
  Rationale: It governs the fixture.
  Changed references:
    - authority:test
---

# Planning Review
`,
  );
  await writeFixture(
    root,
    ".bearing/state/authorities/test.md",
    `---
Type: authority
ID: authority:test
Title: Test Authority
Baseline:
  - asset:test
Adoptions:
  - Asset: asset:test
    Decision: planning-review:adopt-test
---

# Authority: Test

## Scope

Govern the fixture.

## Current Baseline

The test evidence governs this fixture.
`,
  );
  await writeFixture(root, "docs/test.md", "# Evidence\n");
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:test
    Title: Test evidence
    Kind: document
    Location: docs/test.md
    Owner: effort:test
    Producer:
      Kind: external-source
      Name: user
    Lifecycle source: registry
    Disposition: available
    Registered at: null
    Produced at: 2026-07-29
---

# Asset Registry
`,
  );
  const effort = await readFile(join(root, ".bearing/state/efforts/test.md"), "utf8");
  await writeFixture(
    root,
    ".bearing/state/efforts/test.md",
    effort
      .replace("Authorities: []", "Authorities:\n  - authority:test")
      .replace("Planned at: null", "Planned at: 2026-07-30T01:30:00Z"),
  );

  const sync = await runInitialSync(root);
  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });

  expect(snapshot.schemaVersion).toBe(13);
  expect(snapshot.roadmaps.validity).toBe("available");
  expect(
    snapshot.roadmaps.validity === "invalid" ? undefined : snapshot.roadmaps.items[0],
  ).toMatchObject({
    startedAt: {
      availability: "available",
      value: "2026-07-30T01:02:03.456Z",
      precision: "fractional-second",
    },
  });
  expect(snapshot.gates.validity).toBe("available");
  expect(snapshot.gates.validity === "invalid" ? undefined : snapshot.gates.items[0]).toMatchObject(
    {
      plannedAt: { availability: "unavailable" },
      activatedAt: {
        availability: "available",
        value: "2026-07-30T02:03:04Z",
        precision: "second",
      },
    },
  );
  expect(snapshot.efforts.validity).toBe("available");
  expect(
    snapshot.efforts.validity === "invalid" ? undefined : snapshot.efforts.items[0],
  ).toMatchObject({
    plannedAt: {
      availability: "available",
      value: "2026-07-30T01:30:00Z",
      precision: "second",
    },
    activatedAt: { availability: "unavailable" },
  });
  expect(snapshot.reviews.validity).toBe("available");
  expect(
    snapshot.reviews.validity === "invalid" ? undefined : snapshot.reviews.items[0],
  ).toMatchObject({
    resolution: {
      acceptedAt: {
        availability: "available",
        value: "2026-07-30T03:04:05.678Z",
        precision: "fractional-second",
      },
    },
  });
  expect(snapshot.authorities).toMatchObject({ validity: "available" });
  expect(
    snapshot.authorities.validity === "invalid" ? undefined : snapshot.authorities.items[0],
  ).toMatchObject({
    adoptions: [{ assetId: "asset:test", decisionReference: "planning-review:adopt-test" }],
  });
  expect(snapshot.assets.validity).toBe("available");
  expect(
    snapshot.assets.validity === "invalid" ? undefined : snapshot.assets.items[0],
  ).toMatchObject({
    registeredAt: { availability: "unavailable" },
    producedAt: { availability: "available", value: "2026-07-29", precision: "date" },
  });

  expect(snapshot.providerObservations[0]?.observedAt).not.toBe("2026-07-30T01:02:03.456Z");

  if (snapshot.authorities.validity === "invalid") throw new Error("Expected Authorities.");
  const unresolvedAdoption = projectSnapshotSchema.safeParse({
    ...snapshot,
    authorities: {
      ...snapshot.authorities,
      items: snapshot.authorities.items.map((authority) => ({
        ...authority,
        adoptions: authority.adoptions.map((adoption) => ({
          ...adoption,
          decisionReference: "planning-review:missing",
        })),
      })),
    },
  });
  expect(unresolvedAdoption.success).toBe(false);
  expect(
    unresolvedAdoption.success ? [] : unresolvedAdoption.error.issues.map((issue) => issue.message),
  ).toContain("Every Authority Adoption in a complete Decision projection must resolve.");
});

test("keeps inapplicable lifecycle events absent while legacy expected events stay unavailable", async () => {
  const root = await createValidBearingRepo();
  const sync = await runInitialSync(root);
  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });

  const roadmap = snapshot.roadmaps.validity === "invalid" ? undefined : snapshot.roadmaps.items[0];
  const gate = snapshot.gates.validity === "invalid" ? undefined : snapshot.gates.items[0];
  expect(roadmap).toMatchObject({ startedAt: { availability: "unavailable" } });
  expect(roadmap).not.toHaveProperty("completedAt");
  expect(roadmap).not.toHaveProperty("supersededAt");
  expect(gate).toMatchObject({
    plannedAt: { availability: "unavailable" },
    activatedAt: { availability: "unavailable" },
  });
  expect(gate).not.toHaveProperty("supersededAt");
  expect(gate).not.toHaveProperty("passage");
});
