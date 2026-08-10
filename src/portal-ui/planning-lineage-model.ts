import type { PlanningLineageRelationKey, PlanningLineageSubject } from "../planning-lineage-route";
import {
  planningLineageFilteredViewHref,
  planningLineageSubjectHref,
} from "../planning-lineage-route";
import type {
  AssetProjection,
  Authority,
  Effort,
  PlanningLineageRelation as GenerationLineageRelation,
  MilestoneGate,
  PlanningLineageSubjectProjection,
  PlanningReview,
  Roadmap,
  SourceRecord,
} from "../project-generation/contract";
import { findPlanningLineageSubjectProjection } from "../project-generation/planning-lineage";
import type { ProviderSemanticSection } from "../provider-semantic-section";
import type {
  MattDeliveryTicket,
  MattIncomingIssue,
  MattMap,
  MattNativeEventTime,
  MattProviderAuthoredDocument,
  MattSemanticSectionAvailability,
  MattSpec,
  MattWayfinderTicket,
} from "../providers/matt-skills-v1/model";
import {
  assessMattNativeEvidence,
  hasCompleteMattNativeEvidence,
  type MattNativeRecord,
  type MattNativeScopeRecord,
  mattNativeRecords,
} from "../providers/matt-skills-v1/native-read-model";
import {
  type MattNativeSubject,
  mattNativeScopeKey,
  mattNativeScopeSubject,
  mattNativeSubjectForObject,
  sameMattNativeLocator,
  sameMattNativeScope,
} from "../providers/matt-skills-v1/native-subject";
import type { MattProjectedObject } from "../providers/matt-skills-v1/projection";
import {
  type MattNativeWorkReadingState,
  mattNativeWorkReadingContextForEffort,
  mattNativeWorkReadingContextForScope,
} from "../providers/matt-skills-v1/reading-state";
import {
  buildMattNativeWorkRegion,
  type MattNativeWorkRegionContext,
  type MattNativeWorkRegionCount,
  type MattNativeWorkRegionItem,
  type MattNativeWorkRegionModel,
} from "../providers/matt-skills-v1/work-region";
import { projectExpectedSourceEventTime, type SourceEventTime } from "../source-event-time";
import {
  type PlanningLineageEvent,
  type PlanningLineageEventTime,
  planningLineageEventsFor,
  planningLineageRelationEvent,
} from "./planning-lineage-events";
import { semanticTitleForPlanningReference } from "./planning-reference-title";
import type { LineageModelData } from "./project-data";
import { assetPreviewHref } from "./project-route";

const RELATION_PREVIEW_LIMIT = 3;

type CanonicalSubjectRecord =
  | Roadmap
  | MilestoneGate
  | Effort
  | Authority
  | PlanningReview
  | AssetProjection;
type NativeScopeRecord = MattNativeScopeRecord;
type NativeRecord = MattNativeRecord;
type SubjectRecord = CanonicalSubjectRecord | NativeRecord;

export type PlanningLineageRelationItem = Readonly<{
  reference: string;
  label: string;
  availability: "available" | "unavailable";
  event?: PlanningLineageEvent | undefined;
  href?: string | undefined;
  note?: string | undefined;
}>;

type RelationBase = Readonly<{
  key: PlanningLineageRelationKey;
  label: string;
  direction: string;
  inParentPath: boolean;
}>;

export type PlanningLineageRelation =
  | (RelationBase &
      Readonly<{
        state: "present";
        items: readonly PlanningLineageRelationItem[];
        allItems: readonly PlanningLineageRelationItem[];
        total: Readonly<{ count: number; coverage: "complete" | "at-least" }>;
        filteredViewHref?: string | undefined;
      }>)
  | (RelationBase & Readonly<{ state: "confirmed-none"; reason: string }>)
  | (RelationBase & Readonly<{ state: "unknown"; reason: string }>)
  | (RelationBase & Readonly<{ state: "unavailable"; reason: string }>);

type PlanningLineageProviderDocument = Readonly<{
  key: string;
  showSectionTitles: boolean;
  sections: readonly (Readonly<{
    version: ProviderSemanticSection["version"];
    sourceIdentity: string;
    title: string;
    sourceOrder: number;
  }> &
    (
      | Readonly<{
          availability: "available";
          html: string;
          presentation: "rendered" | "fallback";
        }>
      | Readonly<{ availability: "available"; markdown: string }>
      | Readonly<{ availability: "confirmed-empty" | "unavailable" | "unsupported" }>
    ))[];
  provenance: Readonly<{
    facts: readonly PlanningLineageFact[];
    times: readonly PlanningLineageTimeFact[];
  }>;
}>;

export type PlanningLineageEffortRollupRow = Readonly<{
  id: string;
  title: string;
  href?: string | undefined;
  lifecycle?: Effort["lifecycle"] | undefined;
  lifecycleTime?:
    | Readonly<{ label: "Planned" | "Activated" | "Concluded"; time: SourceEventTime }>
    | undefined;
  counts: Readonly<{
    claimed: MattNativeWorkRegionCount;
    ready: MattNativeWorkRegionCount;
    blocked: MattNativeWorkRegionCount;
    resolved: MattNativeWorkRegionCount;
  }>;
}>;

type PlanningLineageRelationLink = Readonly<{
  label: string;
  prefix?: string | undefined;
  detail?: string | undefined;
  href?: string | undefined;
  external?: boolean | undefined;
  availability?: "available" | "unavailable" | undefined;
}>;

export type PlanningLineageSectionContent =
  | Readonly<{ kind: "plain-prose"; source: "canonical" | "system"; value: string }>
  | Readonly<{ kind: "provider-document"; document: PlanningLineageProviderDocument }>
  | Readonly<{
      kind: "fact-list";
      style: "definitions";
      facts: readonly PlanningLineageFact[];
    }>
  | Readonly<{ kind: "fact-list"; style: "bulleted"; values: readonly string[] }>
  | Readonly<{
      kind: "relation-list";
      relations: readonly PlanningLineageRelationLink[];
    }>
  | Readonly<{ kind: "time-facts"; facts: readonly PlanningLineageTimeFact[] }>
  | Readonly<{
      kind: "actions";
      actions: readonly Readonly<{ kind: "copy"; label: string; value: string }>[];
    }>
  | Readonly<{ kind: "effort-rollup"; rows: readonly PlanningLineageEffortRollupRow[] }>;

export type PlanningLineageSection = Readonly<{
  anchor: string;
  title: string;
  content: readonly PlanningLineageSectionContent[];
}>;

type PlanningLineageSectionInput = Readonly<{
  anchor: string;
  title: string;
  body?: string | undefined;
  bodySource?: "canonical" | "system" | undefined;
  providerDocument?: PlanningLineageProviderDocument | undefined;
  facts?: readonly PlanningLineageFact[] | undefined;
  providerDocuments?: readonly PlanningLineageProviderDocument[] | undefined;
  copy?: Readonly<{ label: string; value: string }> | undefined;
  items?: readonly string[] | undefined;
  links?: readonly PlanningLineageRelationLink[] | undefined;
  times?: readonly PlanningLineageTimeFact[] | undefined;
  effortRollup?: readonly PlanningLineageEffortRollupRow[] | undefined;
}>;

const planningLineageSection = (input: PlanningLineageSectionInput): PlanningLineageSection => ({
  anchor: input.anchor,
  title: input.title,
  content: [
    ...(input.body === undefined
      ? []
      : [
          {
            kind: "plain-prose" as const,
            source: input.bodySource ?? "canonical",
            value: input.body,
          },
        ]),
    ...(input.providerDocument === undefined
      ? []
      : [
          {
            kind: "provider-document" as const,
            document: input.providerDocument,
          },
        ]),
    ...(input.facts === undefined
      ? []
      : [{ kind: "fact-list" as const, style: "definitions" as const, facts: input.facts }]),
    ...(input.providerDocuments ?? []).map((document) => ({
      kind: "provider-document" as const,
      document,
    })),
    ...(input.copy === undefined
      ? []
      : [
          {
            kind: "actions" as const,
            actions: [{ kind: "copy" as const, label: input.copy.label, value: input.copy.value }],
          },
        ]),
    ...(input.items === undefined
      ? []
      : [{ kind: "fact-list" as const, style: "bulleted" as const, values: input.items }]),
    ...(input.links === undefined
      ? []
      : [{ kind: "relation-list" as const, relations: input.links }]),
    ...(input.times === undefined ? [] : [{ kind: "time-facts" as const, facts: input.times }]),
    ...(input.effortRollup === undefined
      ? []
      : [{ kind: "effort-rollup" as const, rows: input.effortRollup }]),
  ],
});

export type PlanningLineageFact = Readonly<{
  key: string;
  label: string;
  value: string;
}>;

export type PlanningLineageTimeFact = Readonly<{
  key: string;
  label: string;
  time: PlanningLineageEventTime;
  mode?: "compact" | "detail" | undefined;
  detail?: string | undefined;
}>;

export type PlanningLineageOutcomeSpine = Readonly<{
  layout: "horizontal-eligible" | "vertical";
  gates: readonly Readonly<{
    id: string;
    title: string;
    href?: string | undefined;
    ordinal: number;
    focused: boolean;
    lifecycle?: MilestoneGate["lifecycle"] | undefined;
    efforts: readonly Readonly<{
      id: string;
      title: string;
      href?: string | undefined;
    }>[];
  }>[];
}>;

