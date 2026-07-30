import type {
  CollectionProjection,
  Effort,
  MilestoneGate,
  Roadmap,
  SnapshotDiagnostic,
  SourceRecord,
} from "./contract";

export type ContributorCapture = Readonly<{
  id: string;
  provider: "matt-skills/v1";
  binding: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>;
  state: "available" | "partial" | "absent" | "invalid";
  freshness: Readonly<{ assessment: "current" | "stale" | "undetermined" }>;
  coverage: Readonly<{
    assessment: "complete" | "incomplete";
    dimensions: readonly Readonly<{
      state: "covered" | "excluded" | "gap" | "conflict";
    }>[];
  }>;
  completion: "incomplete" | "complete" | "undetermined";
  diagnostics: readonly Readonly<{ impact: "blocking" | "non-blocking" }>[];
}>;
export type ContributorObservationSelection = Readonly<{
  provider: "matt-skills/v1";
  nativeScope: string;
  observationId: string | null;
  effectiveFreshness: "current" | "stale" | "undetermined";
}>;

export type DerivedCollection<T> =
  | Readonly<{ validity: "available"; items: readonly T[] }>
  | Readonly<{
      validity: "partial";
      items: readonly T[];
      issues?: readonly unknown[];
    }>
  | Readonly<{ validity: "invalid"; issues?: readonly unknown[] }>;

