import { expect, test } from "bun:test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import { effortInspection, frontierSummary } from "../src/portal-ui/project-roadmap-inspection";
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
  const parsed = projectSnapshotSchema.safeParse({
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
  });
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Expected a trustworthy partial Ticket Snapshot.");

  const detail = buildRoadmapDetailModel(parsed.data, "roadmap:portal");
  expect(detail.state).toBe("partial");
  if (detail.state !== "partial") throw new Error("Expected a partial Roadmap Detail.");
  expect(detail.efforts[1]?.frontier).toMatchObject({
    claimed: [],
    ready: [],
    uncertain: [{ title: "Build the Roadmap journey" }, { title: "Review the Roadmap journey" }],
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
    "Claimed 0 · Ready 0 · Uncertain 2 · Blocked 1 · Resolved 0",
  );
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
    claimed: [],
    ready: [],
    uncertain: [{ title: "Build the Roadmap journey" }, { title: "Review the Roadmap journey" }],
  });
  expect(detail.efforts[1]?.providerAssessment).toMatchObject({
    freshness: "undetermined",
    blockingDiagnosticCount: 1,
    frontierEvidence: "withheld",
  });
});