export type PlanningLineageEffortLens = Readonly<{
  lifecycle: Effort["lifecycle"];
  targetGate: Readonly<{
    title: string;
    href?: string | undefined;
  }>;
  managedWorkHealth: "Healthy" | "Needs attention";
  managedWorkObservation?:
    | Readonly<{
        state: "partial" | "stale" | "unavailable";
        indication: string;
        lastVerified?: string | undefined;
        refreshTarget?: Readonly<{ kind: "native-scope"; id: string }> | undefined;
        latestRefreshFailed?: boolean | undefined;
        latestRefreshSucceeded?: boolean | undefined;
      }>
    | undefined;
  intent: string;
  outcome?:
    | Readonly<{
        disposition: NonNullable<Effort["conclusion"]>["disposition"];
        rationale: string;
        concludedAt: SourceEventTime;
        replacementEffort?:
          | Readonly<{
              title: string;
              href?: string | undefined;
            }>
          | undefined;
      }>
    | undefined;
  currentWork?:
    | Readonly<{
        state: "available";
        items: readonly Readonly<{
          reference: string;
          title: string;
          href: string;
          status: "Claimed" | "Ready" | "Blocked" | "Needs attention";
          blockerImpact?: string | undefined;
          attention?: string | undefined;
        }>[];
        currentHref: string;
        resolvedHref: string;
        counts: Readonly<{
          total: MattNativeWorkRegionCount;
          current: MattNativeWorkRegionCount;
          resolved: MattNativeWorkRegionCount;
        }>;
        emptyState?:
          | "confirmed-no-managed-work"
          | "resolved-only"
          | "attention-without-active-work"
          | undefined;
        consistencyWarning?: string | undefined;
      }>
    | Readonly<{
        state: "unavailable";
        cause: string;
        impact: string;
        recovery: string;
      }>
    | undefined;
  planningBasis?:
    | Readonly<{
        state: "available";
        items: readonly Readonly<{
          role: "Map" | "PRD / Spec";
          title: string;
          lifecycle: string;
          href: string;
        }>[];
      }>
    | Readonly<{
        state: "attention";
        diagnostic: Readonly<{
          code: "effort.planning-basis.multiple-candidates";
          message: string;
        }>;
      }>
    | undefined;
  outputs?:
    | Readonly<{
        state: "available";
        items: readonly Readonly<{
          id: string;
          title: string;
          kind: string;
          lifecycle: string;
          href: string;
          superseded: boolean;
          times: readonly PlanningLineageTimeFact[];
        }>[];
      }>
    | Readonly<{
        state: "unavailable";
        reason: string;
      }>
    | undefined;
  governance?:
    | Readonly<{
        authorities: readonly Readonly<{
          title: string;
          href?: string | undefined;
        }>[];
        citations: readonly Readonly<{
          title: string;
          note: string;
          href?: string | undefined;
        }>[];
      }>
    | undefined;
}>;

export type PlanningLineageParentCrumb = Readonly<{
  label: string;
  href: string;
  reference?: string | undefined;
}>;

export type PlanningLineageStatusToken =
  | "position-current"
  | "lifecycle-planned"
  | "lifecycle-active"
  | "lifecycle-passed"
  | "lifecycle-completed"
  | "lifecycle-superseded"
  | "readiness-not-ready"
  | "readiness-ready-for-review"
  | "readiness-unknown"
  | "status-unknown";

export type PlanningLineageStatusTag = Readonly<{
  token: PlanningLineageStatusToken;
  label: string;
  tone: "neutral" | "active" | "positive" | "warning" | "muted";
  tooltip: string;
  diagnostic?:
    | Readonly<{
        code: "portal.status-token.unknown";
        message: string;
      }>
    | undefined;
}>;

type ReadablePlanningLineageSubjectModel = Readonly<{
  state: "available" | "partial";
  subject: Readonly<{
    kind: PlanningLineageSubject["kind"];
    id: string;
    title: string;
    source?: SourceRecord | undefined;
    sourceHref?: string | undefined;
  }>;
  parentPath: readonly PlanningLineageParentCrumb[];
  parentNotice?: string | undefined;
  headerStatuses?: readonly PlanningLineageStatusTag[] | undefined;
  primaryAction?:
    | Readonly<{
        label: string;
        href: string;
        external?: boolean | undefined;
      }>
    | undefined;
  events: readonly PlanningLineageEvent<PlanningLineageEventTime>[];
  sections: readonly PlanningLineageSection[];
  outcomeSpine?: PlanningLineageOutcomeSpine | undefined;
  effortLens?: PlanningLineageEffortLens | undefined;
  workRegion?: MattNativeWorkRegionModel | undefined;
  renderedMarkdown: NonNullable<LineageModelData["renderedMarkdown"]>;
  workHistoryOwner?:
    | Readonly<{
        title: string;
        href: string;
      }>
    | undefined;
  nativeInspection?:
    | Readonly<{
        freshness: "current" | "stale" | "undetermined";
        latestAttempt: LineageModelData["providerDetailEvidences"]["selections"][number]["latestAttempt"];
      }>
    | undefined;
  semanticAvailability: ReadonlyMap<string, MattSemanticSectionAvailability>;
  relations: readonly PlanningLineageRelation[];
}>;

export type PlanningLineageSubjectModel =
  | ReadablePlanningLineageSubjectModel
  | Readonly<{
      state: "missing";
      requested: PlanningLineageSubject;
      reason: string;
    }>
  | Readonly<{
      state: "unavailable";
      requested: PlanningLineageSubject;
      issueCount: number;
      reason: string;
    }>;

type CollectionState =
  | Readonly<{ validity: "available"; items: readonly SubjectRecord[] }>
  | Readonly<{
      validity: "partial";
      items: readonly SubjectRecord[];
      issues: readonly unknown[];
    }>
  | Readonly<{ validity: "invalid"; issues: readonly unknown[] }>;

const isNativeSubject = (subject: PlanningLineageSubject): subject is MattNativeSubject =>
  subject.kind.startsWith("native-");

type NativeObservation =
  | LineageModelData["providerObservations"][number]
  | LineageModelData["providerDetailEvidences"]["observations"][number];

const nativeObservations = (snapshot: LineageModelData): readonly NativeObservation[] => {
  const byScope = new Map(
    snapshot.providerDetailEvidences.observations.map((observation) => [
      mattNativeScopeKey(observation.binding),
      observation,
    ]),
  );
  for (const observation of snapshot.providerObservations) {
    byScope.set(mattNativeScopeKey(observation.binding), observation);
  }
  return [...byScope.values()];
};

const nativeSelections = (snapshot: LineageModelData) => {
  const byScope = new Map(
    snapshot.providerDetailEvidences.selections.map((selection) => [
      mattNativeScopeKey(selection),
      selection,
    ]),
  );
  for (const selection of snapshot.providerObservationSelections) {
    byScope.set(mattNativeScopeKey(selection), selection);
  }
  return [...byScope.values()];
};

const nativeEvidenceAssessment = (snapshot: LineageModelData, observation: NativeObservation) =>
  assessMattNativeEvidence(observation, nativeSelections(snapshot));

const hasCompleteNativeEvidence = (
  snapshot: LineageModelData,
  observation: NativeObservation,
): boolean => hasCompleteMattNativeEvidence(observation, nativeSelections(snapshot));

const providerSubjectRecords = (snapshot: LineageModelData): readonly NativeRecord[] =>
  mattNativeRecords(nativeObservations(snapshot), snapshot.sources);

const nativeCollectionFor = (
  snapshot: LineageModelData,
  kind: MattNativeSubject["kind"],
): CollectionState => {
  const records = providerSubjectRecords(snapshot).filter((record) =>
    kind === "native-scope"
      ? record.recordKind === "native-scope"
      : record.recordKind === "native-object" &&
        mattNativeSubjectForObject(record.object).kind === kind,
  );
  const observations = nativeObservations(snapshot);
  if (observations.length === 0) {
    return {
      validity: "invalid",
      issues: ["No current source evidence establishes native subject coverage."],
    };
  }
  const issues = observations.filter(
    (observation) => !hasCompleteNativeEvidence(snapshot, observation),
  );
  return issues.length === 0
    ? { validity: "available", items: records }
    : { validity: "partial", items: records, issues };
};

const collectionFor = (
  snapshot: LineageModelData,
  kind: PlanningLineageSubject["kind"],
): CollectionState => {
  switch (kind) {
    case "roadmap":
      return snapshot.roadmaps;
    case "gate":
      return snapshot.gates;
    case "effort":
      return snapshot.efforts;
    case "authority":
      return snapshot.authorities;
    case "planning-review":
      return snapshot.reviews;
    case "asset":
      return snapshot.assets;
    case "native-scope":
    case "native-subject":
      return nativeCollectionFor(snapshot, kind);
  }
};

const recordFor = (
  snapshot: LineageModelData,
  subject: PlanningLineageSubject,
): SubjectRecord | undefined => {
  const collection = collectionFor(snapshot, subject.kind);
  return collection.validity === "invalid"
    ? undefined
    : collection.items.find((candidate) => String(candidate.id) === subject.id);
};

const sourceIndex = (snapshot: LineageModelData): ReadonlyMap<string, SourceRecord> =>
  new Map(snapshot.sources.map((source) => [source.reference, source]));

const projectTitle = (snapshot: LineageModelData): string =>
  snapshot.summary.validity === "available" || snapshot.summary.validity === "partial"
    ? snapshot.summary.value.title
    : "Project";

const titleFor = (snapshot: LineageModelData, subject: PlanningLineageSubject): string =>
  recordFor(snapshot, subject)?.title ?? subject.id;

const relationItem = (
  snapshot: LineageModelData,
  entryId: string,
  owner: PlanningLineageSubject,
  relationKey: PlanningLineageRelationKey,
  target: Extract<GenerationLineageRelation, { state: "present" }>["targets"][number],
): PlanningLineageRelationItem => {
  const ownerRecord = recordFor(snapshot, owner);
  const relationEvent =
    ownerRecord === undefined || isNativeSubject(owner)
      ? undefined
      : planningLineageRelationEvent(
          snapshot,
          owner,
          ownerRecord as CanonicalSubjectRecord,
          relationKey,
          target.subject,
          target.reference,
        );
  return {
    reference: target.reference,
    label: target.label,
    availability: target.availability,
    ...(relationEvent === undefined ? {} : { event: relationEvent }),
    ...(target.subject === undefined
      ? {}
      : { href: planningLineageSubjectHref(entryId, target.subject) }),
    ...(target.note === undefined ? {} : { note: target.note }),
  };
};

const relationForDisplay = (
  snapshot: LineageModelData,
  entryId: string,
  owner: PlanningLineageSubject,
  relation: GenerationLineageRelation,
): PlanningLineageRelation => {
  const base = {
    key: relation.key,
    label: relation.label,
    direction: relation.direction,
    inParentPath: relation.inParentPath,
  };
  if (relation.state !== "present")
    return { ...base, state: relation.state, reason: relation.reason };
  const allItems = relation.targets.map((target) =>
    relationItem(snapshot, entryId, owner, relation.key, target),
  );
  return {
    ...base,
    state: "present",
    items: allItems.slice(0, RELATION_PREVIEW_LIMIT),
    allItems,
    total: relation.total,
    ...(allItems.length <= RELATION_PREVIEW_LIMIT
      ? {}
      : {
          filteredViewHref: planningLineageFilteredViewHref(entryId, owner, relation.key),
        }),
  };
};

