import { createProviderScopeObservation } from "../../src/native-work-provider";
import type { ProjectGeneration } from "../../src/project-generation/contract";
import { effortSchema } from "../../src/project-generation/schema";
import { parseRebuiltPlanningLineageFixture } from "../planning-lineage-fixture";
import { createProjectOverviewFixture } from "./project-overview";

const replacePortalObservation = (
  transform: (
    observation: Extract<
      ProjectGeneration["providerObservations"][number],
      { state: "available" | "partial" }
    >,
  ) => Extract<
    ProjectGeneration["providerObservations"][number],
    { state: "available" | "partial" }
  >,
): ProjectGeneration => {
  const snapshot = createProjectOverviewFixture();
  const portal = snapshot.providerObservations.find(
    (observation) =>
      observation.binding.nativeScope === ".scratch/portal" &&
      (observation.state === "available" || observation.state === "partial"),
  );
  if (portal === undefined || (portal.state !== "available" && portal.state !== "partial")) {
    throw new Error("Expected the Portal observation.");
  }
  const replacement = transform(portal);
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((observation) =>
      observation.id === portal.id ? replacement : observation,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === portal.id
        ? { ...selection, observationId: replacement.id }
        : selection,
    ),
  });
};

const withoutPortalWork = (
  observation: Extract<
    ProjectGeneration["providerObservations"][number],
    { state: "available" | "partial" }
  >,
) => ({
  ...observation.projection,
  wayfinderTickets: [],
  deliveryTickets: [],
  incomingIssues: [],
  structuralOrder: [observation.projection.map?.ref, observation.projection.spec?.ref].filter(
    (reference) => reference !== undefined,
  ),
  graph: { parentChild: [], blockedBy: [] },
});

export const createConfirmedNoManagedWorkFixture = (): ProjectGeneration =>
  replacePortalObservation(
    (portal) =>
      createProviderScopeObservation({
        ...portal,
        projection: withoutPortalWork(portal),
      } as never) as typeof portal,
  );

export const createAttentionWithoutActiveWorkFixture = (): ProjectGeneration =>
  replacePortalObservation(
    (portal) =>
      createProviderScopeObservation({
        ...portal,
        state: "partial",
        coverage: { assessment: "incomplete", dimensions: [{ key: "scope", state: "gap" }] },
        projection: withoutPortalWork(portal),
      } as never) as typeof portal,
  );

export const createHistoryOnlyWorkFixture = (): ProjectGeneration => createProjectOverviewFixture();

export const createAvailableLifecycleTimeFixture = (): ProjectGeneration => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Efforts.");
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:model"
          ? effortSchema.parse({
              ...effort,
              conclusion: {
                ...effort.conclusion,
                concludedAt: {
                  availability: "available",
                  value: "2026-07-31T10:00:00Z",
                  precision: "second",
                },
              },
            })
          : effort,
      ),
    },
  });
};
