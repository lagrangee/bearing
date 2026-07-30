import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRoadmapDetailModel } from "../src/portal-ui/project-roadmap-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

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

  const capture = snapshot.providerCaptures.find(
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
  expect(buildRoadmapDetailModel(snapshot, "roadmap:test").state).toBe("partial");
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
    `---\nType: milestone-gate\nID: gate:other\nTitle: Other Gate\nRoadmap: roadmap:other\nStatus: active\n---\n\n# Milestone Gate: Other\n\n## Intent\n\nPreserve exact sibling readiness.\n\n## Exit Criteria\n\n- Resolve the sibling work.\n`,
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
  expect(buildRoadmapDetailModel(snapshot, "roadmap:test").state).toBe("partial");
  expect(buildRoadmapDetailModel(snapshot, "roadmap:other").state).toBe("available");
});