const frontierCount = (
  region: MattNativeWorkRegionModel,
  frontier: "claimed" | "ready" | "blocked" | "resolved" | "uncertain",
): MattNativeWorkRegionCount => {
  const roles = region.roles.filter(
    (role) => role.role === "wayfinder" || role.role === "delivery",
  );
  if (roles.some((role) => role.count.mode === "unavailable")) return { mode: "unavailable" };
  const value = roles
    .flatMap((role) => role.items)
    .filter((item) => item.frontier === frontier).length;
  return roles.some((role) => role.count.mode === "at-least")
    ? { mode: "at-least", value }
    : { mode: "exact", value };
};

const unavailableFrontierCounts = (): Readonly<{
  claimed: MattNativeWorkRegionCount;
  ready: MattNativeWorkRegionCount;
  blocked: MattNativeWorkRegionCount;
  resolved: MattNativeWorkRegionCount;
}> => ({
  claimed: { mode: "unavailable" },
  ready: { mode: "unavailable" },
  blocked: { mode: "unavailable" },
  resolved: { mode: "unavailable" },
});

const lifecycleTimeForEffort = (
  effort: Effort,
): Readonly<{
  label: "Planned" | "Activated" | "Concluded";
  time: SourceEventTime;
}> => {
  if (effort.lifecycle === "planned") return { label: "Planned", time: effort.plannedAt };
  if (effort.lifecycle === "active") {
    return { label: "Activated", time: effort.activatedAt ?? { availability: "unavailable" } };
  }
  return {
    label: "Concluded",
    time: effort.conclusion?.concludedAt ?? { availability: "unavailable" },
  };
};

const contributingEffortsSection = (
  snapshot: LineageModelData,
  effortIds: readonly string[],
  entryId: string,
): PlanningLineageSectionInput => {
  const efforts = readableEfforts(snapshot);
  const effortRollup = effortIds.map((effortId) => {
    const effort = efforts.find((candidate) => candidate.id === effortId);
    if (effort === undefined) {
      return {
        id: effortId,
        title: "Unavailable contributing Effort",
        counts: unavailableFrontierCounts(),
      };
    }
    const region = effortWorkRegion(snapshot, effort);
    return {
      id: effort.id,
      title: effort.title,
      href: planningLineageSubjectHref(entryId, { kind: "effort", id: effort.id }),
      lifecycle: effort.lifecycle,
      lifecycleTime: lifecycleTimeForEffort(effort),
      counts:
        region === undefined
          ? unavailableFrontierCounts()
          : {
              claimed: frontierCount(region, "claimed"),
              ready: frontierCount(region, "ready"),
              blocked: frontierCount(region, "blocked"),
              resolved: frontierCount(region, "resolved"),
            },
    };
  });
  return {
    anchor: "native-work.effort-summaries",
    title: "Contributing Efforts",
    ...(effortRollup.length === 0
      ? {
          body: "No trustworthy contributing Effort summary is available.",
          bodySource: "system" as const,
        }
      : { effortRollup }),
  };
};

const roadmapSections = (roadmap: Roadmap): readonly PlanningLineageSectionInput[] => {
  return [{ anchor: "roadmap.intent", title: "Intent", body: roadmap.intent }];
};

const readableTitleUnits = (value: string): number =>
  [...value].reduce((total, character) => total + (/\p{Script=Han}/u.test(character) ? 2 : 1), 0);

const outcomeSpineLayout = (
  gates: readonly Readonly<{ title: string; efforts: readonly Readonly<{ title: string }>[] }>[],
): PlanningLineageOutcomeSpine["layout"] =>
  gates.length <= 4 &&
  gates.length * 220 <= 960 &&
  gates.every(
    (gate) =>
      readableTitleUnits(gate.title) <= 52 &&
      gate.efforts.every((effort) => readableTitleUnits(effort.title) <= 52),
  )
    ? "horizontal-eligible"
    : "vertical";

const roadmapOutcomeSpine = (
  snapshot: LineageModelData,
  roadmap: Roadmap,
  entryId: string,
): PlanningLineageOutcomeSpine => {
  const efforts = readableEfforts(snapshot);
  const gates = roadmap.gateOrder.map((gateId, index) => {
    const gate = recordFor(snapshot, { kind: "gate", id: gateId });
    if (gate === undefined || !("effortIds" in gate)) {
      return {
        id: gateId,
        title: "Gate unavailable",
        ordinal: index + 1,
        focused: roadmap.focusedGateId === gateId,
        efforts: [],
      };
    }
    const milestone = gate as MilestoneGate;
    return {
      id: milestone.id,
      title: milestone.title,
      href: planningLineageSubjectHref(entryId, { kind: "gate", id: milestone.id }),
      ordinal: index + 1,
      focused: roadmap.focusedGateId === milestone.id,
      lifecycle: milestone.lifecycle,
      efforts: milestone.effortIds.map((effortId) => {
        const effort = efforts.find((candidate) => candidate.id === effortId);
        return effort === undefined
          ? { id: effortId, title: "Effort unavailable" }
          : {
              id: effort.id,
              title: effort.title,
              href: planningLineageSubjectHref(entryId, { kind: "effort", id: effort.id }),
            };
      }),
    };
  });
  return { layout: outcomeSpineLayout(gates), gates };
};

const gateSections = (
  snapshot: LineageModelData,
  gate: MilestoneGate,
  entryId: string,
): readonly PlanningLineageSectionInput[] => [
  { anchor: "gate.intent", title: "Intent", body: gate.intent },
  { anchor: "gate.exit-criteria", title: "Exit Criteria", items: gate.exitCriteria },
  {
    anchor: "gate.passage",
    title: "Passage",
    ...(gate.passage === undefined
      ? { body: "No Gate Passage is recorded.", bodySource: "system" as const }
      : {
          facts: [
            {
              key: "accepted-decision",
              label: "Accepted decision",
              value: gate.passage.acceptedDecision,
            },
            { key: "rationale", label: "Rationale", value: gate.passage.rationale },
            ...gate.passage.evidence.flatMap((entry, index) => [
              {
                key: `evidence-${index + 1}-source`,
                label: `Evidence ${index + 1}`,
                value: entry.locator,
              },
              {
                key: `evidence-${index + 1}-relevance`,
                label: "Relevance",
                value: entry.relevance,
              },
            ]),
            ...gate.passage.exceptions.map((exception, index) => ({
              key: `exception-${index + 1}`,
              label: `Exception ${index + 1}`,
              value: exception,
            })),
          ],
        }),
  },
  contributingEffortsSection(snapshot, gate.effortIds, entryId),
];

const STATUS_TAGS = {
  "position-current": {
    label: "Current",
    tone: "neutral",
    tooltip: "This is the Roadmap’s current Milestone Gate.",
  },
  "lifecycle-planned": {
    label: "Planned",
    tone: "neutral",
    tooltip: "This lifecycle is planned and has not started.",
  },
  "lifecycle-active": {
    label: "Active",
    tone: "active",
    tooltip: "This lifecycle is active.",
  },
  "lifecycle-passed": {
    label: "Passed",
    tone: "positive",
    tooltip: "Gate Passage is recorded for this Milestone Gate.",
  },
  "lifecycle-completed": {
    label: "Completed",
    tone: "muted",
    tooltip: "This lifecycle is completed.",
  },
  "lifecycle-superseded": {
    label: "Superseded",
    tone: "muted",
    tooltip: "This lifecycle has been superseded.",
  },
  "readiness-not-ready": {
    label: "Not ready for passage",
    tone: "warning",
    tooltip: "Current evidence does not establish readiness for human Gate Passage review.",
  },
  "readiness-ready-for-review": {
    label: "Ready for review",
    tone: "positive",
    tooltip: "This Milestone Gate is ready for human review; Gate Passage is not automatic.",
  },
  "readiness-unknown": {
    label: "Readiness unknown",
    tone: "muted",
    tooltip: "Current evidence cannot establish Gate readiness.",
  },
  "status-unknown": {
    label: "Status unavailable",
    tone: "muted",
    tooltip: "This status token is not supported by this Portal version.",
  },
} as const satisfies Record<PlanningLineageStatusToken, Omit<PlanningLineageStatusTag, "token">>;

export const resolvePlanningLineageStatusTag = (token: string): PlanningLineageStatusTag => {
  if (!Object.hasOwn(STATUS_TAGS, token)) {
    return {
      token: "status-unknown",
      ...STATUS_TAGS["status-unknown"],
      diagnostic: {
        code: "portal.status-token.unknown",
        message: `Unsupported Portal status token: ${token}`,
      },
    };
  }
  const knownToken = token as PlanningLineageStatusToken;
  return { token: knownToken, ...STATUS_TAGS[knownToken] };
};

const statusTag = resolvePlanningLineageStatusTag;

const headerStatusesFor = (
  record: SubjectRecord,
  subject: PlanningLineageSubject,
): readonly PlanningLineageStatusTag[] | undefined => {
  if (subject.kind === "roadmap") {
    return [statusTag(`lifecycle-${(record as Roadmap).lifecycle}`)];
  }
  if (subject.kind !== "gate") return undefined;
  const gate = record as MilestoneGate;
  return [
    ...(gate.horizonState === "focused" ? [statusTag("position-current")] : []),
    statusTag(`lifecycle-${gate.lifecycle}`),
    ...(gate.lifecycle === "active" ? [statusTag(`readiness-${gate.readiness}`)] : []),
  ];
};

const authoritySections = (
  snapshot: LineageModelData,
  authority: Authority,
  entryId: string,
): readonly PlanningLineageSectionInput[] => [
  { anchor: "authority.scope", title: "Scope", body: authority.scope },
  {
    anchor: "authority.baseline",
    title: "Current Baseline",
    body:
      authority.baselineAssetIds.length === 0
        ? "No baseline Assets are declared."
        : "The following Assets form the current baseline.",
    bodySource: "system",
    ...(authority.baselineAssetIds.length === 0
      ? {}
      : {
          links: authority.baselineAssetIds.map((assetId) => {
            const asset =
              snapshot.assets.validity === "invalid"
                ? undefined
                : snapshot.assets.items.find((candidate) => candidate.id === assetId);
            return asset === undefined
              ? {
                  label: assetId,
                  detail: "Unavailable",
                  availability: "unavailable" as const,
                }
              : {
                  label: assetId,
                  href: planningLineageSubjectHref(entryId, { kind: "asset", id: asset.id }),
                  availability: "available" as const,
                };
          }),
        }),
  },
];

