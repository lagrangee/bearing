import { expect, test } from "bun:test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import {
  effortInspection,
  frontierSummary,
  gateInspection,
  roadmapInspection,
} from "../src/portal-ui/project-roadmap-inspection";
import {
  buildRoadmapDetailModel,
  buildRoadmapIndexModel,
} from "../src/portal-ui/project-roadmap-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { encodeGitHubMattNativeScope } from "../src/providers/matt-skills-v1/github";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { withRebuiltPlanningLineage } from "./planning-lineage-fixture";

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
  expect(model.efforts[1]).toMatchObject({
    frontierCountMode: "exact",
    fogCountMode: "exact",
    maps: [{ title: "Portal Validation", fogCount: 2, fogCountMode: "exact" }],
  });
  expect(model.efforts[1]?.frontier.claimed).not.toEqual(
    expect.arrayContaining([{ title: "Pass the integration gate" }]),
  );
  expect(model.evidence.map((entry) => entry.asset.title)).toEqual(["Planning Model Evidence"]);
  expect(model.missingMapRelationCount).toBe(0);
});

test("presents explicit Effort lifecycle and conclusion independently from provider completion", () => {
  const model = buildRoadmapDetailModel(fixture(), "roadmap:portal");
  if (model.state !== "available") throw new Error("Expected available Roadmap Detail.");
  const concluded = model.efforts[0];
  const active = model.efforts[1];
  if (concluded === undefined || active === undefined) throw new Error("Expected both Efforts.");

  expect(effortInspection(concluded).facts).toEqual(
    expect.arrayContaining([
      { label: "Lifecycle", value: "concluded" },
      { label: "Planned at", value: "Time unavailable" },
      { label: "Activated at", value: "Time unavailable" },
      { label: "Conclusion", value: "completed" },
      {
        label: "Conclusion rationale",
        value: "The governed contribution was explicitly accepted as complete.",
      },
      { label: "Concluded at", value: "Time unavailable" },
    ]),
  );
  expect(effortInspection(active).facts).toEqual(
    expect.arrayContaining([
      { label: "Lifecycle", value: "active" },
      { label: "Completion", value: "incomplete" },
    ]),
  );
  expect(effortInspection(active).facts).not.toEqual(
    expect.arrayContaining([{ label: "Conclusion", value: expect.any(String) }]),
  );
});

