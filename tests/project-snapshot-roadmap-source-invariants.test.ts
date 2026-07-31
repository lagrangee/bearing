import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

const addIndependentHorizon = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/state/roadmap-index.md",
    `---
Type: roadmap-index
Roadmaps:
  - roadmap:test
  - roadmap:other
---

# Roadmap Index
`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmaps/other.md",
    `---
Type: roadmap
ID: roadmap:other
Title: Other Roadmap
Status: active
Focused gate: gate:other
Gate order:
  - gate:other
---

# Roadmap: Other

## Intent

Preserve an independent horizon.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/other.md",
    `---
Type: milestone-gate
ID: gate:other
Title: Other Gate
Roadmap: roadmap:other
Status: active
Effort order: []
---

# Milestone Gate: Other

## Intent

Keep the sibling readable.

## Exit Criteria

- Preserve the sibling.
`,
  );
};

test("isolates an active Roadmap that focuses a trustworthy non-active Gate", async () => {
  const root = await createValidBearingRepo();
  await addIndependentHorizon(root);
  const gatePath = join(root, ".bearing/state/milestone-gates/test.md");
  const gate = await readFile(gatePath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    gate.replace("Status: active", "Status: planned"),
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

  expect(sync.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "roadmap-focuses-non-active-gate",
      impact: "blocking",
      target: ".bearing/state/roadmaps/test.md",
    }),
  );
  expect(snapshot.roadmaps).toMatchObject({
    validity: "partial",
    items: [{ id: "roadmap:other" }],
    issues: [{ code: "roadmap-focuses-non-active-gate" }],
  });
  expect(snapshot.gates).toMatchObject({
    validity: "available",
    items: expect.arrayContaining([
      expect.objectContaining({ id: "gate:other", lifecycle: "active" }),
      expect.objectContaining({ id: "gate:test", lifecycle: "planned" }),
    ]),
  });
  expect(snapshot.roadmapIndex).toMatchObject({
    validity: "partial",
    value: { activeRoadmapIds: ["roadmap:other"] },
  });
});

test("keeps the existing closed-Roadmap focus diagnostic singular", async () => {
  const root = await createValidBearingRepo();
  const roadmapPath = join(root, ".bearing/state/roadmaps/test.md");
  const roadmap = await readFile(roadmapPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    roadmap.replace("Status: active", "Status: completed"),
  );

  const sync = await runSync(root);
  const roadmapCodes = sync.diagnostics
    .filter((diagnostic) => diagnostic.target === ".bearing/state/roadmaps/test.md")
    .map((diagnostic) => diagnostic.code);

  expect(roadmapCodes.filter((code) => code === "closed-roadmap-has-focus")).toHaveLength(1);
  expect(roadmapCodes).not.toContain("roadmap-focuses-non-active-gate");
});