const resolutionSections = (
  prefix: "planning-review",
  status: string,
  pendingContext: string,
  resolution:
    | Readonly<{
        acceptedDecision: string;
        rationale: string;
        changedReferences: readonly string[];
      }>
    | undefined,
  citationCount: number,
): readonly PlanningLineageSectionInput[] => {
  const changedReferences = resolution?.changedReferences ?? [];
  return [
    {
      anchor: `${prefix}.lifecycle`,
      title: "Lifecycle",
      facts: [{ key: "status", label: "Status", value: status }],
    },
    {
      anchor: `${prefix}.resolution`,
      title: resolution === undefined ? "Open Context" : "Accepted Resolution",
      body: resolution?.acceptedDecision ?? pendingContext,
    },
    {
      anchor: `${prefix}.rationale`,
      title: "Rationale",
      body: resolution?.rationale ?? "No accepted rationale is recorded.",
      ...(resolution === undefined ? { bodySource: "system" as const } : {}),
    },
    {
      anchor: `${prefix}.changed-references`,
      title: "Changed References",
      body:
        changedReferences.length === 0
          ? "No accepted changed references are recorded."
          : "Accepted resolution changed the following references.",
      bodySource: "system",
      ...(changedReferences.length === 0 ? {} : { items: changedReferences }),
    },
    {
      anchor: `${prefix}.evidence`,
      title: "Supporting Evidence",
      body:
        citationCount === 0
          ? "No supporting Planning Citations are recorded."
          : `${citationCount} supporting Planning Citation${citationCount === 1 ? "" : "s"} recorded.`,
      bodySource: "system",
    },
  ];
};

const planningReviewSections = (review: PlanningReview): readonly PlanningLineageSectionInput[] => [
  { anchor: "planning-review.question", title: "Question", body: review.question },
  {
    anchor: "planning-review.scope",
    title: "Scope",
    facts: [
      {
        key: "scope",
        label: "Scope",
        value: review.scope.kind === "project" ? "Whole project" : review.scope.target,
      },
    ],
  },
  ...resolutionSections(
    "planning-review",
    review.status,
    review.title,
    review.resolution,
    review.citations.length,
  ),
];

const assetSections = (
  snapshot: LineageModelData,
  asset: AssetProjection,
  entryId: string,
  lineage: PlanningLineageSubjectProjection,
): readonly PlanningLineageSectionInput[] => {
  const ownerTitle = semanticTitleForPlanningReference(snapshot, asset.owner);
  const relationTarget = (key: "production.owner") => {
    const relation = lineage.relations.find((candidate) => candidate.key === key);
    return relation?.state === "present" ? relation.targets[0] : undefined;
  };
  const objectTypeLabel = (subject: PlanningLineageSubject | undefined): string | undefined => {
    if (subject === undefined) return undefined;
    switch (subject.kind) {
      case "roadmap":
        return "Roadmap";
      case "gate":
        return "Gate";
      case "effort":
        return "Effort";
      case "authority":
        return "Authority";
      case "planning-review":
        return "Planning Review";
      case "asset":
        return "Asset";
      case "native-scope":
        return "Native Scope";
      case "native-subject": {
        const record = mattNativeRecords(snapshot.providerObservations, snapshot.sources).find(
          (candidate) => candidate.recordKind === "native-object" && candidate.id === subject.id,
        );
        if (record?.recordKind !== "native-object") return "Native Work";
        switch (record.object.kind) {
          case "map":
            return "Map";
          case "spec":
            return "Spec";
          case "wayfinder-ticket":
          case "delivery-ticket":
            return "Ticket";
          case "incoming-issue":
            return "Issue";
        }
      }
    }
  };
  const relationLink = (key: "production.owner", label: string, title: string) => {
    const target = relationTarget(key);
    return target?.availability !== "available" || target.subject === undefined
      ? undefined
      : {
          prefix: `${label}: ${objectTypeLabel(target.subject) ?? "Object"}: `,
          label: title,
          href: planningLineageSubjectHref(entryId, target.subject),
        };
  };
  const ownerLink = relationLink("production.owner", "Owner", ownerTitle);
  return [
    {
      anchor: "asset.identity",
      title: "Asset Identity",
      body: asset.purpose,
      facts: [{ key: "kind", label: "Kind", value: asset.kind }],
    },
    {
      anchor: "asset.ownership",
      title: "Ownership and Purpose",
      links: [ownerLink].filter((link): link is NonNullable<typeof link> => link !== undefined),
      ...(ownerLink === undefined
        ? {
            facts: [
              {
                key: "owner-type",
                label: "Owner type",
                value:
                  objectTypeLabel(relationTarget("production.owner")?.subject) ?? "Unavailable",
              },
              { key: "owner", label: "Owner", value: ownerTitle },
            ],
          }
        : {}),
    },
    {
      anchor: "asset.lifecycle",
      title: "Lifecycle",
      facts: [{ key: "lifecycle", label: "Lifecycle", value: asset.disposition }],
      ...(asset.supersededBy === undefined
        ? {}
        : { items: [`Replacement: ${asset.supersededBy}`] }),
    },
    {
      anchor: "asset.source",
      title: "Source",
      body: "Source availability is observation evidence; it does not change the canonical locator.",
      bodySource: "system",
      facts: [
        { key: "locator", label: "Locator", value: asset.sourceLocator },
        {
          key: "source-kind",
          label: "Source kind",
          value: snapshot.assetSourceProbe?.kind ?? "unavailable",
        },
        {
          key: "availability",
          label: "Availability",
          value:
            snapshot.assetSourceProbe?.kind === "local"
              ? snapshot.assetSourceProbe.availability
              : snapshot.assetSourceProbe?.kind === "external"
                ? "not verified"
                : "unavailable",
        },
      ],
    },
    {
      anchor: "asset.evidence",
      title: "Planning Use",
      facts: [
        { key: "citations", label: "Planning Citations", value: String(asset.citations.length) },
        {
          key: "authority-baselines",
          label: "Authority baselines",
          value: String(asset.authorityBaselines.length),
        },
      ],
    },
  ];
};

const nativeSemanticAvailability = (
  object: MattProjectedObject,
  role: string,
): MattSemanticSectionAvailability =>
  object.semanticSections.find((section) => section.role === role)?.availability ?? "unavailable";

const nativeSemanticSection = (
  object: MattProjectedObject,
  input: Readonly<{
    role: string;
    title: string;
    body?: string | undefined;
    bodySource?: "canonical" | "system" | undefined;
    providerDocument?: PlanningLineageProviderDocument | undefined;
    facts?: readonly PlanningLineageFact[] | undefined;
    providerDocuments?: PlanningLineageSectionInput["providerDocuments"];
    items?: readonly string[] | undefined;
    times?: readonly PlanningLineageTimeFact[] | undefined;
    emptyCopy: string;
    unavailableBody?: string | undefined;
  }>,
): PlanningLineageSectionInput => {
  const availability = nativeSemanticAvailability(object, input.role);
  if (availability === "confirmed-empty") {
    return {
      anchor: input.role,
      title: input.title,
      body: input.emptyCopy,
      bodySource: "system",
    };
  }
  if (availability === "unavailable") {
    return {
      anchor: input.role,
      title: input.title,
      body:
        input.unavailableBody ?? "This semantic section is unavailable in the current source data.",
      bodySource: "system",
      ...(input.providerDocument === undefined ? {} : { providerDocument: input.providerDocument }),
      ...(input.facts === undefined ? {} : { facts: input.facts }),
      ...(input.providerDocuments === undefined
        ? {}
        : { providerDocuments: input.providerDocuments }),
      ...(input.items === undefined ? {} : { items: input.items }),
      ...(input.times === undefined ? {} : { times: input.times }),
    };
  }
  if (availability === "unsupported") {
    return {
      anchor: input.role,
      title: input.title,
      body: "The current source does not support the requested semantic section.",
      bodySource: "system",
      ...(input.providerDocument === undefined ? {} : { providerDocument: input.providerDocument }),
      ...(input.facts === undefined ? {} : { facts: input.facts }),
      ...(input.providerDocuments === undefined
        ? {}
        : { providerDocuments: input.providerDocuments }),
      ...(input.times === undefined ? {} : { times: input.times }),
    };
  }
  return {
    anchor: input.role,
    title: input.title,
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.bodySource === undefined ? {} : { bodySource: input.bodySource }),
    ...(input.providerDocument === undefined ? {} : { providerDocument: input.providerDocument }),
    ...(input.facts === undefined ? {} : { facts: input.facts }),
    ...(input.providerDocuments === undefined
      ? {}
      : { providerDocuments: input.providerDocuments }),
    ...(input.items === undefined ? {} : { items: input.items }),
    ...(input.times === undefined ? {} : { times: input.times }),
  };
};

const sourceAnchorLabel = (anchor: Readonly<{ kind: string; target: string }>): string =>
  `${anchor.kind}: ${anchor.target}`;

const renderedProviderSection = (snapshot: LineageModelData, section: ProviderSemanticSection) => {
  const identity = {
    version: section.version,
    sourceIdentity: section.sourceIdentity,
    title: section.title,
    sourceOrder: section.sourceOrder,
  };
  if (section.availability !== "available") {
    return { ...identity, availability: section.availability };
  }
  const rendered = snapshot.renderedMarkdown?.find((entry) => entry.markdown === section.markdown);
  if (rendered === undefined) {
    return { ...identity, availability: section.availability, markdown: section.markdown };
  }
  return {
    ...identity,
    availability: section.availability,
    html: rendered.html,
    presentation: rendered.presentation,
  };
};

const providerDocumentSection = (
  snapshot: LineageModelData,
  document: readonly ProviderSemanticSection[],
  semanticRole: string,
  key = semanticRole,
): PlanningLineageProviderDocument | undefined => {
  const section = document.find((candidate) => candidate.semanticRole === semanticRole);
  return section === undefined
    ? undefined
    : {
        key,
        showSectionTitles: false,
        sections: [renderedProviderSection(snapshot, section)],
        provenance: { facts: [], times: [] },
      };
};

const providerDocumentSourceSection = (
  snapshot: LineageModelData,
  document: readonly ProviderSemanticSection[],
  sourceIdentity: string,
  key: string,
): PlanningLineageProviderDocument => {
  const section = document.find((candidate) => candidate.sourceIdentity === sourceIdentity);
  return {
    key,
    showSectionTitles: false,
    sections: section === undefined ? [] : [renderedProviderSection(snapshot, section)],
    provenance: { facts: [], times: [] },
  };
};

