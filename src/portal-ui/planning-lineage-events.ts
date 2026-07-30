import type { PlanningLineageRelationKey, PlanningLineageSubject } from "../planning-lineage-route";
import type {
  AlignmentCheck,
  AssetProjection,
  Authority,
  Effort,
  MilestoneGate,
  PlanningReview,
  ProjectSnapshot,
  Roadmap,
} from "../project-snapshot/contract";
import type { SourceEventTime } from "../source-event-time";

export type PlanningLineageEvent = Readonly<{
  role: string;
  label: string;
  time: SourceEventTime;
  decisionReference?: string | undefined;
}>;

type SubjectRecord =
  | Roadmap
  | MilestoneGate
  | Effort
  | Authority
  | AlignmentCheck
  | PlanningReview
  | AssetProjection;

const unavailableTime: SourceEventTime = { availability: "unavailable" };
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

const acceptedDecisionTime = (snapshot: ProjectSnapshot, reference: string): SourceEventTime => {
  if (reference.startsWith("alignment-check:")) {
    return (
      trustedItems(snapshot.checks).find((check) => check.id === reference)?.resolution
        ?.acceptedAt ?? unavailableTime
    );
  }
  return (
    trustedItems(snapshot.reviews).find((review) => review.id === reference)?.resolution
      ?.acceptedAt ?? unavailableTime
  );
};

const assetTitle = (snapshot: ProjectSnapshot, id: string): string =>
  trustedItems(snapshot.assets).find((asset) => asset.id === id)?.title ?? id;

const authorityAdoptionEvent = (
  snapshot: ProjectSnapshot,
  authority: Authority,
  assetId: string,
): PlanningLineageEvent | undefined => {
  const adoption = authority.adoptions.find((candidate) => candidate.assetId === assetId);
  return adoption === undefined
    ? undefined
    : event(
        "authority.adoption",
        "Adopted",
        acceptedDecisionTime(snapshot, adoption.decisionReference),
        adoption.decisionReference,
      );
};

const targetRecord = (
  snapshot: ProjectSnapshot,
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
    case "alignment-check":
      return trustedItems(snapshot.checks).find((candidate) => candidate.id === subject.id);
    case "planning-review":
      return trustedItems(snapshot.reviews).find((candidate) => candidate.id === subject.id);
    case "asset":
      return trustedItems(snapshot.assets).find((candidate) => candidate.id === subject.id);
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
  ...(asset.producedAt === undefined
    ? []
    : [event("asset.produced", "Produced", asset.producedAt)]),
  event("asset.registered", "Registered", asset.registeredAt),
  ...(asset.supersededAt === undefined
    ? []
    : [event("asset.superseded", "Superseded", asset.supersededAt)]),
  ...(asset.archivedAt === undefined
    ? []
    : [event("asset.archived", "Archived", asset.archivedAt)]),
];

export const planningLineageEventsFor = (
  snapshot: ProjectSnapshot,
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
    case "authority": {
      const authority = record as Authority;
      return authority.adoptions.map((adoption) =>
        event(
          "authority.adoption",
          `Adopted ${assetTitle(snapshot, adoption.assetId)}`,
          acceptedDecisionTime(snapshot, adoption.decisionReference),
          adoption.decisionReference,
        ),
      );
    }
    case "alignment-check": {
      const check = record as AlignmentCheck;
      return check.resolution === undefined
        ? []
        : [event("alignment-check.accepted", "Accepted decision", check.resolution.acceptedAt)];
    }
    case "planning-review": {
      const review = record as PlanningReview;
      return review.resolution === undefined
        ? []
        : [event("planning-review.accepted", "Accepted decision", review.resolution.acceptedAt)];
    }
    case "asset": {
      return assetLifecycleEvents(record as AssetProjection);
    }
  }
};

export const latestPlanningLineageEvent = (
  events: readonly PlanningLineageEvent[],
): PlanningLineageEvent | undefined => events.at(-1);

export const planningLineageRelationEvent = (
  snapshot: ProjectSnapshot,
  owner: PlanningLineageSubject,
  ownerRecord: SubjectRecord,
  relationKey: PlanningLineageRelationKey,
  target: PlanningLineageSubject | undefined,
  targetReference: string,
): PlanningLineageEvent | undefined => {
  switch (relationKey) {
    case "adoption.used-by": {
      if (owner.kind === "authority") {
        return authorityAdoptionEvent(snapshot, ownerRecord as Authority, targetReference);
      }
      if (owner.kind === "asset" && target?.kind === "authority") {
        const authority = targetRecord(snapshot, target) as Authority | undefined;
        return authority === undefined
          ? undefined
          : authorityAdoptionEvent(snapshot, authority, owner.id);
      }
      return undefined;
    }
    case "passage.evidence": {
      if (owner.kind !== "gate") return undefined;
      const passage = (ownerRecord as MilestoneGate).passage;
      return passage === undefined
        ? undefined
        : event("gate.passage-accepted", "Passage accepted", passage.acceptedAt);
    }
    case "passage.used-by": {
      if (owner.kind !== "asset" || target?.kind !== "gate") return undefined;
      const gate = targetRecord(snapshot, target) as MilestoneGate | undefined;
      return gate?.passage === undefined
        ? undefined
        : event("gate.passage-accepted", "Passage accepted", gate.passage.acceptedAt);
    }
    case "asset.replacement": {
      if (owner.kind !== "asset") return undefined;
      const supersededAt = (ownerRecord as AssetProjection).supersededAt;
      return supersededAt === undefined
        ? undefined
        : event("asset.superseded", "Superseded", supersededAt);
    }
    case "governance.changed-references": {
      if (owner.kind === "alignment-check") {
        const resolution = (ownerRecord as AlignmentCheck).resolution;
        return resolution === undefined
          ? undefined
          : event("alignment-check.accepted", "Accepted decision", resolution.acceptedAt);
      }
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
