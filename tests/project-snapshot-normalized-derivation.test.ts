import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPlanningGraph } from "../src/planning-graph";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { buildProjectSnapshot as buildSnapshot } from "../src/project-snapshot/projection";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import {
  buildProjectSnapshotForTest as buildProjectSnapshot,
  captureDecodedInputs,
} from "./project-snapshot-fixture";

const materialize = async (root: string): Promise<ProjectSnapshot> => {
  const sync = await runSync(root);
  return buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
};

test("keeps Effort lifecycle explicit when provider completion is undetermined", async () => {
  const root = await createValidBearingRepo();
  const path = join(root, ".scratch/work/map.md");
  const source = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".scratch/work/map.md",
    source.replace("Status: resolved", "Status: unsupported"),
  );

  const snapshot = await materialize(root);

  const capture = snapshot.providerObservations.find(
    (candidate) => candidate.binding.nativeScope === ".scratch/work",
  );
  expect(capture).toBeDefined();
  expect(capture?.completion).toBe("undetermined");
  expect(snapshot.efforts).toMatchObject({
    validity: "available",
    items: [{ id: "effort:test", lifecycle: "active" }],
  });
  expect(snapshot.gates).toMatchObject({
    validity: "available",
    items: [{ id: "gate:test", readiness: "unknown" }],
  });
});

test("preserves canonical Effort semantics while binding failures fail closed", async () => {
  const root = await createValidBearingRepo();
  const effortPath = join(root, ".bearing/state/efforts/test.md");
  const source = await readFile(effortPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/efforts/test.md",
    source.replace(
      /Work binding:\n {2}Provider: matt-skills\/v1\n {2}Native scope: \.scratch\/work\n/u,
      "",
    ),
  );

  const missing = await materialize(root);
  expect(missing.efforts).toMatchObject({
    validity: "available",
    items: [
      {
        id: "effort:test",
        roadmapId: "roadmap:test",
        targetGateId: "gate:test",
        lifecycle: "active",
        workBindingState: { state: "invalid", reason: "missing" },
      },
    ],
  });
  expect(missing.gates).toMatchObject({
    validity: "available",
    items: [{ id: "gate:test", readiness: "unknown" }],
  });
  expect(missing.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "effort-work-binding-missing",
        impact: "blocking",
        target: ".bearing/state/efforts/test.md",
      }),
    ]),
  );
});

test("marks a declared Work Binding unresolved without discovering standalone work", async () => {
  const root = await createValidBearingRepo();
  const sync = await runSync(root);
  const captured = await captureDecodedInputs(root, sync.inputs, sync.fingerprint);
  const planningGraph = await buildPlanningGraph({
    decoded: captured.decoded,
    providerObservations: [],
    diagnostics: sync.diagnostics,
    fingerprint: sync.fingerprint,
    assetContentObservations: captured.assetContentObservations,
  });
  const snapshot = await buildSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
    decoded: captured.decoded,
    providerObservations: [],
    providerObservationSelections: [],
    assetContentObservations: captured.assetContentObservations,
    planningGraph,
  });

  expect(snapshot.efforts).toMatchObject({
    validity: "available",
    items: [
      {
        id: "effort:test",
        workBinding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
        workBindingState: { state: "invalid", reason: "unresolved" },
      },
    ],
  });
  expect(snapshot.providerObservations).toEqual([]);
  expect(snapshot.gates).toMatchObject({
    items: [{ id: "gate:test", readiness: "unknown" }],
  });
});

test("marks every conflicting Work Binding invalid while retaining one read-only provider capture", async () => {
  const root = await createValidBearingRepo();
  const source = await readFile(join(root, ".bearing/state/efforts/test.md"), "utf8");
  await writeFixture(
    root,
    ".bearing/state/efforts/conflict.md",
    source.replace("ID: effort:test", "ID: effort:conflict"),
  );
  const gatePath = join(root, ".bearing/state/milestone-gates/test.md");
  const gate = await readFile(gatePath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    gate.replace("  - effort:test", "  - effort:test\n  - effort:conflict"),
  );

  const snapshot = await materialize(root);
  expect(snapshot.efforts).toMatchObject({
    validity: "available",
    items: [
      {
        id: "effort:conflict",
        workBindingState: { state: "invalid", reason: "conflicting" },
      },
      {
        id: "effort:test",
        workBindingState: { state: "invalid", reason: "conflicting" },
      },
    ],
  });
  expect(
    snapshot.providerObservations.filter(
      (observation) => observation.binding.nativeScope === ".scratch/work",
    ),
  ).toHaveLength(1);
  expect(snapshot.gates).toMatchObject({
    items: [{ id: "gate:test", readiness: "unknown" }],
  });
});

test("derives Gate Horizon from the final trustworthy Roadmap projection", async () => {
  const root = await createValidBearingRepo();
  const path = join(root, ".bearing/state/roadmaps/test.md");
  const source = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    source.replace("Prove the fixture.", "Prove **the fixture**."),
  );

  const snapshot = await materialize(root);

  expect(snapshot.roadmaps.validity).toBe("invalid");
  expect(snapshot.gates).toMatchObject({
    validity: "available",
    items: [{ id: "gate:test", horizonState: "unknown" }],
  });
});