const additiveDocumentSections = (
  snapshot: LineageModelData,
  document: readonly ProviderSemanticSection[],
  anchorPrefix: string,
): readonly PlanningLineageSectionInput[] =>
  document
    .filter((section) => section.semanticRole === undefined)
    .map((section) => ({
      anchor: `${anchorPrefix}.additional.${section.sourceOrder}`,
      title: section.title,
      providerDocument: providerDocumentSourceSection(
        snapshot,
        document,
        section.sourceIdentity,
        `${anchorPrefix}.additional.${section.sourceOrder}`,
      ),
    }));

const nativeTrustSections = (
  snapshot: LineageModelData,
  record: NativeRecord,
): readonly PlanningLineageSectionInput[] => {
  const observation = record.observation;
  const evidence = nativeEvidenceAssessment(snapshot, observation);
  const object = record.recordKind === "native-object" ? record.object : undefined;
  const provenance =
    object === undefined
      ? observation.binding.nativeScope
      : object.native.kind === "local"
        ? object.native.identity.locator
        : `${object.native.identity.owner}/${object.native.identity.repository} ${object.native.identity.objectKind} #${object.native.identity.number}`;
  return [
    {
      anchor: "native.observation-trust",
      title: "Observation Trust",
      body: "Current means verified at the recorded observation against the confirmed source revision; it does not promise live currency.",
      bodySource: "system",
      facts: [
        { key: "projection", label: "Projection", value: observation.state },
        { key: "freshness", label: "Freshness", value: evidence.freshness },
        { key: "coverage", label: "Coverage", value: observation.coverage.assessment },
        { key: "completion", label: "Completion", value: observation.completion },
        {
          key: "selected-evidence",
          label: "Selected evidence",
          value: evidence.frontierEvidence,
        },
      ],
      times: [
        {
          key: `observation:${observation.id}:verified-at`,
          label: "Verified at",
          time: projectExpectedSourceEventTime(observation.observedAt),
          mode: "compact",
        },
      ],
    },
    {
      anchor: "native.provenance",
      title: "Native Provenance",
      facts: [{ key: "source", label: "Source", value: provenance }],
      ...(object === undefined
        ? {}
        : {
            times: [
              { key: "native-created", label: "Created", time: object.native.createdAt },
              {
                key: "native-last-updated",
                label: "Updated",
                time: object.native.lastUpdated,
              },
            ],
          }),
    },
  ];
};

const mapSections = (
  snapshot: LineageModelData,
  map: MattMap,
): readonly PlanningLineageSectionInput[] => [
  nativeSemanticSection(map, {
    role: "map.destination",
    title: "Destination",
    providerDocument: providerDocumentSection(snapshot, map.destination, "map.destination"),
    emptyCopy: "No Destination is declared.",
  }),
  ...additiveDocumentSections(snapshot, map.destination, "map.destination"),
  {
    anchor: "map.lifecycle",
    title: "Map Lifecycle",
    facts: [{ key: "lifecycle", label: "Lifecycle", value: map.lifecycle.state }],
  },
  nativeSemanticSection(map, {
    role: "map.fog",
    title: "Fog",
    items: map.fog,
    emptyCopy: "No fog is recorded.",
  }),
  nativeSemanticSection(map, {
    role: "map.decisions",
    title: "Decisions",
    facts: map.decisions.flatMap((decision, index) => [
      { key: `decision-${index + 1}`, label: `Decision ${index + 1}`, value: decision.gist },
      ...(decision.ticket === undefined
        ? []
        : [{ key: `decision-${index + 1}-ticket`, label: "Ticket", value: decision.ticket }]),
      {
        key: `decision-${index + 1}-source`,
        label: "Source anchor",
        value: sourceAnchorLabel(decision.sourceAnchor),
      },
    ]),
    emptyCopy: "No decisions are recorded.",
  }),
  nativeSemanticSection(map, {
    role: "map.out-of-scope",
    title: "Out of Scope",
    facts: map.outOfScope.flatMap((entry, index) => [
      {
        key: `disposition-${index + 1}`,
        label: `Disposition ${index + 1}`,
        value: entry.rationale,
      },
      ...(entry.ticket === undefined
        ? []
        : [{ key: `disposition-${index + 1}-ticket`, label: "Ticket", value: entry.ticket }]),
      {
        key: `disposition-${index + 1}-source`,
        label: "Source anchor",
        value: sourceAnchorLabel(entry.sourceAnchor),
      },
    ]),
    emptyCopy: "No out-of-scope dispositions are recorded.",
  }),
  nativeSemanticSection(map, {
    role: "map.notes",
    title: "Notes",
    items: map.notes,
    emptyCopy: "No notes are recorded.",
  }),
  nativeSemanticSection(map, {
    role: "map.resolution-evidence",
    title: "Resolution Evidence",
    items:
      map.lifecycle.state === "resolved"
        ? map.lifecycle.resolutionEvidence.map(sourceAnchorLabel)
        : undefined,
    emptyCopy: "No Map resolution evidence is recorded.",
  }),
];

const specSections = (
  snapshot: LineageModelData,
  spec: MattSpec,
): readonly PlanningLineageSectionInput[] => [
  {
    anchor: "spec.lifecycle",
    title: "Spec Lifecycle",
    facts: [{ key: "lifecycle", label: "Lifecycle", value: spec.lifecycle.state }],
  },
  ...spec.document.map((section) => ({
    anchor: section.semanticRole ?? section.sourceIdentity,
    title: section.title,
    providerDocument: providerDocumentSourceSection(
      snapshot,
      spec.document,
      section.sourceIdentity,
      section.semanticRole ?? section.sourceIdentity,
    ),
  })),
];

const trackerClosureFacts = (
  closure: MattWayfinderTicket["trackerClosure"] | MattDeliveryTicket["trackerClosure"],
): Readonly<{
  facts: readonly PlanningLineageFact[];
  times?: readonly PlanningLineageTimeFact[] | undefined;
}> =>
  closure.state === "open"
    ? { facts: [{ key: "tracker-closure", label: "Tracker closure", value: "open" }] }
    : {
        facts: [
          { key: "tracker-closure", label: "Tracker closure", value: "closed" },
          { key: "closure-disposition", label: "Disposition", value: closure.disposition },
          ...(closure.actor === undefined
            ? []
            : [{ key: "closure-actor", label: "Closure actor", value: closure.actor }]),
        ],
        times: [{ key: "tracker-closed", label: "Tracker closed", time: closure.closedAt }],
      };

const contentTimeFacts = (
  content: readonly Readonly<{
    role: string;
    nativeIdentity?: string | undefined;
    author?: string | undefined;
    authoredAt?: MattNativeEventTime | undefined;
  }>[],
  positionOffset = 0,
): readonly PlanningLineageTimeFact[] =>
  content.flatMap((entry, index) =>
    entry.authoredAt === undefined
      ? []
      : [
          {
            key: `content-authored:${entry.nativeIdentity ?? index}`,
            label: `${
              entry.role === "answer"
                ? "Answer"
                : entry.role === "issue-body"
                  ? "Issue body"
                  : entry.role === "triage-note"
                    ? "Triage note"
                    : entry.role === "agent-brief"
                      ? "Agent brief"
                      : "Comment"
            } authored${entry.author === undefined ? "" : ` by ${entry.author}`}`,
            time: entry.authoredAt,
            detail: `Native content position ${positionOffset + index + 1}; event time does not reorder content.`,
          },
        ],
  );

const providerDocumentViews = (
  snapshot: LineageModelData,
  documents: readonly MattProviderAuthoredDocument[],
): NonNullable<PlanningLineageSectionInput["providerDocuments"]> =>
  documents.map((document, index) => ({
    key: document.nativeIdentity ?? `${document.role}-${index + 1}`,
    showSectionTitles: true,
    sections: document.document.map((section) => renderedProviderSection(snapshot, section)),
    provenance: {
      facts: [
        { key: "role", label: "Role", value: document.role },
        ...(document.author === undefined
          ? []
          : [{ key: "author", label: "Actor", value: document.author }]),
        ...(document.sourceAnchor === undefined
          ? []
          : [
              {
                key: "source-anchor",
                label: "Source anchor",
                value: sourceAnchorLabel(document.sourceAnchor),
              },
            ]),
        ...(document.nativeIdentity === undefined
          ? []
          : [
              {
                key: "native-identity",
                label: "Native identity",
                value: document.nativeIdentity,
              },
            ]),
      ],
      times: contentTimeFacts([document], index),
    },
  }));

