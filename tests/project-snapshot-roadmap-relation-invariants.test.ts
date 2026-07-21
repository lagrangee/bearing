import { expect, test } from "bun:test";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const relationIssue = {
  code: "isolated-relation-source",
  target: ".bearing/state/roadmaps/portal.md",
  message: "One relation source is isolated.",
} as const;

const terminalRoadmapSnapshot = () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.roadmapIndex.validity !== "available" ||
    snapshot.roadmaps.validity !== "available" ||
    snapshot.gates.validity !== "available"
  ) {
    throw new Error("Expected complete planning fixture.");
  }
  return {
    ...snapshot,
    roadmapIndex: {
      validity: "available" as const,
      value: {
        ...snapshot.roadmapIndex.value,
        activeRoadmapIds: ["roadmap:second"],
        completedRoadmapIds: ["roadmap:portal"],
      },
    },
    roadmaps: {
      validity: "available" as const,
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal"
          ? {
              ...roadmap,
              lifecycle: "completed" as const,
              focusedGateId: null,
              horizon: "exhausted" as const,
            }
          : roadmap,
      ),
    },
    gates: {
      validity: "available" as const,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, horizonState: "unknown" as const } : gate,
      ),
    },
  };
};

test("requires terminal cached Roadmaps to clear their focused Gate", () => {
  const terminal = terminalRoadmapSnapshot();
  expect(projectSnapshotSchema.safeParse(terminal).success).toBe(true);

  const focused = {
    ...terminal,
    roadmaps: {
      ...terminal.roadmaps,
      items: terminal.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal" ? { ...roadmap, focusedGateId: "gate:two" } : roadmap,
      ),
    },
    gates: {
      ...terminal.gates,
      items: terminal.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, horizonState: "focused" } : gate,
      ),
    },
  };

  expect(projectSnapshotSchema.safeParse(focused).success).toBe(false);
});

test("requires a trustworthy cached focused Gate to be active", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.gates.validity !== "available") throw new Error("Expected complete Gates.");
  const focusedPlannedGate = {
    ...snapshot,
    gates: {
      validity: "available" as const,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two"
          ? { ...gate, lifecycle: "planned" as const, horizonState: "planned" as const }
          : gate,
      ),
    },
  };

  expect(projectSnapshotSchema.safeParse(focusedPlannedGate).success).toBe(false);
});

test("partial relation collections retain every trustworthy forward member", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.roadmaps.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.efforts.validity !== "available"
  ) {
    throw new Error("Expected complete Roadmap relation fixture.");
  }
  const partialGates = {
    ...snapshot,
    gates: { validity: "partial" as const, items: snapshot.gates.items, issues: [relationIssue] },
    roadmaps: {
      ...snapshot.roadmaps,
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal"
          ? { ...roadmap, gateOrder: roadmap.gateOrder.filter((id) => id !== "gate:one") }
          : roadmap,
      ),
    },
  };
  const partialRoadmapEfforts = {
    ...snapshot,
    efforts: {
      validity: "partial" as const,
      items: snapshot.efforts.items,
      issues: [relationIssue],
    },
    roadmaps: {
      ...snapshot.roadmaps,
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal"
          ? { ...roadmap, effortIds: roadmap.effortIds.filter((id) => id !== "effort:model") }
          : roadmap,
      ),
    },
  };
  const partialGateEfforts = {
    ...snapshot,
    efforts: {
      validity: "partial" as const,
      items: snapshot.efforts.items,
      issues: [relationIssue],
    },
    gates: {
      ...snapshot.gates,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, effortIds: [] } : gate,
      ),
    },
  };

  expect(projectSnapshotSchema.safeParse(partialGates).success).toBe(false);
  expect(projectSnapshotSchema.safeParse(partialRoadmapEfforts).success).toBe(false);
  expect(projectSnapshotSchema.safeParse(partialGateEfforts).success).toBe(false);
});

test("partial relation collections allow unresolved extras while remaining exact when available", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.roadmaps.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.efforts.validity !== "available"
  ) {
    throw new Error("Expected complete Roadmaps, Gates, and Efforts.");
  }
  const partialGates = {
    ...snapshot,
    gates: {
      validity: "partial" as const,
      items: snapshot.gates.items.filter((gate) => gate.id !== "gate:one"),
      issues: [relationIssue],
    },
    assets:
      snapshot.assets.validity === "available"
        ? {
            ...snapshot.assets,
            items: snapshot.assets.items.map((asset) => ({
              ...asset,
              gatePassageEvidenceFor: [],
            })),
          }
        : snapshot.assets,
  };
  const partial = {
    ...snapshot,
    gates: {
      ...snapshot.gates,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
      ),
    },
    efforts: {
      validity: "partial" as const,
      items: snapshot.efforts.items.filter((effort) => effort.id !== "effort:portal"),
      issues: [relationIssue],
    },
  };
  expect(projectSnapshotSchema.safeParse(partialGates).success).toBe(true);
  expect(projectSnapshotSchema.safeParse(partial).success).toBe(true);

  expect(
    projectSnapshotSchema.safeParse({
      ...snapshot,
      roadmaps: {
        ...snapshot.roadmaps,
        items: snapshot.roadmaps.items.map((roadmap) =>
          roadmap.id === "roadmap:portal"
            ? { ...roadmap, effortIds: [...roadmap.effortIds, "effort:missing"] }
            : roadmap,
        ),
      },
    }).success,
  ).toBe(false);
});
