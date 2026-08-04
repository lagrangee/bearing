import type { PlanningLineageSubject } from "./planning-lineage-route";
import { planningLineageSubjectHref } from "./planning-lineage-route";

export type PlanningLineageAgentHandoff = Readonly<{
  identity: PlanningLineageSubject;
  portalRoute: string;
}>;

export const createPlanningLineageAgentHandoff = (
  entryId: string,
  identity: PlanningLineageSubject,
  semanticAnchor?: string,
): PlanningLineageAgentHandoff =>
  Object.freeze({
    identity,
    portalRoute: planningLineageSubjectHref(entryId, identity, semanticAnchor),
  });
