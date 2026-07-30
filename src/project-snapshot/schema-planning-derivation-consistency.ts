import type { RefinementCtx } from "zod";
import {
  type ContributorCapture,
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
  lifecycle: "planned" | "active" | "concluded";
  conclusion?:
    | Readonly<{
        disposition: "completed" | "withdrawn" | "superseded";
        replacementEffortId?: string | undefined;
      }>
    | undefined;
}>;

export type PlanningDerivationConsistencySnapshot = Readonly<{
  basis: Readonly<{ sitemapFingerprint: string }>;
  roadmaps: DerivedCollection<Roadmap>;
  gates: DerivedCollection<Gate>;
  efforts: DerivedCollection<Effort>;
  providerCaptures: readonly ContributorCapture[];
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
  for (const [position, capture] of snapshot.providerCaptures.entries()) {
    if (
      "generation" in capture &&
      capture.generation.fingerprint !== snapshot.basis.sitemapFingerprint
    ) {
      addIssue(
        context,
        ["providerCaptures", position, "generation", "fingerprint"],
        "Provider capture generation must match the Project Snapshot basis.",
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
        snapshot.providerCaptures,
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