const wayfinderSections = (
  snapshot: LineageModelData,
  ticket: MattWayfinderTicket,
): readonly PlanningLineageSectionInput[] => [
  nativeSemanticSection(ticket, {
    role: "wayfinder.question",
    title: "Question",
    providerDocument: providerDocumentSection(snapshot, ticket.question, "wayfinder.question"),
    emptyCopy: "No Question is recorded.",
  }),
  ...additiveDocumentSections(snapshot, ticket.question, "wayfinder.question"),
  {
    anchor: "wayfinder.lifecycle",
    title: "Lifecycle and Subtype",
    facts: [
      { key: "lifecycle", label: "Lifecycle", value: ticket.lifecycle.state },
      { key: "subtype", label: "Subtype", value: ticket.subtype },
      ...trackerClosureFacts(ticket.trackerClosure).facts,
    ],
    ...(trackerClosureFacts(ticket.trackerClosure).times === undefined
      ? {}
      : { times: trackerClosureFacts(ticket.trackerClosure).times }),
  },
  nativeSemanticSection(ticket, {
    role: "wayfinder.claim",
    title: "Claim",
    facts: [
      { key: "state", label: "State", value: ticket.claim.state },
      ...(ticket.claim.state !== "claimed" || ticket.claim.claimant === undefined
        ? []
        : [{ key: "claimant", label: "Claimant", value: ticket.claim.claimant }]),
      ...(ticket.claim.state === "claimed" && ticket.claim.claimantAmbiguous === true
        ? [{ key: "claimant-trust", label: "Claimant trust", value: "ambiguous" }]
        : []),
    ],
    emptyCopy: "No claim is recorded.",
  }),
  nativeSemanticSection(ticket, {
    role: "wayfinder.answer",
    title: "Answer",
    body:
      ticket.answer.availability === "available"
        ? undefined
        : `Answer unavailable: ${ticket.answer.reason}.`,
    bodySource: "system",
    providerDocument:
      ticket.answer.availability === "available"
        ? providerDocumentSection(snapshot, ticket.answer.content.document, "wayfinder.answer")
        : providerDocumentSection(snapshot, ticket.answer.document ?? [], "wayfinder.answer"),
    facts:
      ticket.answer.availability === "available"
        ? [
            { key: "answer-role", label: "Role", value: ticket.answer.content.role },
            ...(ticket.answer.content.author === undefined
              ? []
              : [
                  {
                    key: "answer-author",
                    label: "Actor",
                    value: ticket.answer.content.author,
                  },
                ]),
            ...(ticket.answer.content.sourceAnchor === undefined
              ? []
              : [
                  {
                    key: "answer-source-anchor",
                    label: "Source anchor",
                    value: sourceAnchorLabel(ticket.answer.content.sourceAnchor),
                  },
                ]),
            ...(ticket.answer.content.nativeIdentity === undefined
              ? []
              : [
                  {
                    key: "answer-native-identity",
                    label: "Native identity",
                    value: ticket.answer.content.nativeIdentity,
                  },
                ]),
          ]
        : undefined,
    ...(ticket.answer.availability === "available" && ticket.answer.content.authoredAt !== undefined
      ? {
          times: [
            {
              key: "answer-authored",
              label: "Answer authored",
              time: ticket.answer.content.authoredAt,
              detail: "Established only from the uniquely referenced native Answer content.",
            },
          ],
        }
      : {}),
    emptyCopy: "No Answer has been authored.",
  }),
  ...(ticket.answer.availability === "available"
    ? additiveDocumentSections(snapshot, ticket.answer.content.document, "wayfinder.answer")
    : []),
  nativeSemanticSection(ticket, {
    role: "wayfinder.comments",
    title: "Comments",
    providerDocuments: providerDocumentViews(snapshot, ticket.comments),
    providerDocument: providerDocumentSection(
      snapshot,
      ticket.commentsDocument ?? [],
      "wayfinder.comments",
    ),
    emptyCopy: "No comments are recorded.",
  }),
  ...(ticket.lifecycle.state === "resolved-on-route"
    ? [
        {
          anchor: "wayfinder.decision-backlink",
          title: "Decision Backlink",
          facts: [
            {
              key: "source-anchor",
              label: "Source anchor",
              value: sourceAnchorLabel(ticket.lifecycle.decisionSource),
            },
          ],
        },
      ]
    : ticket.lifecycle.state === "ruled-out-of-scope"
      ? [
          {
            anchor: "wayfinder.disposition-backlink",
            title: "Disposition Backlink",
            facts: [
              {
                key: "source-anchor",
                label: "Source anchor",
                value: sourceAnchorLabel(ticket.lifecycle.dispositionSource),
              },
            ],
          },
        ]
      : []),
];

const deliverySections = (
  snapshot: LineageModelData,
  ticket: MattDeliveryTicket,
): readonly PlanningLineageSectionInput[] => [
  nativeSemanticSection(ticket, {
    role: "delivery.what-to-build",
    title: "What to Build",
    body: ticket.whatToBuild,
    emptyCopy: "No delivery brief is recorded.",
  }),
  nativeSemanticSection(ticket, {
    role: "delivery.acceptance-criteria",
    title: "Acceptance Criteria",
    items: ticket.acceptanceCriteria,
    emptyCopy: "No Acceptance Criteria are recorded.",
  }),
  {
    anchor: "delivery.lifecycle",
    title: "Delivery Lifecycle",
    facts: [
      { key: "lifecycle", label: "Lifecycle", value: ticket.lifecycle.state },
      ...trackerClosureFacts(ticket.trackerClosure).facts,
    ],
    ...(trackerClosureFacts(ticket.trackerClosure).times === undefined
      ? {}
      : { times: trackerClosureFacts(ticket.trackerClosure).times }),
  },
  nativeSemanticSection(ticket, {
    role: "delivery.completion-evidence",
    title: "Completion Evidence",
    items:
      ticket.lifecycle.state === "completed"
        ? ticket.lifecycle.evidence
        : ticket.lifecycle.state === "completion-unavailable"
          ? [`Completion unavailable: ${ticket.lifecycle.reason}`]
          : undefined,
    emptyCopy: "No completion evidence is recorded.",
  }),
  nativeSemanticSection(ticket, {
    role: "delivery.comments",
    title: "Comments",
    providerDocuments: providerDocumentViews(snapshot, ticket.comments),
    providerDocument: providerDocumentSection(
      snapshot,
      ticket.commentsDocument ?? [],
      "delivery.comments",
    ),
    emptyCopy: "No comments are recorded.",
  }),
];

const incomingSections = (
  snapshot: LineageModelData,
  issue: MattIncomingIssue,
): readonly PlanningLineageSectionInput[] => [
  nativeSemanticSection(issue, {
    role: "incoming.classification",
    title: "Classification",
    facts: [
      { key: "category", label: "Category", value: issue.classification.category },
      { key: "state", label: "State", value: issue.classification.state },
      ...(issue.classification.nativeCategory === undefined
        ? []
        : [
            {
              key: "native-category",
              label: "Native category",
              value: issue.classification.nativeCategory,
            },
          ]),
      ...(issue.classification.nativeState === undefined
        ? []
        : [
            {
              key: "native-state",
              label: "Native state",
              value: issue.classification.nativeState,
            },
          ]),
    ],
    emptyCopy: "No classification is recorded.",
    unavailableBody: `Classification remains ${issue.classification.category} · ${issue.classification.state}; the provider could not establish one unambiguous mapped classification.`,
  }),
  nativeSemanticSection(issue, {
    role: "incoming.routing",
    title: "Routing",
    facts: [{ key: "routing", label: "Routing", value: issue.classification.state }],
    emptyCopy: "No routing state is recorded.",
    unavailableBody: `Routing remains ${issue.classification.state}; it is not coerced to needs-triage.`,
  }),
  {
    anchor: "incoming.lifecycle",
    title: "Native Lifecycle",
    facts: [
      { key: "state", label: "State", value: issue.lifecycle.state },
      ...(issue.lifecycle.state === "open"
        ? []
        : [{ key: "disposition", label: "Disposition", value: issue.lifecycle.disposition }]),
    ],
    ...(issue.lifecycle.state === "open"
      ? {}
      : {
          times: [
            {
              key: "tracker-closed",
              label: "Tracker closed",
              time: issue.lifecycle.closedAt,
            },
          ],
        }),
  },
  nativeSemanticSection(issue, {
    role: "incoming.content",
    title: "Issue Content and Triage Notes",
    providerDocuments: providerDocumentViews(snapshot, issue.content),
    providerDocument: providerDocumentSection(
      snapshot,
      issue.commentsDocument ?? [],
      "incoming.content",
    ),
    emptyCopy: "No issue content or triage notes are recorded.",
  }),
];

const nativeSections = (
  snapshot: LineageModelData,
  record: NativeRecord,
): readonly PlanningLineageSectionInput[] => {
  if (record.recordKind === "native-scope") return [];
  const objectSections = (() => {
    switch (record.object.kind) {
      case "map":
        return mapSections(snapshot, record.object);
      case "spec":
        return specSections(snapshot, record.object);
      case "wayfinder-ticket":
        return wayfinderSections(snapshot, record.object);
      case "delivery-ticket":
        return deliverySections(snapshot, record.object);
      case "incoming-issue":
        return incomingSections(snapshot, record.object);
    }
  })();
  return [...objectSections, ...nativeTrustSections(snapshot, record)];
};

export const nativeLifecycleEventsFor = (
  object: MattProjectedObject,
): readonly PlanningLineageEvent<PlanningLineageEventTime>[] => {
  const closure =
    (object.native.kind === "github" && object.native.trackerClosure.state === "closed"
      ? object.native.trackerClosure.closedAt
      : undefined) ??
    (object.kind === "wayfinder-ticket" || object.kind === "delivery-ticket"
      ? object.trackerClosure.state === "closed"
        ? object.trackerClosure.closedAt
        : undefined
      : object.kind === "incoming-issue" && object.lifecycle.state === "closed"
        ? object.lifecycle.closedAt
        : undefined);
  return [
    { role: "native.created", label: "Created", time: object.native.createdAt },
    ...(closure === undefined
      ? []
      : [{ role: "native.tracker-closed", label: "Tracker closed", time: closure }]),
  ];
};

const nativeLifecycleEvents = (
  record: NativeRecord,
): readonly PlanningLineageEvent<PlanningLineageEventTime>[] =>
  record.recordKind === "native-object" ? nativeLifecycleEventsFor(record.object) : [];

const nativeSourceHref = (record: NativeRecord): string | undefined => {
  if (record.recordKind !== "native-object" || record.object.native.kind !== "github") {
    return undefined;
  }
  return record.object.native.identity.url;
};

const sectionsFor = (
  snapshot: LineageModelData,
  lineage: PlanningLineageSubjectProjection,
  record: SubjectRecord,
  entryId: string,
): readonly PlanningLineageSection[] => {
  const inputs: readonly PlanningLineageSectionInput[] = (() => {
    switch (lineage.identity.kind) {
      case "roadmap":
        return roadmapSections(record as Roadmap);
      case "gate":
        return gateSections(snapshot, record as MilestoneGate, entryId);
      case "effort":
        return [];
      case "authority":
        return authoritySections(snapshot, record as Authority, entryId);
      case "planning-review":
        return planningReviewSections(record as PlanningReview);
      case "asset":
        return assetSections(snapshot, record as AssetProjection, entryId, lineage);
      case "native-scope":
      case "native-subject":
        return nativeSections(snapshot, record as NativeRecord);
    }
  })();
  return inputs.map(planningLineageSection);
};

const parentPathForDisplay = (
  snapshot: LineageModelData,
  entryId: string,
  lineage: PlanningLineageSubjectProjection,
): readonly PlanningLineageParentCrumb[] => {
  const project = {
    label: projectTitle(snapshot),
    href: `/projects/${encodeURIComponent(entryId)}`,
  };
  const collection =
    lineage.identity.kind === "asset"
      ? [
          {
            label: "Assets",
            href: `/projects/${encodeURIComponent(entryId)}/assets`,
          },
        ]
      : [];
  const ancestors = lineage.parentPath.ancestors.map((ancestor) => ({
    label: titleFor(snapshot, ancestor),
    href: planningLineageSubjectHref(entryId, ancestor),
    reference: ancestor.id,
  }));
  return [project, ...collection, ...ancestors];
};

