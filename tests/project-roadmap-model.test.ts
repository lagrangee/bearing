import { expect, test } from "bun:test";
import {
  buildRoadmapDetailModel,
  buildRoadmapIndexModel,
} from "../src/portal-ui/project-roadmap-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const fixture = (): ProjectSnapshot => createProjectOverviewFixture();

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

test("resolves one Roadmap Detail through Gates, Efforts, native frontiers, and evidence", () => {
  const model = buildRoadmapDetailModel(fixture(), "roadmap:portal");
  expect(model.state).toBe("available");
  if (model.state !== "available") throw new Error("Expected available Roadmap Detail.");
  expect(model.gates.map((entry) => [entry.ordinal, String(entry.gate.id)])).toEqual([
    [1, "gate:one"],
    [2, "gate:two"],
  ]);
  expect(String(model.focusedGate?.gate.id)).toBe("gate:two");
  expect(model.efforts.map((entry) => entry.effort.title)).toEqual([
    "Planning Model",
    "Web Portal Validation",
  ]);
  expect(model.efforts[1]?.frontier).toMatchObject({
    claimed: [{ title: "Build the Roadmap journey" }],
    ready: [{ title: "Review the Roadmap journey" }],
    blocked: [{ title: "Pass the integration gate" }],
    resolved: [],
  });
  expect(model.efforts[1]?.maps).toMatchObject([{ title: "Portal Validation", fogCount: 2 }]);
  expect(model.evidence.map((entry) => entry.asset.title)).toEqual(["Planning Model Evidence"]);
  expect(model.missingMapRelationCount).toBe(0);
});

test("keeps scoped Index and Detail failures readable without inventing relations", () => {
  const snapshot = fixture();
  const issue = { code: "invalid-gate", target: "gate:one", message: "Gate unavailable." };
  const partial = {
    ...snapshot,
    gates: {
      validity: "partial" as const,
      items:
        snapshot.gates.validity === "invalid"
          ? []
          : snapshot.gates.items.filter((gate) => gate.id !== "gate:one"),
      issues: [issue],
    },
  } as ProjectSnapshot;
  const detail = buildRoadmapDetailModel(partial, "roadmap:portal");
  expect(detail.state).toBe("partial");
  if (detail.state !== "partial") throw new Error("Expected partial Roadmap Detail.");
  expect(detail.missingGateIds.map(String)).toEqual(["gate:one"]);
  expect(detail.gates.map((entry) => String(entry.gate.id))).toEqual(["gate:two"]);

  const mapPartial = buildRoadmapDetailModel(
    {
      ...snapshot,
      providerCaptures: snapshot.providerCaptures.filter(
        (capture) => capture.binding.nativeScope !== ".scratch/portal",
      ),
    } as ProjectSnapshot,
    "roadmap:portal",
  );
  expect(mapPartial.state).toBe("partial");
  if (mapPartial.state !== "partial") throw new Error("Expected partial Map relation.");
  expect(mapPartial.missingMapRelationCount).toBe(1);

  expect(
    buildRoadmapIndexModel({
      ...snapshot,
      roadmapIndex: { validity: "absent" },
    } as ProjectSnapshot),
  ).toEqual({ state: "absent", groups: [] });
  expect(buildRoadmapDetailModel(snapshot, "roadmap:missing")).toEqual({ state: "missing" });
});

test("propagates scoped partial Ticket issues without hiding trustworthy frontier work", () => {
  const snapshot = fixture();
  if (
    snapshot.efforts.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.providerCaptures.length !== 2
  ) {
    throw new Error("Expected Efforts, Gates, and Tickets fixture.");
  }
  const parsed = projectSnapshotSchema.safeParse({
    ...snapshot,
    providerCaptures: snapshot.providerCaptures.map((capture) =>
      capture.binding.nativeScope === ".scratch/portal"
        ? {
            ...capture,
            state: "partial",
            coverage: { ...capture.coverage, assessment: "incomplete" },
            diagnostics: [
              {
                code: "matt.local.ticket.invalid",
                class: "format",
                impact: "blocking",
                target: ".scratch/portal/issues/04-corrupt.md",
                message: "One native Ticket is structurally uncertain.",
              },
            ],
          }
        : capture,
    ),
  });
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Expected a trustworthy partial Ticket Snapshot.");

  const detail = buildRoadmapDetailModel(parsed.data, "roadmap:portal");
  expect(detail.state).toBe("partial");
  if (detail.state !== "partial") throw new Error("Expected a partial Roadmap Detail.");
  expect(detail.efforts[1]?.frontier).toMatchObject({
    claimed: [{ title: "Build the Roadmap journey" }],
    ready: [{ title: "Review the Roadmap journey" }],
    blocked: [{ title: "Pass the integration gate" }],
  });
  expect(buildRoadmapDetailModel(parsed.data, "roadmap:second").state).toBe("available");
});
