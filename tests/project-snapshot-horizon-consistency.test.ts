import { expect, test } from "bun:test";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { withRebuiltPlanningLineage } from "./planning-lineage-fixture";

const relationIssue = {
  code: "isolated-roadmap-source",
  target: ".bearing/state/roadmaps/portal.md",
  message: "One Roadmap source is isolated.",
} as const;

test("derives an exhausted active Roadmap from a terminal ordered Gate horizon", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.roadmaps.validity === "invalid" || snapshot.gates.validity === "invalid") {
    throw new Error("Expected complete planning fixture.");
  }
  const exhausted = {
    ...snapshot,
    roadmaps: {
      validity: "available" as const,
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal"
          ? { ...roadmap, focusedGateId: null, horizon: "exhausted" as const }
          : roadmap,
      ),
    },
    gates: {
      validity: "available" as const,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two"
          ? {
              ...gate,
              lifecycle: "passed" as const,
              horizonState: "passed" as const,
              passage: {
                acceptedDecision: "Pass the final declared Gate.",
                acceptedAt: { availability: "unavailable" as const },
                rationale: "The declared outcome horizon is exhausted.",
                evidence: [],
                exceptions: [],
              },
            }
          : gate,
      ),
    },
  };

  expect(projectSnapshotSchema.safeParse(withRebuiltPlanningLineage(exhausted)).success).toBe(true);
  expect(
    projectSnapshotSchema.safeParse({
      ...exhausted,
      roadmaps: {
        ...exhausted.roadmaps,
        items: exhausted.roadmaps.items.map((roadmap) =>
          roadmap.id === "roadmap:portal" ? { ...roadmap, horizon: "unknown" } : roadmap,
        ),
      },
    }).success,
  ).toBe(false);
});

test("keeps terminal Gate Horizon truth exact when its Roadmap is isolated", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.roadmaps.validity === "invalid" || snapshot.gates.validity === "invalid") {
    throw new Error("Expected complete planning fixture.");
  }
  const isolated = {
    ...snapshot,
    roadmapIndex: { validity: "invalid" as const, issues: [relationIssue] },
    roadmaps: {
      validity: "partial" as const,
      items: snapshot.roadmaps.items.filter((roadmap) => roadmap.id !== "roadmap:portal"),
      issues: [relationIssue],
    },
    gates: {
      validity: "available" as const,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, horizonState: "unknown" as const } : gate,
      ),
    },
  };

  expect(projectSnapshotSchema.safeParse(withRebuiltPlanningLineage(isolated)).success).toBe(true);
  expect(
    projectSnapshotSchema.safeParse({
      ...isolated,
      gates: {
        ...isolated.gates,
        items: isolated.gates.items.map((gate) =>
          gate.id === "gate:one" ? { ...gate, horizonState: "unknown" } : gate,
        ),
      },
    }).success,
  ).toBe(false);
});