test("derives Roadmap Horizon from the final trustworthy Gate projection", async () => {
  const root = await createValidBearingRepo();
  const roadmapPath = join(root, ".bearing/state/roadmaps/test.md");
  const roadmap = await readFile(roadmapPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    roadmap.replace("Focused gate: gate:test", "Focused gate: null"),
  );
  const gatePath = join(root, ".bearing/state/milestone-gates/test.md");
  const gate = await readFile(gatePath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    gate
      .replace(
        "Status: active",
        "Status: passed\nPassage:\n  Accepted decision: Pass the Gate.\n  Rationale: The fixture is complete.\n  Evidence: []\n  Exceptions: []",
      )
      .replace("- All fixture work resolves.", "- **All fixture work resolves.**"),
  );

  const snapshot = await materialize(root);

  expect(snapshot.gates.validity).toBe("invalid");
  expect(snapshot.roadmaps).toMatchObject({
    validity: "available",
    items: [{ id: "roadmap:test", horizon: "unknown" }],
  });
});

test("isolates duplicate Efforts before rebuilding exact reverse planning relations", async () => {
  const root = await createValidBearingRepo();
  const effort = await readFile(join(root, ".bearing/state/efforts/test.md"), "utf8");
  await writeFixture(root, ".bearing/state/efforts/duplicate.md", effort);

  const snapshot = await materialize(root);

  expect(snapshot.efforts).toMatchObject({
    validity: "invalid",
    issues: [
      { code: "duplicate-stable-id", target: ".bearing/state/efforts/duplicate.md" },
      { code: "duplicate-stable-id", target: ".bearing/state/efforts/test.md" },
    ],
  });
  expect(snapshot.roadmaps).toMatchObject({
    validity: "available",
    items: [{ id: "roadmap:test", effortIds: [] }],
  });
  expect(snapshot.gates).toMatchObject({
    validity: "partial",
    items: [{ id: "gate:test", effortIds: [], readiness: "unknown" }],
    issues: [
      { code: "untrusted-effort-contributor", target: "gate:test" },
      { code: "untrusted-effort-contributor", target: "gate:test" },
    ],
  });
});

test("scopes an invalid canonical Effort contributor to only its declared Gate", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/roadmap-index.md",
    `---\nType: roadmap-index\nRoadmaps:\n  - roadmap:test\n  - roadmap:other\n---\n\n# Roadmap Index\n`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmaps/other.md",
    `---\nType: roadmap\nID: roadmap:other\nTitle: Other Roadmap\nStatus: active\nFocused gate: gate:other\nGate order:\n  - gate:other\n---\n\n# Roadmap: Other\n\n## Intent\n\nPreserve an independent horizon.\n`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/other.md",
    `---\nType: milestone-gate\nID: gate:other\nTitle: Other Gate\nRoadmap: roadmap:other\nStatus: active\nEffort order:\n  - effort:other\n---\n\n# Milestone Gate: Other\n\n## Intent\n\nPreserve exact sibling readiness.\n\n## Exit Criteria\n\n- Resolve the sibling work.\n`,
  );
  await writeFixture(
    root,
    ".bearing/state/efforts/other.md",
    `---\nType: effort\nID: effort:other\nTitle: Other Effort\nRoadmap: roadmap:other\nTarget gate: gate:other\nAuthorities: []\nCitations: []\nLifecycle: concluded\nPlanned at: null\nActivated at: null\nConclusion:\n  Disposition: completed\n  Rationale: The other contribution was explicitly accepted as complete.\n  Concluded at: null\nWork binding:\n  Provider: matt-skills/v1\n  Native scope: .scratch/other\n---\n\n# Effort: Other\n\n## Intent\n\nProve scoped contributor isolation.\n\n## Work\n\n- [Map](map.md)\n`,
  );
  await writeFixture(
    root,
    ".scratch/other/map.md",
    "# Wayfinder Map: Other\n\nStatus: resolved\n\n## Destination\n\nResolve sibling work.\n\n## Decisions so far\n\n- [Finish Other](issues/01-finish.md) — Done.\n\n## Fog\n",
  );
  await writeFixture(
    root,
    ".scratch/other/issues/01-finish.md",
    "# Finish Other\n\nType: task\n\nStatus: resolved\n\n## Question\n\nCan the other effort finish?\n\n## Answer\n\nDone.\n",
  );
  await writeFixture(
    root,
    ".bearing/state/efforts/broken.md",
    `---\nType: effort\nID: effort:broken\nTitle: Broken Contributor\nRoadmap: roadmap:test\nTarget gate: gate:test\nAuthorities: []\nCitations: []\nLifecycle: active\nPlanned at: null\nActivated at: null\nWork binding:\n  Provider: matt-skills/v1\n  Native scope: .scratch/broken\n---\n\n# Effort: Broken\n\n## Intent\n\nThis contributor has no Work section.\n`,
  );

  const snapshot = await materialize(root);

  expect(snapshot.efforts).toMatchObject({
    validity: "partial",
    items: [{ id: "effort:other" }, { id: "effort:test" }],
    issues: [{ target: ".bearing/state/efforts/broken.md" }],
  });
  expect(snapshot.roadmaps).toMatchObject({
    validity: "available",
    items: [
      { id: "roadmap:other", effortIds: ["effort:other"] },
      { id: "roadmap:test", effortIds: ["effort:test"] },
    ],
  });
  expect(snapshot.gates).toMatchObject({
    validity: "partial",
    items: [
      { id: "gate:other", effortIds: ["effort:other"], readiness: "ready-for-review" },
      { id: "gate:test", effortIds: ["effort:test"], readiness: "unknown" },
    ],
    issues: [{ code: "untrusted-effort-contributor", target: "gate:test" }],
  });
});
