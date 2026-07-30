import { expect, test } from "bun:test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import { normalizedGateReadiness } from "../src/project-snapshot/normalized-planning-derivation";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { withRebuiltPlanningLineage } from "./planning-lineage-fixture";

const rejects = (snapshot: unknown): void => {
  expect(projectSnapshotSchema.safeParse(snapshot).success).toBe(false);
};

const mapPlanning = (
  snapshot: ReturnType<typeof createProjectOverviewFixture>,
  gateReadiness: "not-ready" | "ready-for-review" | "unknown",
) => ({
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

test("keeps explicit Effort lifecycle and Gate readiness independent from provider completion", () => {
  const snapshot = createProjectOverviewFixture();
  const completedCaptures = snapshot.providerObservations.map((capture) =>
    capture.binding.nativeScope === ".scratch/portal"
      ? (createProviderScopeObservation({
          ...capture,
          completion: "complete" as const,
        } as never) as typeof capture)
      : capture,
  );
  const completedPortal = completedCaptures.find(
    (capture) => capture.binding.nativeScope === ".scratch/portal",
  );
  if (completedPortal === undefined) throw new Error("Expected the completed Portal observation.");

  expect(
    projectSnapshotSchema.safeParse(
      withRebuiltPlanningLineage({
        ...snapshot,
        providerObservations: completedCaptures,
        providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
          selection.nativeScope === ".scratch/portal"
            ? { ...selection, observationId: completedPortal.id }
            : selection,
        ),
      }),
    ).success,
  ).toBe(true);
  expect(snapshot.efforts).toMatchObject({
    validity: "available",
    items: [
      { id: "effort:model", lifecycle: "concluded" },
      { id: "effort:portal", lifecycle: "active" },
    ],
  });
  expect(snapshot.gates).toMatchObject({
    validity: "available",
    items: [
      { id: "gate:two", readiness: "not-ready" },
      { id: "gate:one", readiness: "ready-for-review" },
    ],
  });
  rejects({
    ...snapshot,
    efforts:
      snapshot.efforts.validity === "invalid"
        ? snapshot.efforts
        : {
            ...snapshot.efforts,
            items: snapshot.efforts.items.map((effort) => ({
              ...effort,
              derivedState: effort.id === "effort:portal" ? "resolved" : "active",
            })),
          },
  });
});

test("withholds Gate readiness when contributor binding evidence is missing or unusable", () => {
  const snapshot = createProjectOverviewFixture();
  const unknownPlanning = mapPlanning(snapshot, "unknown");
  const capturesWithoutPortal = snapshot.providerObservations.filter(
    (capture) => capture.binding.nativeScope !== ".scratch/portal",
  );
  const selectionsWithoutPortal = snapshot.providerObservationSelections.map((selection) =>
    selection.nativeScope === ".scratch/portal"
      ? {
          ...selection,
          observationId: null,
          effectiveFreshness: "undetermined" as const,
        }
      : selection,
  );

  expect(
    projectSnapshotSchema.safeParse(
      withRebuiltPlanningLineage({
        ...snapshot,
        ...unknownPlanning,
        providerObservations: capturesWithoutPortal,
        providerObservationSelections: selectionsWithoutPortal,
      }),
    ).success,
  ).toBe(true);
  rejects({ ...snapshot, providerObservations: capturesWithoutPortal });

  const invalidCaptures = snapshot.providerObservations.map((capture) => {
    if (
      capture.binding.nativeScope !== ".scratch/portal" ||
      (capture.state !== "available" && capture.state !== "partial")
    ) {
      return capture;
    }
    const { projection: _projection, ...base } = capture;
    return createProviderScopeObservation({
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
    } as never) as typeof capture;
  });
  const invalidPortal = invalidCaptures.find(
    (capture) => capture.binding.nativeScope === ".scratch/portal",
  );
  if (invalidPortal === undefined) throw new Error("Expected the invalid Portal observation.");
  expect(
    projectSnapshotSchema.safeParse(
      withRebuiltPlanningLineage({
        ...snapshot,
        ...unknownPlanning,
        providerObservations: invalidCaptures,
        providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
          selection.nativeScope === ".scratch/portal"
            ? {
                ...selection,
                observationId: invalidPortal.id,
                effectiveFreshness: "undetermined" as const,
              }
            : selection,
        ),
      }),
    ).success,
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

  expect(projectSnapshotSchema.safeParse(withRebuiltPlanningLineage(scoped)).success).toBe(true);
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

test("derives the direct planned, completed, withdrawn, and superseded readiness matrix", () => {
  const binding = {
    provider: "matt-skills/v1" as const,
    nativeScope: ".scratch/work",
  };
  const capture = {
    id: `provider-observation:sha256:${"a".repeat(64)}`,
    provider: "matt-skills/v1" as const,
    binding,
    state: "available" as const,
    freshness: { assessment: "current" as const },
    coverage: {
      assessment: "complete" as const,
      dimensions: [{ state: "covered" as const }],
    },
    completion: "complete" as const,
    diagnostics: [],
  };
  const gate = {
    id: "gate:test",
    source: "source:test",
    roadmapId: "roadmap:test",
    effortIds: ["effort:test"],
    lifecycle: "active" as const,
    readiness: "not-ready" as const,
    horizonState: "focused" as const,
  };
  const effort = {
    id: "effort:test",
    source: "source:test",
    roadmapId: "roadmap:test",
    targetGateId: "gate:test",
    workBinding: binding,
  };
  const readiness = (
    lifecycle: "planned" | "active" | "concluded",
    disposition?: "completed" | "withdrawn" | "superseded",
  ) =>
    normalizedGateReadiness(
      gate,
      {
        validity: "available",
        items: [
          {
            ...effort,
            lifecycle,
            ...(disposition === undefined ? {} : { conclusion: { disposition } }),
          },
        ],
      },
      [capture],
      [
        {
          provider: capture.provider,
          nativeScope: capture.binding.nativeScope,
          observationId: capture.id,
          effectiveFreshness: capture.freshness.assessment,
        },
      ],
    );

  expect(readiness("planned")).toBe("not-ready");
  expect(readiness("active")).toBe("not-ready");
  expect(readiness("concluded", "completed")).toBe("ready-for-review");
  expect(readiness("concluded", "withdrawn")).toBe("unknown");
  expect(readiness("concluded", "superseded")).toBe("unknown");
});

test("rejects a superseded Effort whose replacement does not preserve its contribution chain", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity !== "available" || snapshot.gates.validity !== "available") {
    throw new Error("Expected complete Effort and Gate projections.");
  }
  rejects({
    ...snapshot,
    efforts: {
      validity: "available",
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:model"
          ? {
              ...effort,
              conclusion: {
                disposition: "superseded",
                rationale: "A replacement is explicitly required.",
                concludedAt: { availability: "unavailable" },
                replacementEffortId: "effort:missing",
              },
            }
          : effort,
      ),
    },
    gates: {
      validity: "available",
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:one" ? { ...gate, readiness: "unknown" } : gate,
      ),
    },
  });
});

test("rejects duplicate provider captures for the same bound scope", () => {
  const snapshot = createProjectOverviewFixture();
  rejects({
    ...snapshot,
    providerObservations: [...snapshot.providerObservations, snapshot.providerObservations[0]],
  });
});