test("Portal inspectors expose the same applicable event roles without raw source seconds", () => {
  const model = buildRoadmapDetailModel(fixture(), "roadmap:portal");
  if (model.state !== "available") throw new Error("Expected available Roadmap Detail.");
  const gate = model.gates[0];
  if (gate === undefined) throw new Error("Expected a Gate.");

  expect(roadmapInspection(model).facts).toEqual(
    expect.arrayContaining([{ label: "Started at", value: "Time unavailable" }]),
  );
  expect(gateInspection(gate, model.roadmap.title, model.gates.length).facts).toEqual(
    expect.arrayContaining([
      { label: "Planned at", value: "Time unavailable" },
      { label: "Activated at", value: "Time unavailable" },
      { label: "Passage accepted at", value: "Time unavailable" },
    ]),
  );
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
      providerObservations: snapshot.providerObservations.filter(
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

test("propagates scoped partial Ticket issues without publishing a false-ready frontier", () => {
  const snapshot = fixture();
  if (
    snapshot.efforts.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.providerObservations.length !== 2
  ) {
    throw new Error("Expected Efforts, Gates, and Tickets fixture.");
  }
  const providerObservations = snapshot.providerObservations.map((capture) =>
    capture.binding.nativeScope === ".scratch/portal"
      ? (createProviderScopeObservation({
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
        } as never) as typeof capture)
      : capture,
  );
  const portalObservation = providerObservations.find(
    (observation) => observation.binding.nativeScope === ".scratch/portal",
  );
  if (portalObservation === undefined) throw new Error("Expected the Portal observation.");
  const parsed = projectSnapshotSchema.safeParse(
    withRebuiltPlanningLineage({
      ...snapshot,
      gates: {
        validity: "available",
        items: snapshot.gates.items.map((gate) =>
          gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
        ),
      },
      providerObservations,
      providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
        selection.nativeScope === ".scratch/portal"
          ? {
              ...selection,
              observationId: portalObservation.id,
            }
          : selection,
      ),
    }),
  );
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Expected a trustworthy partial Ticket Snapshot.");

  const detail = buildRoadmapDetailModel(parsed.data, "roadmap:portal");
  expect(detail.state).toBe("partial");
  if (detail.state !== "partial") throw new Error("Expected a partial Roadmap Detail.");
  expect(detail.efforts[1]?.frontier).toMatchObject({
    claimed: [{ title: "Build the Roadmap journey" }],
    ready: [],
    uncertain: [{ title: "Review the Roadmap journey" }],
    blocked: [{ title: "Pass the integration gate" }],
  });
  const effort = detail.efforts[1];
  if (effort === undefined) throw new Error("Expected the degraded Effort.");
  expect(effort.providerAssessment).toEqual({
    projectionState: "partial",
    freshness: "current",
    coverage: "incomplete",
    completion: "incomplete",
    blockingDiagnosticCount: 1,
    frontierEvidence: "withheld",
  });
  expect(frontierSummary(effort)).toBe(
    "At least: Claimed 1 · Ready 0 · Uncertain 1 · Blocked 1 · Resolved 0",
  );
  expect(effort.frontierCountMode).toBe("at-least");
  expect(effort.fogCountMode).toBe("at-least");
  expect(effort.maps[0]?.fogCountMode).toBe("at-least");
  expect(effortInspection(effort).facts).toEqual(
    expect.arrayContaining([
      { label: "Capture", value: "partial" },
      { label: "Freshness", value: "current" },
      { label: "Coverage", value: "incomplete" },
      { label: "Completion", value: "incomplete" },
      { label: "Frontier evidence", value: "withheld" },
      { label: "Blocking diagnostics", value: "1" },
    ]),
  );
  expect(buildRoadmapDetailModel(parsed.data, "roadmap:second").state).toBe("available");
});

test("withholds a current-looking prior frontier after the selected latest attempt fails", () => {
  const snapshot = fixture();
  const degraded = {
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
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.nativeScope === ".scratch/portal"
        ? {
            ...selection,
            effectiveFreshness: "undetermined" as const,
            latestAttempt: {
              intent: "full-verification" as const,
              attemptedAt: "2026-07-31T11:00:00.000Z",
              outcome: "failed" as const,
              diagnostics: [
                {
                  code: "provider-observation-acquisition-failed",
                  impact: "blocking" as const,
                  target: ".scratch/portal",
                  message: "The latest verification attempt failed.",
                },
              ],
            },
          }
        : selection,
    ),
  } as ProjectSnapshot;

  const detail = buildRoadmapDetailModel(degraded, "roadmap:portal");
  expect(detail.state).toBe("partial");
  if (detail.state !== "partial") throw new Error("Expected a partial Roadmap Detail.");
  expect(detail.efforts[1]?.frontier).toMatchObject({
    claimed: [{ title: "Build the Roadmap journey" }],
    ready: [],
    uncertain: [{ title: "Review the Roadmap journey" }],
  });
  expect(detail.efforts[1]?.providerAssessment).toMatchObject({
    freshness: "undetermined",
    blockingDiagnosticCount: 1,
    frontierEvidence: "withheld",
  });
});

test("fails a root-kind binding-definition conflict closed across Roadmap and Effort summaries", () => {
  const snapshot = fixture();
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Efforts.");
  const scope = (rootKind: "wayfinder-map" | "parent-issue") =>
    encodeGitHubMattNativeScope({
      host: "github.com",
      rootKind,
      repository: {
        owner: "example",
        name: "portal",
        databaseId: "repository-1",
        nodeId: "R_portal",
      },
      root: {
        objectKind: "issue",
        number: 15,
        databaseId: "issue-15",
        nodeId: "I_15",
      },
    });
  const captureScope = scope("wayfinder-map");
  const bindingScope = scope("parent-issue");
  const conflicted = {
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal"
          ? {
              ...effort,
              workBinding: { provider: "matt-skills/v1" as const, nativeScope: bindingScope },
            }
          : effort,
      ),
    },
    providerObservations: snapshot.providerObservations.map((observation) =>
      observation.binding.nativeScope === ".scratch/portal"
        ? {
            ...observation,
            binding: { provider: "matt-skills/v1" as const, nativeScope: captureScope },
          }
        : observation,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.nativeScope === ".scratch/portal"
        ? { ...selection, nativeScope: captureScope }
        : selection,
    ),
  } as ProjectSnapshot;

  const detail = buildRoadmapDetailModel(conflicted, "roadmap:portal");
  expect(detail.state).toBe("partial");
  if (detail.state !== "partial") throw new Error("Expected a partial Roadmap Detail.");
  const effort = detail.efforts.find((candidate) => candidate.effort.id === "effort:portal");
  expect(effort).toMatchObject({
    bindingAttention: "root-kind-conflict",
    frontierCountMode: "unavailable",
    frontier: {
      claimed: [],
      ready: [],
      uncertain: [],
      blocked: [],
      resolved: [],
    },
  });
  if (effort === undefined) throw new Error("Expected the conflicted Effort.");
  expect(frontierSummary(effort)).toBe("Binding needs attention");
});

test("omits Fog when complete coverage confirms that the optional Map is absent", () => {
  const snapshot = fixture();
  const withoutMap = {
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((observation) => {
      if (
        observation.binding.nativeScope !== ".scratch/portal" ||
        (observation.state !== "available" && observation.state !== "partial")
      ) {
        return observation;
      }
      const { map: _map, ...projection } = observation.projection;
      return {
        ...observation,
        projection: {
          ...projection,
          structuralOrder: projection.structuralOrder.filter(
            (reference) => reference !== ".scratch/portal/map.md",
          ),
        },
      };
    }),
  } as ProjectSnapshot;

  const detail = buildRoadmapDetailModel(withoutMap, "roadmap:portal");
  if (detail.state !== "available") throw new Error("Expected an available Roadmap Detail.");
  const effort = detail.efforts.find((candidate) => candidate.effort.id === "effort:portal");
  expect(effort).toMatchObject({
    maps: [],
    fogCount: 0,
    fogCountMode: "not-applicable",
  });
  if (effort === undefined) throw new Error("Expected the map-free Effort.");
  expect(effortInspection(effort).facts).not.toEqual(
    expect.arrayContaining([{ label: "Fog", value: expect.any(String) }]),
  );
});
