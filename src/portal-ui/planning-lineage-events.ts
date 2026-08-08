import type { PlanningLineageRelationKey, PlanningLineageSubject } from "../planning-lineage-route";
import type {
  AssetProjection,
  Authority,
  Effort,
  MilestoneGate,
  PlanningReview,
  Roadmap,
} from "../project-snapshot/contract";
import type { SourceEventTime } from "../source-event-time";
import type { LineageModelData } from "./project-data";

export type PlanningLineageEventTime = SourceEventTime | Readonly<{ availability: "unsupported" }>;

export type PlanningLineageEvent<TTime extends PlanningLineageEventTime = SourceEventTime> =
  Readonly<{
    role: string;
    label: string;
    time: TTime;
    decisionReference?: string | undefined;
  }>;

type SubjectRecord =
  | Roadmap
  | MilestoneGate
  | Effort
  | Authority
  | PlanningReview
  | AssetProjection;

const event = (
  role: string,
  label: string,
  time: SourceEventTime,
  decisionReference?: string,
): PlanningLineageEvent => ({
  role,
  label,
  time,
  ...(decisionReference === undefined ? {} : { decisionReference }),
});

const trustedItems = <T>(
  collection:
    | Readonly<{ validity: "available"; items: readonly T[] }>
    | Readonly<{ validity: "partial"; items: readonly T[]; issues: readonly unknown[] }>
    | Readonly<{ validity: "invalid"; issues: readonly unknown[] }>,
): readonly T[] => (collection.validity === "invalid" ? [] : collection.items);

const targetRecord = (
  snapshot: LineageModelData,
  subject: PlanningLineageSubject,
): SubjectRecord | undefined => {
  switch (subject.kind) {
    case "roadmap":
      return trustedItems(snapshot.roadmaps).find((candidate) => candidate.id === subject.id);
    case "gate":
      return trustedItems(snapshot.gates).find((candidate) => candidate.id === subject.id);
    case "effort":
      return trustedItems(snapshot.efforts).find((candidate) => candidate.id === subject.id);
    case "authority":
      return trustedItems(snapshot.authorities).find((candidate) => candidate.id === subject.id);
    case "planning-review":
      return trustedItems(snapshot.reviews).find((candidate) => candidate.id === subject.id);
    case "asset":
      return trustedItems(snapshot.assets).find((candidate) => candidate.id === subject.id);
    case "native-scope":
    case "native-subject":
      return undefined;
  }
};

export const roadmapLifecycleEvents = (roadmap: Roadmap): readonly PlanningLineageEvent[] => [
  event("roadmap.started", "Started", roadmap.startedAt),
  ...(roadmap.completedAt === undefined
    ? []
    : [event("roadmap.completed", "Completed", roadmap.completedAt)]),
  ...(roadmap.supersededAt === undefined
    ? []
    : [event("roadmap.superseded", "Superseded", roadmap.supersededAt)]),
];

export const gateLifecycleEvents = (gate: MilestoneGate): readonly PlanningLineageEvent[] => [
  event("gate.planned", "Planned", gate.plannedAt),
  ...(gate.activatedAt === undefined
    ? []
    : [event("gate.activated", "Activated", gate.activatedAt)]),
  ...(gate.passage === undefined
    ? []
    : [event("gate.passage-accepted", "Passage accepted", gate.passage.acceptedAt)]),
  ...(gate.supersededAt === undefined
    ? []
    : [event("gate.superseded", "Superseded", gate.supersededAt)]),
];

export const effortLifecycleEvents = (effort: Effort): readonly PlanningLineageEvent[] => [
  event("effort.planned", "Planned", effort.plannedAt),
  ...(effort.activatedAt === undefined
    ? []
    : [event("effort.activated", "Activated", effort.activatedAt)]),
  ...(effort.conclusion === undefined
    ? []
    : [event("effort.concluded", "Concluded", effort.conclusion.concludedAt)]),
];

export const assetLifecycleEvents = (asset: AssetProjection): readonly PlanningLineageEvent[] => [
  event("asset.added", "Added to Assets", asset.addedAt),
  ...(asset.supersededAt === undefined
    ? []
    : [event("asset.superseded", "Superseded", asset.supersededAt)]),
  ...(asset.archivedAt === undefined
    ? []
    : [event("asset.archived", "Archived", asset.archivedAt)]),
];

export const planningLineageEventsFor = (
  _snapshot: LineageModelData,
  subject: PlanningLineageSubject,
  record: SubjectRecord,
): readonly PlanningLineageEvent[] => {
  switch (subject.kind) {
    case "roadmap": {
      return roadmapLifecycleEvents(record as Roadmap);
    }
    case "gate": {
      return gateLifecycleEvents(record as MilestoneGate);
    }
    case "effort": {
      return effortLifecycleEvents(record as Effort);
    }
    case "authority":
      return [];
    case "planning-review": {
      const review = record as PlanningReview;
      return review.resolution === undefined
        ? []
        : [event("planning-review.accepted", "Accepted decision", review.resolution.acceptedAt)];
    }
    case "asset": {
      return assetLifecycleEvents(record as AssetProjection);
    }
    case "native-scope":
    case "native-subject":
      return [];
  }
};

export const latestPlanningLineageEvent = (
  events: readonly PlanningLineageEvent[],
): PlanningLineageEvent | undefined => events.at(-1);

export const planningLineageRelationEvent = (
  snapshot: LineageModelData,
  owner: PlanningLineageSubject,
  ownerRecord: SubjectRecord,
  relationKey: PlanningLineageRelationKey,
  target: PlanningLineageSubject | undefined,
  _targetReference: string,
): PlanningLineageEvent | undefined => {
  switch (relationKey) {
    case "asset.replacement": {
      if (owner.kind !== "asset") return undefined;
      const supersededAt = (ownerRecord as AssetProjection).supersededAt;
      return supersededAt === undefined
        ? undefined
        : event("asset.superseded", "Superseded", supersededAt);
    }
    case "governance.changed-references": {
      if (owner.kind === "planning-review") {
        const resolution = (ownerRecord as PlanningReview).resolution;
        return resolution === undefined
          ? undefined
          : event("planning-review.accepted", "Accepted decision", resolution.acceptedAt);
      }
      return undefined;
    }
    case "outcome.ordered-gates":
    case "outcome.contributing-efforts":
    case "production.owned-assets": {
      if (target === undefined) return undefined;
      const record = targetRecord(snapshot, target);
      return record === undefined
        ? undefined
        : latestPlanningLineageEvent(planningLineageEventsFor(snapshot, target, record));
    }
    default:
      return undefined;
  }
};
