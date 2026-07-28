import { expect, test } from "bun:test";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const rejects = (snapshot: unknown): void => {
  expect(projectSnapshotSchema.safeParse(snapshot).success).toBe(false);
};

const mapPlanning = (
  snapshot: ReturnType<typeof createProjectOverviewFixture>,
  portalState: "active" | "resolved" | "unknown",
  gateReadiness: "not-ready" | "ready-for-review" | "unknown",
) => ({
  efforts:
    snapshot.efforts.validity === "invalid"
      ? snapshot.efforts
      : {
          ...snapshot.efforts,
          items: snapshot.efforts.items.map((effort) =>
            effort.id === "effort:portal" ? { ...effort, derivedState: portalState } : effort,
          ),
        },
  gates:
    snapshot.gates.validity === "invalid"
      ? snapshot.gates
      : {
          ...snapshot.gates,
          items: snapshot.gates.items.map((gate) =>
            gate.id === "gate:two" ? { ...gate, readiness: gateReadiness } : gate,
          ),
        },
});

test("rejects tampered Roadmap and Gate horizon caches", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.roadmaps.validity !== "available" || snapshot.gates.validity !== "available") {
    throw new Error("Expected complete planning fixture.");
  }

  rejects({
    ...snapshot,
    roadmaps: {
      validity: "available",
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal" ? { ...roadmap, horizon: "exhausted" } : roadmap,
      ),
    },
  });
  rejects({
    ...snapshot,
    gates: {
      validity: "available",
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, horizonState: "planned" } : gate,
      ),
    },
  });
});

test("uses provider completion as the sole Effort and Gate completion authority", () => {
  const snapshot = createProjectOverviewFixture();
  const completedCaptures = snapshot.providerCaptures.map((capture) =>
    capture.binding.nativeScope === ".scratch/portal"
      ? { ...capture, completion: "complete" as const }
      : capture,
  );
  const completedPlanning = mapPlanning(snapshot, "resolved", "ready-for-review");

  expect(
    projectSnapshotSchema.safeParse({
      ...snapshot,
      ...completedPlanning,
      providerCaptures: completedCaptures,
    }).success,
  ).toBe(true);
  rejects({ ...snapshot, providerCaptures: completedCaptures });
  rejects({ ...snapshot, ...completedPlanning });
});

test("derives unknown completion only from a missing or unusable provider capture", () => {
  const snapshot = createProjectOverviewFixture();
  const unknownPlanning = mapPlanning(snapshot, "unknown", "unknown");
  const capturesWithoutPortal = snapshot.providerCaptures.filter(
    (capture) => capture.binding.nativeScope !== ".scratch/portal",
  );

  expect(
    projectSnapshotSchema.safeParse({
      ...snapshot,
      ...unknownPlanning,
      providerCaptures: capturesWithoutPortal,
    }).success,
  ).toBe(true);
  rejects({ ...snapshot, providerCaptures: capturesWithoutPortal });

  const invalidCaptures = snapshot.providerCaptures.map((capture) => {
    if (
      capture.binding.nativeScope !== ".scratch/portal" ||
      (capture.state !== "available" && capture.state !== "partial")
    ) {
      return capture;
    }
    const { projection: _projection, ...base } = capture;
    return {
      ...base,
      state: "invalid" as const,
      completion: "undetermined" as const,
      freshness: { ...base.freshness, assessment: "undetermined" as const },
      coverage: {
        assessment: "incomplete" as const,
        dimensions: [{ key: "scope", state: "gap" as const, detail: "Capture failed." }],
      },
      diagnostics: [
        {
          code: "capture-failed",
          class: "acquisition" as const,
          impact: "blocking" as const,
          target: ".scratch/portal",
          message: "Provider capture failed.",
        },
      ],
    };
  });
  expect(
    projectSnapshotSchema.safeParse({
      ...snapshot,
      ...unknownPlanning,
      providerCaptures: invalidCaptures,
    }).success,
  ).toBe(true);
});

test("classifies Gate readiness per contributor when the Effort projection is partial", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity !== "available" || snapshot.gates.validity !== "available") {
    throw new Error("Expected complete Effort and Gate projections.");
  }
  const partialEfforts = {
    validity: "partial" as const,
    items: snapshot.efforts.items.filter((effort) => effort.id !== "effort:portal"),
    issues: [
      {
        code: "invalid-effort-body",
        target: ".bearing/state/efforts/portal.md",
        message: "One contributing Effort cannot enter the normalized read model.",
      },
    ],
  };
  const scoped = {
    ...snapshot,
    efforts: partialEfforts,
    gates: {
      validity: "available" as const,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
      ),
    },
  };

  expect(projectSnapshotSchema.safeParse(scoped).success).toBe(true);
  rejects({
    ...scoped,
    gates: {
      validity: "available",
      items: scoped.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "not-ready" } : gate,
      ),
    },
  });
});

test("rejects duplicate provider captures for the same bound scope", () => {
  const snapshot = createProjectOverviewFixture();
  rejects({
    ...snapshot,
    providerCaptures: [...snapshot.providerCaptures, snapshot.providerCaptures[0]],
  });
});
