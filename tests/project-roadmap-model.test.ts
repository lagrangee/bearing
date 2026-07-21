import { expect, test } from "bun:test";
import {
  buildRoadmapDetailModel,
  buildRoadmapIndexModel,
} from "../src/portal-ui/project-roadmap-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const fixture = (): ProjectSnapshot => createProjectOverviewFixture();

const independentRoadmapsFixture = (): ProjectSnapshot => {
  const snapshot = fixture();
  if (
    snapshot.roadmaps.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.efforts.validity !== "available"
  ) {
    throw new Error("Expected complete Roadmap fixture projections.");
  }
  return projectSnapshotSchema.parse({
    ...snapshot,
    roadmaps: {
      validity: "available",
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal"
          ? { ...roadmap, gateOrder: ["gate:two"], effortIds: ["effort:portal"] }
          : {
              ...roadmap,
              focusedGateId: null,
              gateOrder: ["gate:one"],
              horizon: "exhausted",
              effortIds: ["effort:model"],
            },
      ),
    },
    gates: {
      validity: "available",
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:one" ? { ...gate, roadmapId: "roadmap:second" } : gate,
      ),
    },
    efforts: {
      validity: "available",
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:model" ? { ...effort, roadmapId: "roadmap:second" } : effort,
      ),
    },
  });
};

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

  if (snapshot.maps.validity === "invalid") throw new Error("Expected Maps fixture.");
  const mapPartial = buildRoadmapDetailModel(
    {
      ...snapshot,
      maps: {
        validity: "partial",
        items: snapshot.maps.items.filter((map) => map.effortId !== "effort:portal"),
        issues: [
          {
            code: "invalid-map-body",
            target: ".scratch/portal/map.md",
            message: "Map source is invalid.",
          },
        ],
      },
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
    snapshot.tickets.validity !== "available"
  ) {
    throw new Error("Expected Efforts, Gates, and Tickets fixture.");
  }
  const parsed = projectSnapshotSchema.safeParse({
    ...snapshot,
    efforts: {
      validity: "available",
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal" ? { ...effort, derivedState: "unknown" } : effort,
      ),
    },
    gates: {
      validity: "available",
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "unknown" } : gate,
      ),
    },
    tickets: {
      validity: "partial",
      items: snapshot.tickets.items,
      issues: [
        {
          code: "invalid-native-ticket",
          target: ".scratch/portal/issues/04-corrupt.md",
          message: "One native Ticket is structurally uncertain.",
        },
      ],
    },
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

test("scopes partial and invalid Map issues by target or source to one Roadmap", () => {
  const snapshot = independentRoadmapsFixture();
  if (snapshot.maps.validity !== "available") throw new Error("Expected complete Maps fixture.");
  const portalMap = snapshot.maps.items.find((map) => map.effortId === "effort:portal");
  if (portalMap === undefined) throw new Error("Expected the Portal Map fixture.");
  const issues = [
    {
      code: "invalid-native-map",
      target: ".scratch/portal/broken-map.md",
      message: "One Portal Map is invalid.",
    },
    {
      code: "invalid-native-map",
      target: "maps",
      message: "One Portal Map source is invalid.",
      source: portalMap.source,
    },
  ] as const;

  for (const issue of issues) {
    for (const validity of ["partial", "invalid"] as const) {
      const maps =
        validity === "partial"
          ? { validity, items: snapshot.maps.items, issues: [issue] }
          : { validity, issues: [issue] };
      const scoped = { ...snapshot, maps } as ProjectSnapshot;
      const portal = buildRoadmapDetailModel(scoped, "roadmap:portal");
      const second = buildRoadmapDetailModel(scoped, "roadmap:second");

      expect(portal.state).toBe("partial");
      expect(second.state).toBe("available");
      if (portal.state !== "partial" || second.state !== "available") {
        throw new Error("Expected only the issue-owning Roadmap to become partial.");
      }
      expect(portal.missingMapRelationCount).toBe(1);
      expect(second.missingMapRelationCount).toBe(0);
      expect(
        portal.efforts.flatMap((effort) => effort.maps).map((map) => String(map.reference)),
      ).toEqual(validity === "partial" ? [".scratch/portal/map.md"] : []);
      expect(
        second.efforts.flatMap((effort) => effort.maps).map((map) => String(map.reference)),
      ).toEqual(validity === "partial" ? [".scratch/model/map.md"] : []);
    }
  }
});

test("fails closed on an unscopable Map issue without inventing a missing relation count", () => {
  const snapshot = independentRoadmapsFixture();
  if (snapshot.maps.validity !== "available") throw new Error("Expected complete Maps fixture.");
  const issue = {
    code: "invalid-native-map",
    target: "maps",
    message: "Map scope cannot be recovered.",
  };

  for (const validity of ["partial", "invalid"] as const) {
    const maps =
      validity === "partial"
        ? { validity, items: snapshot.maps.items, issues: [issue] }
        : { validity, issues: [issue] };
    const scoped = { ...snapshot, maps } as ProjectSnapshot;
    const portal = buildRoadmapDetailModel(scoped, "roadmap:portal");
    const second = buildRoadmapDetailModel(scoped, "roadmap:second");

    expect(portal.state).toBe("partial");
    expect(second.state).toBe("partial");
    if (portal.state !== "partial" || second.state !== "partial") {
      throw new Error("Expected every Map-bearing Roadmap to fail closed.");
    }
    expect(portal.missingMapRelationCount).toBe(0);
    expect(second.missingMapRelationCount).toBe(0);
    expect(
      portal.efforts.flatMap((effort) => effort.maps).map((map) => String(map.reference)),
    ).toEqual(validity === "partial" ? [".scratch/portal/map.md"] : []);
    expect(
      second.efforts.flatMap((effort) => effort.maps).map((map) => String(map.reference)),
    ).toEqual(validity === "partial" ? [".scratch/model/map.md"] : []);
  }
});
