import { expect, test } from "bun:test";
import { buildRoadmapIndexModel } from "../src/portal-ui/project-roadmap-model";
import type { ProjectGeneration } from "../src/project-generation/contract";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const fixture = (): ProjectGeneration => createProjectOverviewFixture();

test("builds lifecycle Index rows in canonical order with complete Gate horizons", () => {
  const model = buildRoadmapIndexModel(fixture());
  expect(model.state).toBe("available");
  if (model.state !== "available") throw new Error("Expected available Roadmap Index.");
  expect(model.groups.map((group) => group.lifecycle)).toEqual([
    "active",
    "completed",
    "superseded",
  ]);
  expect(model.groups[0]?.items.map((item) => item.roadmap.title)).toEqual([
    "Second Horizon",
    "Portal Evolution",
  ]);
  expect(model.groups[0]?.items[1]?.gates.map((entry) => entry.gate.title)).toEqual([
    "Model ready",
    "Overview proven",
  ]);
});

test("keeps absent, invalid, and partial Index states scoped without a legacy detail model", () => {
  const snapshot = fixture();
  expect(
    buildRoadmapIndexModel({
      ...snapshot,
      roadmapIndex: { validity: "absent" },
    } as ProjectGeneration),
  ).toEqual({ state: "absent", groups: [] });

  const invalid = buildRoadmapIndexModel({
    ...snapshot,
    roadmapIndex: {
      validity: "invalid",
      issues: [{ code: "invalid-roadmap-index", target: "roadmap-index", message: "Invalid." }],
    },
  } as ProjectGeneration);
  expect(invalid).toEqual({ state: "invalid", groups: [], issueCount: 1 });

  if (snapshot.gates.validity === "invalid") throw new Error("Expected readable Gates.");
  const partial = buildRoadmapIndexModel({
    ...snapshot,
    gates: {
      validity: "partial",
      items: snapshot.gates.items.filter((gate) => gate.id !== "gate:one"),
      issues: [{ code: "invalid-gate", target: "gate:one", message: "Gate unavailable." }],
    },
  } as ProjectGeneration);
  expect(partial.state).toBe("partial");
  if (partial.state !== "partial") throw new Error("Expected partial Roadmap Index.");
  expect(partial.groups[0]?.items[1]?.missingGateIds.map(String)).toEqual(["gate:one"]);
  expect(partial.groups[0]?.items[1]?.gates.map((entry) => String(entry.gate.id))).toEqual([
    "gate:two",
  ]);
});