const readableEfforts = (snapshot: LineageModelData): readonly Effort[] =>
  snapshot.efforts.validity === "invalid" ? [] : snapshot.efforts.items;

const scopeContextFor = (
  snapshot: LineageModelData,
  observation: NativeObservation,
): MattNativeWorkRegionContext | undefined =>
  mattNativeWorkReadingContextForScope(readableEfforts(snapshot), observation);

const effortWorkRegion = (
  snapshot: LineageModelData,
  effort: Effort,
  readingState?: MattNativeWorkReadingState | undefined,
): MattNativeWorkRegionModel | undefined => {
  if (effort.workBindingState.state !== "bound") return undefined;
  const binding = effort.workBinding;
  if (binding === undefined) throw new TypeError("Bound Effort requires its Work Binding.");
  const observation =
    snapshot.providerObservations.find((candidate) =>
      sameMattNativeScope(candidate.binding, binding),
    ) ??
    snapshot.providerObservations.find((candidate) =>
      sameMattNativeLocator(candidate.binding, binding),
    );
  const context = mattNativeWorkReadingContextForEffort(
    readableEfforts(snapshot),
    effort,
    observation,
    snapshot.providerObservationSelections,
  );
  return context === undefined
    ? undefined
    : buildMattNativeWorkRegion(
        observation,
        snapshot.providerObservationSelections,
        context,
        readingState,
      );
};

const workRegionFor = (
  snapshot: LineageModelData,
  subject: PlanningLineageSubject,
  record: SubjectRecord,
  readingState?: MattNativeWorkReadingState | undefined,
): MattNativeWorkRegionModel | undefined => {
  if (subject.kind === "effort") return effortWorkRegion(snapshot, record as Effort, readingState);
  if (subject.kind !== "native-scope") return undefined;
  const scopeRecord = record as NativeScopeRecord;
  const context = scopeContextFor(snapshot, scopeRecord.observation);
  if (context === undefined) return undefined;
  return buildMattNativeWorkRegion(
    scopeRecord.observation,
    nativeSelections(snapshot),
    context,
    readingState,
  );
};

const effortCurrentWorkStatus = (
  item: MattNativeWorkRegionItem,
): "Claimed" | "Ready" | "Blocked" | "Needs attention" => {
  if (item.diagnosticCodes !== undefined || item.frontier === "uncertain") {
    return "Needs attention";
  }
  if (item.frontier === "claimed") return "Claimed";
  if (item.frontier === "ready") return "Ready";
  if (item.frontier === "blocked") return "Blocked";
  if (
    item.role === "incoming" &&
    (item.routingState === "ready-for-agent" || item.routingState === "ready-for-human")
  ) {
    return "Ready";
  }
  return "Needs attention";
};

const invalidBindingCause = (effort: Effort): string => {
  if (effort.workBindingState.state === "bound") {
    return "the declared Work Binding does not resolve to readable current source data.";
  }
  switch (effort.workBindingState.reason) {
    case "missing":
      return "this Effort has no declared Work Binding.";
    case "unparseable":
      return "the declared Work Binding does not match the supported provider contract.";
    case "conflicting":
      return "another Effort declares the same stable provider-native identity.";
    case "unresolved":
      return "the declared Work Binding does not resolve to current source data.";
  }
};

export const effortPlanningBasisForWorkRegion = (
  workRegion: MattNativeWorkRegionModel | undefined,
  entryId: string,
): NonNullable<PlanningLineageEffortLens["planningBasis"]> | undefined => {
  if (workRegion === undefined) return undefined;
  const map = workRegion.roles.find((group) => group.role === "map")?.items ?? [];
  const spec = workRegion.roles.find((group) => group.role === "spec")?.items ?? [];
  if (map.length > 1 || spec.length > 1) {
    return {
      state: "attention",
      diagnostic: {
        code: "effort.planning-basis.multiple-candidates",
        message:
          "Planning Basis requires at most one Map and one PRD / Spec; multiple candidates cannot be rendered as a valid basis.",
      },
    };
  }
  const items = [
    ...map.map((item) => ({ role: "Map" as const, item })),
    ...spec.map((item) => ({ role: "PRD / Spec" as const, item })),
  ].map(({ role, item }) => ({
    role,
    title: item.title,
    lifecycle: item.nativeLifecycle,
    href: planningLineageSubjectHref(entryId, { kind: "native-subject", id: item.reference }),
  }));
  return items.length === 0 ? undefined : { state: "available", items };
};

const effortOutputTimes = (asset: AssetProjection): readonly PlanningLineageTimeFact[] => {
  const facts: PlanningLineageTimeFact[] = [];
  const add = (key: string, label: string, time: AssetProjection["addedAt"] | undefined) => {
    if (time?.availability === "available") facts.push({ key, label, time });
  };
  add(`${asset.id}:added`, "Added to Assets", asset.addedAt);
  add(`${asset.id}:superseded`, "Superseded", asset.supersededAt);
  add(`${asset.id}:archived`, "Archived", asset.archivedAt);
  return facts;
};

const effortOutputsFor = (
  snapshot: LineageModelData,
  effort: Effort,
  entryId: string,
): PlanningLineageEffortLens["outputs"] => {
  if (snapshot.assets.validity === "invalid") {
    return { state: "unavailable", reason: "The Asset projection is unavailable." };
  }
  const assets = snapshot.assets.items.filter((asset) => asset.owner === effort.id);
  if (assets.length === 0) {
    return snapshot.assets.validity === "partial"
      ? {
          state: "unavailable",
          reason: "Partial Asset coverage cannot confirm an empty Effort output collection.",
        }
      : undefined;
  }
  return {
    state: "available",
    items: assets.map((asset) => ({
      id: asset.id,
      title: asset.title,
      kind: asset.kind,
      lifecycle: asset.disposition,
      href: planningLineageSubjectHref(entryId, { kind: "asset", id: asset.id }),
      superseded: asset.disposition === "superseded",
      times: effortOutputTimes(asset),
    })),
  };
};

const effortGovernanceFor = (
  snapshot: LineageModelData,
  effort: Effort,
  entryId: string,
): PlanningLineageEffortLens["governance"] => {
  const authorities = effort.authorityIds.map((authorityId) => {
    const authority = recordFor(snapshot, { kind: "authority", id: authorityId });
    return authority === undefined
      ? { title: "Authority unavailable" }
      : {
          title: authority.title,
          href: planningLineageSubjectHref(entryId, { kind: "authority", id: authority.id }),
        };
  });
  const citations = effort.citations.map((citation) => {
    const asset = recordFor(snapshot, { kind: "asset", id: citation.assetId });
    return asset === undefined
      ? { title: "Planning Citation unavailable", note: citation.note }
      : {
          title: asset.title,
          note: citation.note,
          href: planningLineageSubjectHref(entryId, { kind: "asset", id: asset.id }),
        };
  });
  return authorities.length === 0 && citations.length === 0
    ? undefined
    : { authorities, citations };
};

