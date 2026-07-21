import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readProjectSnapshotCache } from "../src/project-snapshot/cache";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { makeTemporaryDirectory } from "./helpers";

const issue = {
  code: "invalid-roadmap",
  target: ".bearing/state/roadmaps/invalid.md",
  message: "Roadmap cannot be normalized.",
};

test("requires a partial collection to retain at least one trustworthy member", () => {
  // Given: one valid Snapshot collection and one scoped issue.
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.roadmaps.validity !== "available" ||
    snapshot.roadmapIndex.validity !== "available"
  ) {
    throw new Error("Expected available Roadmaps and Index in the validity fixture.");
  }
  const roadmap = snapshot.roadmaps.items[0];
  if (roadmap === undefined) throw new Error("Expected one Roadmap in the validity fixture.");

  // When: partial collections with and without a trustworthy member cross the schema boundary.
  const retained = projectSnapshotSchema.safeParse({
    ...snapshot,
    roadmapIndex: {
      ...snapshot.roadmapIndex,
      value: { ...snapshot.roadmapIndex.value, activeRoadmapIds: [roadmap.id] },
    },
    roadmaps: { validity: "partial", items: [roadmap], issues: [issue] },
  });
  const empty = projectSnapshotSchema.safeParse({
    ...snapshot,
    roadmaps: { validity: "partial", items: [], issues: [issue] },
  });

  // Then: only the collection that actually retains trustworthy content is partial.
  expect(retained.success).toBe(true);
  expect(empty.success).toBe(false);
});

test("treats a cached partial collection without trustworthy members as malformed", async () => {
  // Given: cache bytes claim partial validity while retaining no Roadmap member.
  const root = await makeTemporaryDirectory("bearing-partial-cache-");
  const target = join(root, ".bearing/cache/project-snapshot.json");
  await mkdir(join(root, ".bearing/cache"), { recursive: true });
  await writeFile(
    target,
    `${JSON.stringify({
      ...createProjectOverviewFixture(),
      roadmaps: { validity: "partial", items: [], issues: [issue] },
    })}\n`,
    "utf8",
  );

  // When: Portal reads the untrusted cache boundary.
  const cached = await readProjectSnapshotCache(root);

  // Then: the impossible projection state never escapes as a usable Snapshot.
  expect(cached).toEqual({ kind: "malformed", reason: "invalid-snapshot" });
});