type DerivedEffort = Readonly<{
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

type DerivedGate = Readonly<{
  id: string;
  source: string;
  roadmapId: string;
  lifecycle: "planned" | "active" | "passed" | "superseded";
  readiness: "unknown" | "not-ready" | "ready-for-review";
  horizonState: "passed" | "focused" | "planned" | "superseded" | "unknown";
  effortIds: readonly string[];
}>;

type DerivedRoadmap = Readonly<{
  id: string;
  lifecycle: "active" | "completed" | "superseded";
  focusedGateId: string | null;
  gateOrder: readonly string[];
  horizon: "active-horizon" | "exhausted" | "unknown";
}>;

const trusted = <T>(collection: DerivedCollection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;

const captureFor = (
  effort: Pick<DerivedEffort, "workBinding">,
  captures: readonly ContributorCapture[],
): ContributorCapture | undefined => {
  const binding = effort.workBinding;
  if (binding === undefined) return undefined;
  return captures.find(
    (capture) =>
      capture.provider === binding.provider && capture.binding.nativeScope === binding.nativeScope,
  );
};

const hasTrustworthyBindingEvidence = (
  effort: DerivedEffort,
  captures: readonly ContributorCapture[],
  selections: readonly ContributorObservationSelection[],
): boolean => {
  const capture = captureFor(effort, captures);
  const selection =
    capture === undefined
      ? undefined
      : selections.find(
          (candidate) =>
            candidate.provider === capture.provider &&
            candidate.nativeScope === capture.binding.nativeScope &&
            candidate.observationId === capture.id,
        );
  return (
    capture !== undefined &&
    selection?.effectiveFreshness === "current" &&
    capture.state === "available" &&
    capture.freshness.assessment === "current" &&
    capture.coverage.assessment === "complete" &&
    capture.coverage.dimensions.every(
      (dimension) => dimension.state !== "gap" && dimension.state !== "conflict",
    ) &&
    capture.diagnostics.every((diagnostic) => diagnostic.impact !== "blocking")
  );
};

export const normalizedGateReadiness = (
  gate: DerivedGate,
  efforts: DerivedCollection<DerivedEffort>,
  captures: readonly ContributorCapture[],
  selections: readonly ContributorObservationSelection[],
  hasUntrustedContributor = false,
): DerivedGate["readiness"] => {
  if (hasUntrustedContributor) return "unknown";
  if (gate.effortIds.length === 0) return "unknown";
  const effortIndex = new Map(trusted(efforts).map((effort) => [effort.id, effort]));
  const contributions = gate.effortIds.map((effortId) => {
    const effort = effortIndex.get(effortId);
    if (
      effort === undefined ||
      effort.targetGateId !== gate.id ||
      effort.roadmapId !== gate.roadmapId ||
      !hasTrustworthyBindingEvidence(effort, captures, selections)
    ) {
      return "unknown" as const;
    }
    if (effort.lifecycle === "planned" || effort.lifecycle === "active") {
      return "pending" as const;
    }
    if (effort.conclusion?.disposition === "completed") return "satisfied" as const;
    if (
      effort.conclusion?.disposition === "withdrawn" ||
      effort.conclusion?.disposition === "superseded"
    ) {
      return "excluded" as const;
    }
    return "unknown" as const;
  });
  if (contributions.some((contribution) => contribution === "unknown")) return "unknown";
  const current = contributions.filter((contribution) => contribution !== "excluded");
  if (current.length === 0) return "unknown";
  return current.every((contribution) => contribution === "satisfied")
    ? "ready-for-review"
    : "not-ready";
};

export const hasUntrustedEffortContributor = (
  gates: DerivedCollection<unknown>,
  gateId: string,
): boolean =>
  gates.validity === "partial" &&
  (gates.issues ?? []).some(
    (issue) =>
      typeof issue === "object" &&
      issue !== null &&
      "code" in issue &&
      issue.code === "untrusted-effort-contributor" &&
      "target" in issue &&
      issue.target === gateId,
  );

export const normalizedRoadmapHorizon = (
  roadmap: DerivedRoadmap,
  gates: DerivedCollection<DerivedGate>,
): DerivedRoadmap["horizon"] => {
  if (roadmap.lifecycle !== "active") return "exhausted";
  const gateIndex = new Map(trusted(gates).map((gate) => [gate.id, gate]));
  if (roadmap.focusedGateId !== null) {
    const gate = gateIndex.get(roadmap.focusedGateId);
    return gate?.roadmapId === roadmap.id ? "active-horizon" : "unknown";
  }
  if (roadmap.gateOrder.length === 0) return "unknown";
  return roadmap.gateOrder.every((gateId) => {
    const gate = gateIndex.get(gateId);
    return (
      gate?.roadmapId === roadmap.id &&
      (gate.lifecycle === "passed" || gate.lifecycle === "superseded")
    );
  })
    ? "exhausted"
    : "unknown";
};

export const normalizedGateHorizon = (
  gate: DerivedGate,
  roadmaps: DerivedCollection<DerivedRoadmap>,
): DerivedGate["horizonState"] => {
  if (gate.lifecycle === "passed" || gate.lifecycle === "superseded") return gate.lifecycle;
  if (gate.lifecycle === "planned") return "planned";
  const roadmap = trusted(roadmaps).find((candidate) => candidate.id === gate.roadmapId);
  return roadmap?.focusedGateId === gate.id ? "focused" : "unknown";
};

const mapCollection = <T>(
  collection: CollectionProjection<T>,
  update: (item: T) => T,
): CollectionProjection<T> => {
  if (collection.validity === "invalid") return collection;
  const items = collection.items.map(update);
  return collection.validity === "available"
    ? { validity: "available", items }
    : { validity: "partial", items, issues: collection.issues };
};

type ProjectionInput = Readonly<{
  roadmaps: CollectionProjection<Roadmap>;
  gates: CollectionProjection<MilestoneGate>;
  efforts: CollectionProjection<Effort>;
  providerObservations: readonly ContributorCapture[];
  providerObservationSelections: readonly ContributorObservationSelection[];
  diagnostics: readonly SnapshotDiagnostic[];
  sources: readonly SourceRecord[];
}>;

type NormalizedPlanningProjection = Readonly<{
  roadmaps: CollectionProjection<Roadmap>;
  gates: CollectionProjection<MilestoneGate>;
  efforts: CollectionProjection<Effort>;
}>;

const effortIdsFor = (
  efforts: CollectionProjection<Effort>,
  matches: (effort: Effort) => boolean,
): readonly Effort["id"][] =>
  trusted(efforts)
    .filter(matches)
    .map((effort) => effort.id)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));

export const normalizePlanningDerivations = (
  input: ProjectionInput,
): NormalizedPlanningProjection => {
  const efforts = input.efforts;
  const roadmaps = mapCollection(input.roadmaps, (roadmap) => ({
    ...roadmap,
    horizon: normalizedRoadmapHorizon(roadmap, input.gates),
    effortIds: effortIdsFor(efforts, (effort) => effort.roadmapId === roadmap.id),
  }));
  const gatesWithRelations = mapCollection(input.gates, (gate) => ({
    ...gate,
    horizonState: normalizedGateHorizon(gate, roadmaps),
    effortIds: effortIdsFor(efforts, (effort) => effort.targetGateId === gate.id),
  }));
  const gates = mapCollection(gatesWithRelations, (gate) => ({
    ...gate,
    readiness: normalizedGateReadiness(
      gate,
      efforts,
      input.providerObservations,
      input.providerObservationSelections,
      hasUntrustedEffortContributor(gatesWithRelations, gate.id),
    ),
  }));
  return { roadmaps, gates, efforts };
};
