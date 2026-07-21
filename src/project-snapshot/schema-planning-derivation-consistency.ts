import type { RefinementCtx } from "zod";
import {
  type DerivedCollection,
  type DerivedDiagnostic,
  type DerivedEffort,
  type DerivedGate,
  type DerivedRoadmap,
  type DerivedSource,
  normalizedGateHorizon,
  normalizedGateReadiness,
  normalizedRoadmapHorizon,
} from "./normalized-planning-derivation";

type Frontier = Readonly<{
  claimed: readonly string[];
  ready: readonly string[];
  blocked: readonly string[];
  resolved: readonly string[];
  fogCount: number;
}>;
type Roadmap = DerivedRoadmap & Readonly<{ effortIds: readonly string[] }>;
type Gate = DerivedGate;
type Effort = DerivedEffort & Readonly<{ frontier: Frontier }>;
type NativeMap = Readonly<{
  reference: string;
  source: string;
  state: "active" | "resolved" | "unknown";
  effortId?: string | undefined;
  fogCount: number;
}>;
type Ticket = Readonly<{
  reference: string;
  source: string;
  state: "claimed" | "ready" | "blocked" | "resolved" | "triage";
  effortId?: string | undefined;
  blockedBy: readonly string[];
}>;

export type PlanningDerivationConsistencySnapshot = Readonly<{
  roadmaps: DerivedCollection<Roadmap>;
  gates: DerivedCollection<Gate>;
  efforts: DerivedCollection<Effort>;
  maps: DerivedCollection<NativeMap>;
  tickets: DerivedCollection<Ticket>;
  diagnostics: readonly (DerivedDiagnostic & Readonly<{ reference: string }>)[];
  sources: readonly DerivedSource[];
}>;

const trusted = <T>(collection: DerivedCollection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;
const addIssue = (context: RefinementCtx, path: readonly (string | number)[], message: string) =>
  context.addIssue({ code: "custom", path: [...path], message });

const validateHorizons = (
  snapshot: PlanningDerivationConsistencySnapshot,
  context: RefinementCtx,
): void => {
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
  }
};

const validateReadiness = (
  snapshot: PlanningDerivationConsistencySnapshot,
  context: RefinementCtx,
): void => {
  for (const [position, gate] of trusted(snapshot.gates).entries()) {
    if (gate.readiness !== normalizedGateReadiness(gate, snapshot)) {
      addIssue(
        context,
        ["gates", "items", position, "readiness"],
        "Gate Readiness must match trustworthy contributors, native work, and diagnostics.",
      );
    }
  }
};

export const validatePlanningDerivationConsistency = (
  snapshot: PlanningDerivationConsistencySnapshot,
  context: RefinementCtx,
): void => {
  validateHorizons(snapshot, context);
  validateReadiness(snapshot, context);
};
