import { expect, test } from "bun:test";
import { buildProjectOverviewModel } from "../src/portal-ui/project-overview-model";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const snapshotFixture = createProjectOverviewFixture;

test("projects Overview in accepted semantic order without re-sorting planning truth", () => {
  const model = buildProjectOverviewModel(snapshotFixture());

  expect(model.summary.state).toBe("available");
  expect(model.guidance.state).toBe("available");
  expect(model.guidance.state === "available" && model.guidance.value.semanticFreshness).toBe(
    "stale",
  );
  expect(model.roadmaps.state).toBe("available");
  if (model.roadmaps.state !== "available") throw new Error("Expected Roadmaps.");
  expect(model.roadmaps.activeCount).toBe(2);
  expect(model.roadmaps.items.map((item) => String(item.roadmap.id))).toEqual([
    "roadmap:second",
    "roadmap:portal",
  ]);
  expect(model.roadmaps.items[1]?.gates.map((item) => String(item.gate.id))).toEqual([
    "gate:one",
    "gate:two",
  ]);
  expect(model.roadmaps.items[1]?.gates.map((item) => item.ordinal)).toEqual([1, 2]);
});

test("resolves Attention and provenance only from typed Snapshot references", () => {
  const model = buildProjectOverviewModel(snapshotFixture());

  expect(model.attention.map((item) => item.state)).toEqual([
    "available",
    "available",
    "available",
  ]);
  expect(model.attention.map((item) => item.title)).toEqual([
    "Project Summary has one malformed section.",
    "Confirm the Portal revision",
    "Review the current sequence",
  ]);
  expect(model.summary.source?.displayLocator).toBe(".bearing/state/project-summary.md");
  expect(model.guidance.source?.displayLocator).toBe(".bearing/state/next-work-guidance.md");
  if (model.guidance.state !== "available") throw new Error("Expected Guidance.");
  expect(model.sources.get(model.guidance.value.primary.source)?.fragment).toBe("primary");
});

test("renders retained members from a trustworthy partial Roadmap projection", () => {
  const snapshot = snapshotFixture();
  if (
    snapshot.roadmapIndex.validity !== "available" ||
    snapshot.roadmaps.validity !== "available"
  ) {
    throw new Error("Expected available Roadmap fixtures.");
  }
  const portalRoadmap = snapshot.roadmaps.items.find((roadmap) => roadmap.id === "roadmap:portal");
  if (portalRoadmap === undefined) throw new Error("Expected Portal Roadmap fixture.");
  const issue = {
    code: "invalid-roadmap",
    target: "roadmap:second",
    message: "One Roadmap is unavailable.",
  };
  const partial = projectSnapshotSchema.parse({
    ...snapshot,
    roadmapIndex: {
      validity: "partial",
      value: { ...snapshot.roadmapIndex.value, activeRoadmapIds: ["roadmap:portal"] },
      issues: [issue],
    },
    roadmaps: { validity: "partial", items: [portalRoadmap], issues: [issue] },
  });
  const model = buildProjectOverviewModel(partial);

  expect(model.roadmaps).toMatchObject({ state: "partial", activeCount: 1 });
  expect(model.roadmaps.items.map((item) => String(item.roadmap.id))).toEqual(["roadmap:portal"]);
  expect(model.roadmaps.state === "partial" && model.roadmaps.issues).toContainEqual(issue);
});
