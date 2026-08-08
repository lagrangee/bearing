import type { RefinementCtx } from "zod";
import { sameMattNativeBindingDefinition } from "../providers/matt-skills-v1/native-subject";
import {
  type ContributorCapture,
  type ContributorObservationSelection,
  type DerivedCollection,
  hasUntrustedEffortContributor,
  normalizedGateHorizon,
  normalizedGateReadiness,
  normalizedRoadmapHorizon,
} from "./normalized-planning-derivation";

type Roadmap = Readonly<{
  id: string;
  lifecycle: "active" | "completed" | "superseded";
  focusedGateId: string | null;
  gateOrder: readonly string[];
  horizon: "active-horizon" | "exhausted" | "unknown";
  effortIds: readonly string[];
}>;
type Gate = Readonly<{
  id: string;
  source: string;
  roadmapId: string;
  lifecycle: "planned" | "active" | "passed" | "superseded";
  readiness: "unknown" | "not-ready" | "ready-for-review";
  horizonState: "passed" | "focused" | "planned" | "superseded" | "unknown";
  effortIds: readonly string[];
}>;
type Effort = Readonly<{
  id: string;
  source: string;
  roadmapId: string;
  targetGateId: string;
  workBinding?: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }> | undefined;
  workBindingState: Readonly<
    | { state: "bound" }
    | { state: "invalid"; reason: "missing" | "unparseable" | "unresolved" | "conflicting" }
  >;
  lifecycle: "planned" | "active" | "concluded";
  conclusion?:
    | Readonly<{
        disposition: "completed" | "withdrawn" | "superseded";
        replacementEffortId?: string | undefined;
      }>
    | undefined;
}>;

export type PlanningDerivationConsistencySnapshot = Readonly<{
  basis: Readonly<{ basisFingerprint: string }>;
  roadmaps: DerivedCollection<Roadmap>;
  gates: DerivedCollection<Gate>;
  efforts: DerivedCollection<Effort>;
  providerObservations: readonly ContributorCapture[];
  providerObservationSelections: readonly ContributorObservationSelection[];
  diagnostics: readonly Readonly<{
    reference: string;
    code: string;
    impact: "blocking" | "non-blocking";
    target: string;
    message: string;
    source?: string | undefined;
  }>[];
  sources: readonly Readonly<{ reference: string; displayLocator: string }>[];
}>;

const trusted = <T>(collection: DerivedCollection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;
const addIssue = (context: RefinementCtx, path: readonly (string | number)[], message: string) =>
  context.addIssue({ code: "custom", path: [...path], message });

export const validatePlanningDerivationConsistency = (
  snapshot: PlanningDerivationConsistencySnapshot,
  context: RefinementCtx,
): void => {
  for (const [position, observation] of snapshot.providerObservations.entries()) {
    const selection = snapshot.providerObservationSelections.find((candidate) =>
      sameMattNativeBindingDefinition(candidate, observation.binding),
    );
    if (selection?.observationId !== observation.id) {
      addIssue(
        context,
        ["providerObservations", position, "id"],
        "Every Project Read Model generation provider observation must be its scope's exact selected observation.",
      );
    }
  }
  for (const [position, selection] of snapshot.providerObservationSelections.entries()) {
    if (
      selection.observationId !== null &&
      !snapshot.providerObservations.some(
        (observation) =>
          observation.id === selection.observationId &&
          sameMattNativeBindingDefinition(observation.binding, selection),
      )
    ) {
      addIssue(
        context,
        ["providerObservationSelections", position, "observationId"],
        "Every non-empty provider observation selection must resolve inside the Project Read Model generation.",
      );
    }
  }
  for (const [position, roadmap] of trusted(snapshot.roadmaps).entries()) {
    if (roadmap.horizon !== normalizedRoadmapHorizon(roadmap, snapshot.gates)) {
      addIssue(
        context,
        ["roadmaps", "items", position, "horizon"],
        "Roadmap Horizon must match trustworthy lifecycle, Gate order, and focus truth.",
      );
    }
  }
  for (const [position, gate] of trusted(snapshot.gates).entries()) {
    if (gate.horizonState !== normalizedGateHorizon(gate, snapshot.roadmaps)) {
      addIssue(
        context,
        ["gates", "items", position, "horizonState"],
        "Gate Horizon state must match trustworthy lifecycle and Roadmap focus truth.",
      );
    }
    if (
      gate.readiness !==
      normalizedGateReadiness(
        gate,
        snapshot.efforts,
        snapshot.providerObservations,
        snapshot.providerObservationSelections,
        hasUntrustedEffortContributor(snapshot.gates, gate.id),
      )
    ) {
      addIssue(
        context,
        ["gates", "items", position, "readiness"],
        "Gate Readiness must match explicit Effort lifecycle and trustworthy contributor bindings.",
      );
    }
  }
};