const effortLensFor = (
  snapshot: LineageModelData,
  effort: Effort,
  workRegion: MattNativeWorkRegionModel | undefined,
  entryId: string,
): PlanningLineageEffortLens => {
  const gate = recordFor(snapshot, { kind: "gate", id: effort.targetGateId });
  const targetGate =
    gate === undefined || !("effortIds" in gate)
      ? { title: "Target Gate unavailable" }
      : {
          title: gate.title,
          href: planningLineageSubjectHref(entryId, { kind: "gate", id: gate.id }),
        };
  const conclusion = effort.conclusion;
  const replacement =
    conclusion?.replacementEffortId === undefined
      ? undefined
      : recordFor(snapshot, { kind: "effort", id: conclusion.replacementEffortId });
  const managedWorkHealth =
    workRegion?.readingState.why.projectionState === "available" &&
    workRegion.readingState.why.freshness === "current" &&
    workRegion.readingState.why.coverage === "complete" &&
    workRegion.readingState.why.blockingDiagnosticCount === 0
      ? ("Healthy" as const)
      : ("Needs attention" as const);
  const reading = workRegion?.readingState;
  const binding = effort.workBinding;
  const inspectionSelection =
    binding === undefined
      ? undefined
      : snapshot.providerDetailEvidences.selections.find((selection) =>
          sameMattNativeScope(selection, binding),
        );
  const inspectionObservation =
    binding === undefined || inspectionSelection?.observationId === null
      ? undefined
      : snapshot.providerDetailEvidences.observations.find(
          (observation) =>
            observation.id === inspectionSelection?.observationId &&
            sameMattNativeScope(observation.binding, binding),
        );
  const inspectionContext =
    inspectionObservation === undefined
      ? undefined
      : mattNativeWorkReadingContextForEffort(
          readableEfforts(snapshot),
          effort,
          inspectionObservation,
          snapshot.providerDetailEvidences.selections,
        );
  const inspectedWorkRegion =
    inspectionContext === undefined
      ? undefined
      : buildMattNativeWorkRegion(
          inspectionObservation,
          snapshot.providerDetailEvidences.selections,
          inspectionContext,
        );
  const disposableWorkRegion = inspectedWorkRegion ?? workRegion;
  const lastVerifiedReading = inspectedWorkRegion?.readingState ?? reading;
  const managedWorkObservation =
    managedWorkHealth === "Healthy"
      ? undefined
      : {
          state:
            workRegion === undefined || workRegion.views[0].count.mode === "unavailable"
              ? ("unavailable" as const)
              : reading?.why.freshness === "stale"
                ? ("stale" as const)
                : ("partial" as const),
          indication:
            workRegion === undefined || workRegion.views[0].count.mode === "unavailable"
              ? "Managed work details are unavailable for the bound scope."
              : reading?.why.freshness === "stale"
                ? "Managed work details are stale; the last verified projection remains visible."
                : "Managed work coverage is partial; confirmed items remain visible.",
          ...(lastVerifiedReading?.observation.observedAt.availability === "available"
            ? { lastVerified: lastVerifiedReading.observation.observedAt.value }
            : {}),
          ...(binding !== undefined &&
          (effort.workBindingState.state === "bound" ||
            effort.workBindingState.reason === "unresolved")
            ? {
                refreshTarget: {
                  kind: "native-scope" as const,
                  id: mattNativeScopeSubject({ binding }).id,
                },
              }
            : {}),
          ...(inspectionSelection?.latestAttempt?.outcome === "failed"
            ? { latestRefreshFailed: true }
            : {}),
          ...(inspectionSelection?.latestAttempt?.outcome === "succeeded"
            ? { latestRefreshSucceeded: true }
            : {}),
        };
  const workItems = disposableWorkRegion?.views[0].items ?? [];
  const workCounts =
    disposableWorkRegion === undefined
      ? undefined
      : {
          total: disposableWorkRegion.total,
          current: disposableWorkRegion.views[0].count,
          resolved: disposableWorkRegion.views[1].count,
        };
  const emptyWorkState =
    workItems.length > 0 || workCounts === undefined
      ? undefined
      : managedWorkHealth === "Needs attention"
        ? ("attention-without-active-work" as const)
        : workCounts.resolved.mode !== "unavailable" && workCounts.resolved.value > 0
          ? ("resolved-only" as const)
          : workCounts.current.mode === "exact" &&
              workCounts.current.value === 0 &&
              workCounts.resolved.mode === "exact" &&
              workCounts.resolved.value === 0 &&
              workCounts.total.mode === "exact" &&
              workCounts.total.value === 0
            ? ("confirmed-no-managed-work" as const)
            : undefined;
  const observationUnavailable = disposableWorkRegion?.views[0].count.mode === "unavailable";
  const observationCause =
    disposableWorkRegion === undefined
      ? undefined
      : [
          ...(disposableWorkRegion.context.state === "attention"
            ? [disposableWorkRegion.context.detail]
            : []),
          ...disposableWorkRegion.readingState.observation.diagnostics.map(
            (diagnostic) => diagnostic.message,
          ),
          ...disposableWorkRegion.readingState.why.causes,
        ]
          .filter((value, index, values) => values.indexOf(value) === index)
          .join(" ");
  const currentWork =
    disposableWorkRegion === undefined ||
    binding === undefined ||
    observationUnavailable ||
    workCounts === undefined
      ? {
          state: "unavailable" as const,
          cause:
            observationCause === undefined || observationCause.length === 0
              ? invalidBindingCause(effort)
              : observationCause,
          impact: "native work cannot contribute trusted evidence or Gate readiness.",
          recovery:
            binding === undefined
              ? "declare exactly one supported Work Binding in the canonical Effort record, then reload this view."
              : "load this exact declared provider source; after any Matt transaction, run exact Targeted Native Reconciliation separately.",
        }
      : {
          state: "available" as const,
          items: workItems.map((item) => ({
            reference: item.reference,
            title: item.title,
            href: planningLineageSubjectHref(entryId, {
              kind: "native-subject",
              id: item.reference,
            }),
            status: effortCurrentWorkStatus(item),
            ...(item.frontier === "blocked"
              ? { blockerImpact: "Blocked by unresolved prerequisite work." }
              : {}),
            ...(item.diagnosticMessages === undefined
              ? {}
              : { attention: item.diagnosticMessages.join(" ") }),
          })),
          counts: workCounts,
          currentHref: planningLineageSubjectHref(
            entryId,
            { kind: "native-scope", id: binding.nativeScope },
            "native-work-current",
          ),
          resolvedHref: planningLineageSubjectHref(
            entryId,
            { kind: "native-scope", id: binding.nativeScope },
            "native-work-resolved",
          ),
          ...(emptyWorkState === undefined ? {} : { emptyState: emptyWorkState }),
          ...(effort.lifecycle === "concluded" && workItems.length > 0
            ? {
                consistencyWarning:
                  "This Effort is concluded, but nonterminal managed work remains in the bound scope.",
              }
            : {}),
        };
  const planningBasis = effortPlanningBasisForWorkRegion(workRegion, entryId);
  const outputs = effortOutputsFor(snapshot, effort, entryId);
  const governance = effortGovernanceFor(snapshot, effort, entryId);
  return {
    lifecycle: effort.lifecycle,
    targetGate,
    managedWorkHealth,
    ...(managedWorkObservation === undefined ? {} : { managedWorkObservation }),
    intent: effort.intent,
    ...(conclusion === undefined
      ? {}
      : {
          outcome: {
            disposition: conclusion.disposition,
            rationale: conclusion.rationale,
            concludedAt: conclusion.concludedAt,
            ...(conclusion.replacementEffortId === undefined
              ? {}
              : {
                  replacementEffort: {
                    title: replacement?.title ?? "Replacement Effort unavailable",
                    ...(replacement === undefined
                      ? {}
                      : {
                          href: planningLineageSubjectHref(entryId, {
                            kind: "effort",
                            id: replacement.id,
                          }),
                        }),
                  },
                }),
          },
        }),
    ...(currentWork === undefined ? {} : { currentWork }),
    ...(planningBasis === undefined ? {} : { planningBasis }),
    ...(outputs === undefined ? {} : { outputs }),
    ...(governance === undefined ? {} : { governance }),
  };
};

export const buildPlanningLineageSubjectModel = (
  snapshot: LineageModelData,
  subject: PlanningLineageSubject,
  entryId: string,
): PlanningLineageSubjectModel => {
  const lineage = findPlanningLineageSubjectProjection(snapshot.lineage, subject);
  if (lineage === undefined) {
    if (isNativeSubject(subject) && snapshot.nativeTargetState === "covered-missing") {
      return {
        state: "missing",
        requested: subject,
        reason:
          "This persistent identity is not present in the current Project Read Model generation.",
      };
    }
    const collection = collectionFor(snapshot, subject.kind);
    if (collection.validity === "available") {
      return {
        state: "missing",
        requested: subject,
        reason:
          "This persistent identity is not present in the current Project Read Model generation.",
      };
    }
    return {
      state: "unavailable",
      requested: subject,
      issueCount: collection.issues.length,
      reason:
        collection.validity === "partial"
          ? "Partial collection coverage cannot establish whether this persistent identity is present."
          : "The requested subject projection cannot be trusted in the current Project Read Model generation.",
    };
  }
  const record = recordFor(snapshot, subject);
  if (record === undefined) {
    return {
      state: "unavailable",
      requested: subject,
      issueCount: 1,
      reason: "The typed Planning Lineage subject has no matching trustworthy detail record.",
    };
  }
  const collection = collectionFor(snapshot, subject.kind);
  const relations = lineage.relations.map((relation) =>
    relationForDisplay(snapshot, entryId, subject, relation),
  );
  const semanticAvailability = new Map(
    lineage.semanticSections.map((section) => [section.role, section.availability]),
  );
  const collectionIsPartial = isNativeSubject(subject)
    ? !hasCompleteNativeEvidence(snapshot, (record as NativeRecord).observation)
    : collection.validity === "partial";
  const degraded =
    collectionIsPartial ||
    lineage.parentPath.state !== "complete" ||
    lineage.semanticSections.some(
      (section) => section.availability === "unavailable" || section.availability === "unsupported",
    ) ||
    lineage.relations.some(
      (relation) => relation.state === "unknown" || relation.state === "unavailable",
    );
  const sourceHref = isNativeSubject(subject)
    ? nativeSourceHref(record as NativeRecord)
    : undefined;
  const workRegion = workRegionFor(snapshot, subject, record, lineage.nativeWorkReadingState);
  const workHistoryOwner =
    subject.kind !== "native-scope" || workRegion?.context.effortIds.length !== 1
      ? undefined
      : readableEfforts(snapshot).find((effort) => effort.id === workRegion.context.effortIds[0]);
  const asset = subject.kind === "asset" ? (record as AssetProjection) : undefined;
  const headerStatuses = headerStatusesFor(record, subject);
  const inspectionSelection = isNativeSubject(subject)
    ? snapshot.providerDetailEvidences.selections.find((selection) => {
        const observation = (record as NativeRecord).observation;
        return (
          sameMattNativeScope(selection, observation.binding) &&
          selection.observationId === observation.id
        );
      })
    : undefined;
  return {
    state: degraded ? "partial" : "available",
    subject: {
      kind: subject.kind,
      id: subject.id,
      title: subject.kind === "native-scope" ? "Contributing Work" : record.title,
      source: sourceIndex(snapshot).get(record.source),
      ...(sourceHref === undefined ? {} : { sourceHref }),
    },
    parentPath: parentPathForDisplay(snapshot, entryId, lineage),
    ...(headerStatuses === undefined ? {} : { headerStatuses }),
    ...(asset === undefined ||
    snapshot.assetSourceProbe === undefined ||
    (snapshot.assetSourceProbe.kind === "local" &&
      (asset.kind === "prototype" || snapshot.assetSourceProbe.availability !== "file"))
      ? {}
      : {
          primaryAction: {
            label: snapshot.assetSourceProbe.kind === "external" ? "Open Source" : "View Content",
            href:
              snapshot.assetSourceProbe.kind === "external"
                ? snapshot.assetSourceProbe.href
                : assetPreviewHref(entryId, asset.id),
            external: true,
          },
        }),
    ...(lineage.parentPath.state === "complete"
      ? {}
      : {
          parentNotice: `${lineage.parentPath.reason ?? "Canonical parentage is unavailable."} The path stops at the last trustworthy ancestor.`,
        }),
    events: isNativeSubject(subject)
      ? nativeLifecycleEvents(record as NativeRecord)
      : planningLineageEventsFor(snapshot, subject, record as CanonicalSubjectRecord),
    sections: sectionsFor(snapshot, lineage, record, entryId),
    ...(subject.kind === "roadmap"
      ? { outcomeSpine: roadmapOutcomeSpine(snapshot, record as Roadmap, entryId) }
      : {}),
    ...(subject.kind === "effort"
      ? { effortLens: effortLensFor(snapshot, record as Effort, workRegion, entryId) }
      : {}),
    ...(workRegion === undefined ? {} : { workRegion }),
    ...(workHistoryOwner === undefined
      ? {}
      : {
          workHistoryOwner: {
            title: workHistoryOwner.title,
            href: planningLineageSubjectHref(entryId, {
              kind: "effort",
              id: workHistoryOwner.id,
            }),
          },
        }),
    ...(inspectionSelection === undefined
      ? {}
      : {
          nativeInspection: {
            freshness: inspectionSelection.effectiveFreshness,
            latestAttempt: inspectionSelection.latestAttempt,
          },
        }),
    semanticAvailability,
    relations,
    renderedMarkdown: snapshot.renderedMarkdown ?? [],
  };
};

export const planningLineageRelationFor = (
  model: Extract<PlanningLineageSubjectModel, { state: "available" | "partial" }>,
  key: PlanningLineageRelationKey,
): PlanningLineageRelation | undefined => model.relations.find((relation) => relation.key === key);
