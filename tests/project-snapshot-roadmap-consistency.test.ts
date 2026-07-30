import { expect, test } from "bun:test";
import type { RefinementCtx } from "zod";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { validateRoadmapConsistency } from "../src/project-snapshot/schema-roadmap-consistency";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const rejects = (snapshot: unknown): void => {
  expect(projectSnapshotSchema.safeParse(snapshot).success).toBe(false);
};

test("rejects cached Roadmap, Gate, and Effort ownership drift", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.roadmaps.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.efforts.validity !== "available"
  ) {
    throw new Error("Expected complete Roadmap fixture.");
  }
  rejects({
    ...snapshot,
    roadmaps: {
      validity: "available",
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal" ? { ...roadmap, effortIds: ["effort:model"] } : roadmap,
      ),
    },
  });
  rejects({
    ...snapshot,
    gates: {
      validity: "available",
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, effortIds: [] } : gate,
      ),
    },
  });
  rejects({
    ...snapshot,
    efforts: {
      validity: "available",
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal" ? { ...effort, targetGateId: "gate:one" } : effort,
      ),
    },
  });
});

test("rejects provider capture identity drift and unknown bound-provider fields", () => {
  const snapshot = createProjectOverviewFixture();
  const portalCapture = snapshot.providerObservations.find(
    (capture) => capture.binding.nativeScope === ".scratch/portal",
  );
  if (portalCapture === undefined) throw new Error("Expected Portal provider capture.");

  rejects({
    ...snapshot,
    providerObservations: [
      ...snapshot.providerObservations,
      { ...portalCapture, binding: { ...portalCapture.binding, nativeScope: ".scratch/model" } },
    ],
  });
  if (snapshot.efforts.validity !== "available") throw new Error("Expected Effort fixture.");
  rejects({
    ...snapshot,
    efforts: {
      validity: "available",
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal"
          ? { ...effort, workBinding: { ...effort.workBinding, Driver: "local-markdown" } }
          : effort,
      ),
    },
  });
});

test("allows unresolved relation IDs only when their owning collection is partial", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity !== "available") throw new Error("Expected Efforts fixture.");
  const partial = {
    ...snapshot,
    gates:
      snapshot.gates.validity === "invalid"
        ? snapshot.gates
        : {
            ...snapshot.gates,
            items: snapshot.gates.items.map((gate) =>
              gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
            ),
          },
    efforts: {
      validity: "partial" as const,
      items: snapshot.efforts.items.filter((effort) => effort.id !== "effort:portal"),
      issues: [
        {
          code: "invalid-effort-body",
          target: ".bearing/state/efforts/portal.md",
          message: "Effort source is invalid.",
        },
      ],
    },
  };
  expect(projectSnapshotSchema.safeParse(partial).success).toBe(true);
});

const replacementCycleIssues = (size: number): string[] => {
  const effortIds = Array.from({ length: size }, (_, index) => `effort:${index + 1}`);
  const issues: { message: string }[] = [];
  const context = {
    addIssue: (issue) => {
      issues.push({ message: typeof issue === "string" ? issue : String(issue.message) });
    },
  } as RefinementCtx;
  validateRoadmapConsistency(
    {
      roadmaps: {
        validity: "available",
        items: [
          {
            id: "roadmap:test",
            lifecycle: "active",
            focusedGateId: "gate:test",
            gateOrder: ["gate:test"],
            effortIds,
          },
        ],
      },
      gates: {
        validity: "available",
        items: [
          {
            id: "gate:test",
            roadmapId: "roadmap:test",
            lifecycle: "active",
            effortIds,
          },
        ],
      },
      efforts: {
        validity: "available",
        items: effortIds.map((id, index) => ({
          id,
          roadmapId: "roadmap:test",
          targetGateId: "gate:test",
          lifecycle: "concluded" as const,
          conclusion: {
            disposition: "superseded" as const,
            replacementEffortId: effortIds[(index + 1) % effortIds.length],
          },
        })),
      },
    },
    context,
  );

  return issues.map((issue) => issue.message);
};

test("rejects two-node and longer superseded Effort replacement cycles", () => {
  for (const size of [2, 3, 5]) {
    expect(replacementCycleIssues(size)).toContain(
      "An Effort supersession chain cannot form a cycle.",
    );
  }
});
