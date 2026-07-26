import type { RefinementCtx } from "zod";
import { validateAdvisoryConsistency } from "./schema-advisory-consistency";
import {
  type AssetConsistencySnapshot,
  validateAssetConsistency,
} from "./schema-asset-consistency";
import {
  type AttentionConsistencySnapshot,
  validateAttentionConsistency,
} from "./schema-attention-consistency";
import {
  type AuditConsistencySnapshot,
  validateAuditConsistency,
} from "./schema-audit-consistency";
import {
  type NativeConsistencySnapshot,
  validateNativeConsistency,
} from "./schema-native-consistency";
import {
  type PlanningDerivationConsistencySnapshot,
  validatePlanningDerivationConsistency,
} from "./schema-planning-derivation-consistency";
import { validateRoadmapConsistency } from "./schema-roadmap-consistency";
import {
  type SourceBindingConsistencySnapshot,
  validateSourceBindingConsistency,
} from "./schema-source-binding-consistency";
import { validateSourceConsistency } from "./schema-source-consistency";

type ProjectionIssue = Readonly<{
  code: string;
  target: string;
  message: string;
  source?: string | undefined;
}>;

type Collection<T> =
  | Readonly<{ validity: "available"; items: readonly T[] }>
  | Readonly<{
      validity: "partial";
      items: readonly T[];
      issues: readonly ProjectionIssue[];
    }>
  | Readonly<{ validity: "invalid"; issues: readonly ProjectionIssue[] }>;
type CollectionItem<T> = T extends Readonly<{ items: readonly (infer Item)[] }> ? Item : never;

type Singleton<T> =
  | Readonly<{ validity: "available"; value: T }>
  | Readonly<{ validity: "partial"; value: T; issues: readonly ProjectionIssue[] }>
  | Readonly<{ validity: "absent" | "invalid" }>;

type RoadmapIndex = Readonly<{
  source: string;
  activeRoadmapIds: readonly string[];
  completedRoadmapIds: readonly string[];
  supersededRoadmapIds: readonly string[];
}>;

type AuditBasis = Readonly<{
  id: string;
  source: string;
  semanticFreshness: "current" | "stale" | "unknown";
  coverage: "complete" | "incomplete";
  findings: readonly Readonly<{
    id: string;
    source: string;
    evidenceSourceReferences: readonly string[];
    promotion?:
      | Readonly<{
          kind: "alignment-check" | "planning-review";
          id: string;
        }>
      | undefined;
  }>[];
}>;

type GuidanceBasis = Readonly<{
  id: string;
  semanticCoverage: "absent" | "partial" | "complete";
  basedOnAuditId?: "planning-audit:current" | undefined;
  source: string;
  primary: Readonly<{ source: string }>;
  alternatives: readonly Readonly<{ source: string }>[];
}>;

type PrimarySource = Readonly<{ id: string; source: string }>;

type GovernanceSnapshot = Readonly<{
  basis: AuditConsistencySnapshot["basis"];
  summary: Singleton<PrimarySource>;
  roadmaps: Collection<
    CollectionItem<PlanningDerivationConsistencySnapshot["roadmaps"]> &
      CollectionItem<AssetConsistencySnapshot["roadmaps"]> &
      PrimarySource
  >;
  gates: Collection<
    CollectionItem<PlanningDerivationConsistencySnapshot["gates"]> &
      CollectionItem<AssetConsistencySnapshot["gates"]> &
      PrimarySource
  >;
  efforts: Collection<
    CollectionItem<PlanningDerivationConsistencySnapshot["efforts"]> &
      CollectionItem<NativeConsistencySnapshot["efforts"]> &
      CollectionItem<AssetConsistencySnapshot["efforts"]> &
      PrimarySource
  >;
  authorities: Collection<CollectionItem<AssetConsistencySnapshot["authorities"]> & PrimarySource>;
  assets: Collection<CollectionItem<AssetConsistencySnapshot["assets"]> & PrimarySource>;
  maps: PlanningDerivationConsistencySnapshot["maps"];
  tickets: PlanningDerivationConsistencySnapshot["tickets"];
  roadmapIndex: Singleton<RoadmapIndex>;
  diagnostics: PlanningDerivationConsistencySnapshot["diagnostics"];
  checks: Collection<
    CollectionItem<AttentionConsistencySnapshot["checks"]> &
      CollectionItem<AssetConsistencySnapshot["checks"]>
  >;
  reviews: Collection<
    CollectionItem<AttentionConsistencySnapshot["reviews"]> &
      CollectionItem<AssetConsistencySnapshot["reviews"]>
  >;
  attention: AttentionConsistencySnapshot["attention"];
  audit: Singleton<AuditBasis>;
  guidance: Singleton<GuidanceBasis>;
  sources: SourceBindingConsistencySnapshot["sources"];
}>;

const trustedItems = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;

const trustedValue = <T>(singleton: Singleton<T>): T | undefined =>
  singleton.validity === "available" || singleton.validity === "partial"
    ? singleton.value
    : undefined;

const validateRoadmapIndex = (snapshot: GovernanceSnapshot, context: RefinementCtx): void => {
  const index = trustedValue(snapshot.roadmapIndex);
  if (index === undefined) return;
  const roadmaps = new Map(trustedItems(snapshot.roadmaps).map((roadmap) => [roadmap.id, roadmap]));
  const groups = [
    ["activeRoadmapIds", "active"],
    ["completedRoadmapIds", "completed"],
    ["supersededRoadmapIds", "superseded"],
  ] as const;
  for (const [field, lifecycle] of groups) {
    const expected = new Set(
      [...roadmaps.values()]
        .filter((roadmap) => roadmap.lifecycle === lifecycle)
        .map((roadmap) => roadmap.id),
    );
    const exact =
      index[field].length === expected.size && index[field].every((id) => expected.has(id));
    if (!exact) {
      context.addIssue({
        code: "custom",
        path: ["roadmapIndex", "value", field],
        message: "Each Roadmap Index lifecycle group must exactly cover trustworthy Roadmaps.",
      });
    }
  }
};

export const validateProjectSnapshotConsistency = (
  snapshot: GovernanceSnapshot,
  context: RefinementCtx,
): void => {
  const gates = new Map(trustedItems(snapshot.gates).map((gate) => [gate.id, gate]));

  for (const [roadmapPosition, roadmap] of trustedItems(snapshot.roadmaps).entries()) {
    if (roadmap.focusedGateId !== null && !roadmap.gateOrder.includes(roadmap.focusedGateId)) {
      context.addIssue({
        code: "custom",
        path: ["roadmaps", "items", roadmapPosition, "focusedGateId"],
        message: "A Roadmap can focus only a Gate in its declared order.",
      });
    }

    for (const [gatePosition, gateId] of roadmap.gateOrder.entries()) {
      const gate = gates.get(gateId);
      if (gate !== undefined && gate.roadmapId !== roadmap.id) {
        context.addIssue({
          code: "custom",
          path: ["roadmaps", "items", roadmapPosition, "gateOrder", gatePosition],
          message: "A Roadmap can order only Gates that declare it as their owner.",
        });
      }
    }
  }

  validateAttentionConsistency(snapshot, context);
  validateRoadmapIndex(snapshot, context);
  validateRoadmapConsistency(snapshot, context);
  validateNativeConsistency(snapshot, context);
  validatePlanningDerivationConsistency(snapshot, context);
  validateAssetConsistency(snapshot, context);
  validateAdvisoryConsistency(snapshot, context);
  validateAuditConsistency(snapshot, context);
  validateSourceConsistency(snapshot, context);
  validateSourceBindingConsistency(snapshot, context);
};
