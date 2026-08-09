import type { DocumentPresentationBlock } from "../document-presentation";
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
import type {
  MattDeliveryTicket,
  MattIncomingIssue,
  MattMap,
  MattNativeEventTime,
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
  type MattNativeWorkRegionItem,
  type MattNativeWorkRegionModel,
} from "../providers/matt-skills-v1/work-region";
import { projectExpectedSourceEventTime } from "../source-event-time";
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

export type PlanningLineageSection = Readonly<{
  anchor: string;
  title: string;
  body?: string | undefined;
  documentBlocks?: readonly DocumentPresentationBlock[] | undefined;
  copy?: Readonly<{ label: string; value: string }> | undefined;
  items?: readonly string[] | undefined;
  links?:
    | readonly Readonly<{
        label: string;
        prefix?: string | undefined;
        detail?: string | undefined;
        href: string;
        external?: boolean | undefined;
      }>[]
    | undefined;
  times?: readonly PlanningLineageTimeFact[] | undefined;
}>;

export type PlanningLineageTimeFact = Readonly<{
  key: string;
  label: string;
  time: MattNativeEventTime;
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
        concludedAt: MattNativeEventTime;
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
        historyHref: string;
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
  headerStatus?: string | undefined;
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
      issues: ["No provider observation establishes native subject coverage."],
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

const countByFrontier = (
  region: MattNativeWorkRegionModel,
  frontier: "claimed" | "ready" | "blocked" | "resolved" | "uncertain",
): number =>
  region.roles
    .filter((role) => role.role === "wayfinder" || role.role === "delivery")
    .flatMap((role) => role.items)
    .filter((item) => item.frontier === frontier).length;

const boundedFrontierSummary = (region: MattNativeWorkRegionModel): string => {
  if (region.context.state === "attention") return region.context.label;
  const frontierRoles = region.roles.filter(
    (role) => role.role === "wayfinder" || role.role === "delivery",
  );
  if (frontierRoles.some((role) => role.count.mode === "unavailable")) {
    return "Native frontier counts unavailable";
  }
  const values = [
    ["Claimed", countByFrontier(region, "claimed")],
    ["Ready", countByFrontier(region, "ready")],
    ...(countByFrontier(region, "uncertain") === 0
      ? []
      : ([["Uncertain", countByFrontier(region, "uncertain")]] as const)),
    ["Blocked", countByFrontier(region, "blocked")],
    ["Resolved", countByFrontier(region, "resolved")],
  ] as const;
  const qualifier = frontierRoles.some((role) => role.count.mode === "at-least") ? "≥" : "";
  return values.map(([label, value]) => `${label} ${qualifier}${value}`).join(" · ");
};

const contributingEffortsSection = (
  snapshot: LineageModelData,
  effortIds: readonly string[],
  entryId: string,
): PlanningLineageSection => {
  const efforts = readableEfforts(snapshot);
  const links = effortIds.flatMap((effortId) => {
    const effort = efforts.find((candidate) => candidate.id === effortId);
    if (effort === undefined) return [];
    const region = effortWorkRegion(snapshot, effort);
    return [
      {
        label: effort.title,
        detail:
          region === undefined ? "Native frontier unavailable" : boundedFrontierSummary(region),
        href: planningLineageSubjectHref(entryId, { kind: "effort", id: effort.id }),
      },
    ];
  });
  const missingItems = effortIds
    .filter((effortId) => !efforts.some((effort) => effort.id === effortId))
    .map(() => "Unavailable contributing Effort");
  return {
    anchor: "native-work.effort-summaries",
    title: "Contributing Efforts",
    body:
      links.length === 0 && missingItems.length === 0
        ? "No trustworthy contributing Effort summary is available."
        : "Each contributing Effort opens its complete lifecycle and bound native work context.",
    ...(links.length === 0 ? {} : { links }),
    ...(missingItems.length === 0 ? {} : { items: missingItems }),
  };
};

const roadmapSections = (roadmap: Roadmap): readonly PlanningLineageSection[] => {
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
): readonly PlanningLineageSection[] => [
  { anchor: "gate.intent", title: "Intent", body: gate.intent },
  { anchor: "gate.exit-criteria", title: "Exit Criteria", items: gate.exitCriteria },
  {
    anchor: "gate.passage",
    title: "Passage",
    body:
      gate.passage === undefined
        ? "No Gate Passage is recorded."
        : `${gate.passage.acceptedDecision} ${gate.passage.rationale}`,
    ...(gate.passage === undefined
      ? {}
      : {
          items: [
            ...gate.passage.evidence.map(
              (entry) => `Evidence: ${entry.locator} · ${entry.relevance}`,
            ),
            ...gate.passage.exceptions.map((exception) => `Exception: ${exception}`),
          ],
        }),
  },
  contributingEffortsSection(snapshot, gate.effortIds, entryId),
];

const sentenceCaseToken = (value: string): string =>
  value
    .split("-")
    .map((part, index) => (index === 0 ? `${part[0]?.toUpperCase()}${part.slice(1)}` : part))
    .join(" ");

const headerStatusFor = (
  record: SubjectRecord,
  subject: PlanningLineageSubject,
): string | undefined => {
  if (subject.kind === "roadmap") {
    return `${sentenceCaseToken((record as Roadmap).lifecycle)} roadmap`;
  }
  if (subject.kind !== "gate") return undefined;
  const gate = record as MilestoneGate;
  const position = gate.horizonState === "focused" ? "Current gate" : "Gate";
  const readiness =
    gate.readiness === "not-ready"
      ? "Not ready for passage"
      : gate.readiness === "ready-for-review"
        ? "Ready for review"
        : "Readiness unknown";
  return `${position} · ${sentenceCaseToken(gate.lifecycle)} · ${readiness}`;
};

const authoritySections = (authority: Authority): readonly PlanningLineageSection[] => [
  { anchor: "authority.scope", title: "Scope", body: authority.scope },
  {
    anchor: "authority.baseline",
    title: "Current Baseline",
    body:
      authority.baselineAssetIds.length === 0
        ? "No baseline Assets are declared."
        : "The following Assets form the current baseline.",
    ...(authority.baselineAssetIds.length === 0 ? {} : { items: authority.baselineAssetIds }),
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
): readonly PlanningLineageSection[] => {
  const changedReferences = resolution?.changedReferences ?? [];
  return [
    { anchor: `${prefix}.lifecycle`, title: "Lifecycle", body: status },
    {
      anchor: `${prefix}.resolution`,
      title: resolution === undefined ? "Open Context" : "Accepted Resolution",
      body: resolution?.acceptedDecision ?? pendingContext,
    },
    {
      anchor: `${prefix}.rationale`,
      title: "Rationale",
      body: resolution?.rationale ?? "No accepted rationale is recorded.",
    },
    {
      anchor: `${prefix}.changed-references`,
      title: "Changed References",
      body:
        changedReferences.length === 0
          ? "No accepted changed references are recorded."
          : "Accepted resolution changed the following references.",
      ...(changedReferences.length === 0 ? {} : { items: changedReferences }),
    },
    {
      anchor: `${prefix}.evidence`,
      title: "Supporting Evidence",
      body:
        citationCount === 0
          ? "No supporting Planning Citations are recorded."
          : `${citationCount} supporting Planning Citation${citationCount === 1 ? "" : "s"} recorded.`,
    },
  ];
};

const planningReviewSections = (review: PlanningReview): readonly PlanningLineageSection[] => [
  { anchor: "planning-review.question", title: "Question", body: review.question },
  {
    anchor: "planning-review.scope",
    title: "Scope",
    body: review.scope.kind === "project" ? "Whole project" : review.scope.target,
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
): readonly PlanningLineageSection[] => {
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
        return "Work History";
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
  const relationText = (
    relationLabel: string,
    target: ReturnType<typeof relationTarget>,
    title: string,
  ) => {
    const type = objectTypeLabel(target?.subject);
    return `${relationLabel}: ${type === undefined ? "" : `${type}: `}${title}`;
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
      body: `Kind: ${asset.kind}. Purpose: ${asset.purpose}`,
    },
    {
      anchor: "asset.ownership",
      title: "Ownership and Purpose",
      links: [ownerLink].filter((link): link is NonNullable<typeof link> => link !== undefined),
      items: [
        ...(ownerLink === undefined
          ? [relationText("Owner", relationTarget("production.owner"), ownerTitle)]
          : []),
      ],
    },
    {
      anchor: "asset.lifecycle",
      title: "Lifecycle",
      body: asset.disposition,
      ...(asset.supersededBy === undefined
        ? {}
        : { items: [`Replacement: ${asset.supersededBy}`] }),
    },
    {
      anchor: "asset.source",
      title: "Source",
      body:
        snapshot.assetSourceProbe?.kind === "external"
          ? "External HTTPS source. Bearing did not verify its content."
          : snapshot.assetSourceProbe?.kind === "local"
            ? `Current local source: ${snapshot.assetSourceProbe.availability}.`
            : "Current source availability is unavailable.",
      items: [`Locator: ${asset.sourceLocator}`],
    },
    {
      anchor: "asset.evidence",
      title: "Planning Use",
      body: `${asset.citations.length} Planning Citation${asset.citations.length === 1 ? "" : "s"}; ${asset.authorityBaselines.length} Authority baseline${asset.authorityBaselines.length === 1 ? "" : "s"}.`,
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
    items?: readonly string[] | undefined;
    times?: readonly PlanningLineageTimeFact[] | undefined;
    emptyCopy: string;
    unavailableBody?: string | undefined;
  }>,
): PlanningLineageSection => {
  const availability = nativeSemanticAvailability(object, input.role);
  if (availability === "confirmed-empty") {
    return { anchor: input.role, title: input.title, body: input.emptyCopy };
  }
  if (availability === "unavailable") {
    return {
      anchor: input.role,
      title: input.title,
      body:
        input.unavailableBody ??
        "This semantic section is unavailable in the selected provider observation.",
      ...(input.items === undefined ? {} : { items: input.items }),
      ...(input.times === undefined ? {} : { times: input.times }),
    };
  }
  if (availability === "unsupported") {
    return {
      anchor: input.role,
      title: input.title,
      body: "This provider version does not support the requested semantic section.",
      ...(input.times === undefined ? {} : { times: input.times }),
    };
  }
  return {
    anchor: input.role,
    title: input.title,
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.items === undefined ? {} : { items: input.items }),
    ...(input.times === undefined ? {} : { times: input.times }),
  };
};

const sourceAnchorLabel = (anchor: Readonly<{ kind: string; target: string }>): string =>
  `${anchor.kind}: ${anchor.target}`;

const nativeTrustSections = (
  snapshot: LineageModelData,
  record: NativeRecord,
): readonly PlanningLineageSection[] => {
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
      body: `Observation ${observation.id}; projection ${observation.state}; freshness ${evidence.freshness}; coverage ${observation.coverage.assessment}; completion ${observation.completion}; selected evidence ${evidence.frontierEvidence}. Current means verified at the recorded observation against the confirmed source revision; it does not promise live currency.`,
      times: [
        {
          key: `observation:${observation.id}:verified-at`,
          label: "Verified at",
          time: projectExpectedSourceEventTime(observation.observedAt),
          mode: "compact",
          detail: observation.sourceRevision ?? "Source revision unavailable",
        },
      ],
    },
    {
      anchor: "native.provenance",
      title: "Native Provenance",
      body: provenance,
      ...(object === undefined
        ? {}
        : {
            times: [
              { key: "native-created", label: "Created", time: object.native.createdAt },
              {
                key: "native-last-updated",
                label: "Last updated",
                time: object.native.lastUpdated,
                detail: "Secondary source metadata; not a lifecycle event.",
              },
            ],
          }),
    },
  ];
};

const mapSections = (map: MattMap): readonly PlanningLineageSection[] => [
  nativeSemanticSection(map, {
    role: "map.destination",
    title: "Destination",
    body: map.destination,
    emptyCopy: "No Destination is declared.",
  }),
  {
    anchor: "map.lifecycle",
    title: "Map Lifecycle",
    body: map.lifecycle.state,
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
    items: map.decisions.map(
      (decision) =>
        `${decision.gist}${decision.ticket === undefined ? "" : ` · Ticket ${decision.ticket}`} · ${sourceAnchorLabel(decision.sourceAnchor)}`,
    ),
    emptyCopy: "No decisions are recorded.",
  }),
  nativeSemanticSection(map, {
    role: "map.out-of-scope",
    title: "Out of Scope",
    items: map.outOfScope.map(
      (entry) =>
        `${entry.rationale}${entry.ticket === undefined ? "" : ` · Ticket ${entry.ticket}`} · ${sourceAnchorLabel(entry.sourceAnchor)}`,
    ),
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

const specSections = (spec: MattSpec): readonly PlanningLineageSection[] => [
  {
    anchor: "spec.lifecycle",
    title: "Spec Lifecycle",
    body: spec.lifecycle.state,
  },
  ...spec.document.sections.map((section) => ({
    anchor: section.semanticRole ?? section.sourceIdentity,
    title: section.title,
    ...(section.availability === "available" ? { documentBlocks: section.blocks } : {}),
    ...(section.availability === "confirmed-empty"
      ? { body: `No ${section.title.toLocaleLowerCase()} content is recorded.` }
      : {}),
    ...(section.availability === "unavailable"
      ? { body: "This document section is unavailable in the selected provider observation." }
      : {}),
  })),
];

const trackerClosureItems = (
  closure: MattWayfinderTicket["trackerClosure"] | MattDeliveryTicket["trackerClosure"],
): Pick<PlanningLineageSection, "items" | "times"> =>
  closure.state === "open"
    ? { items: ["Tracker closure: open"] }
    : {
        items: [
          `Tracker closure: closed · ${closure.disposition}`,
          ...(closure.actor === undefined ? [] : [`Closure actor: ${closure.actor}`]),
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
): readonly PlanningLineageTimeFact[] =>
  content.flatMap((entry, index) =>
    entry.authoredAt === undefined
      ? []
      : [
          {
            key: `content-authored:${entry.nativeIdentity ?? index}`,
            label: `${entry.role === "answer" ? "Answer" : "Comment"} authored${
              entry.author === undefined ? "" : ` by ${entry.author}`
            }`,
            time: entry.authoredAt,
            detail: `Native content position ${index + 1}; event time does not reorder content.`,
          },
        ],
  );

const wayfinderSections = (ticket: MattWayfinderTicket): readonly PlanningLineageSection[] => [
  nativeSemanticSection(ticket, {
    role: "wayfinder.question",
    title: "Question",
    body: ticket.question,
    emptyCopy: "No Question is recorded.",
  }),
  {
    anchor: "wayfinder.lifecycle",
    title: "Lifecycle and Subtype",
    body: `${ticket.lifecycle.state} · ${ticket.subtype}`,
    ...trackerClosureItems(ticket.trackerClosure),
  },
  nativeSemanticSection(ticket, {
    role: "wayfinder.claim",
    title: "Claim",
    body:
      ticket.claim.state === "unclaimed"
        ? "Unclaimed"
        : `Claimed${ticket.claim.claimant === undefined ? "" : ` by ${ticket.claim.claimant}`}${
            ticket.claim.claimantAmbiguous === true ? " · claimant ambiguous" : ""
          }`,
    emptyCopy: "No claim is recorded.",
  }),
  nativeSemanticSection(ticket, {
    role: "wayfinder.answer",
    title: "Answer",
    body:
      ticket.answer.availability === "available"
        ? ticket.answer.content.body
        : `Answer unavailable: ${ticket.answer.reason}.`,
    items:
      ticket.answer.availability === "available" && ticket.answer.content.sourceAnchor !== undefined
        ? [sourceAnchorLabel(ticket.answer.content.sourceAnchor)]
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
  nativeSemanticSection(ticket, {
    role: "wayfinder.comments",
    title: "Comments",
    items: ticket.comments.map(
      (comment) =>
        `${comment.role}: ${comment.body}${
          comment.sourceAnchor === undefined ? "" : ` · ${sourceAnchorLabel(comment.sourceAnchor)}`
        }`,
    ),
    times: contentTimeFacts(ticket.comments),
    emptyCopy: "No comments are recorded.",
  }),
  ...(ticket.lifecycle.state === "resolved-on-route"
    ? [
        {
          anchor: "wayfinder.decision-backlink",
          title: "Decision Backlink",
          body: sourceAnchorLabel(ticket.lifecycle.decisionSource),
        },
      ]
    : ticket.lifecycle.state === "ruled-out-of-scope"
      ? [
          {
            anchor: "wayfinder.disposition-backlink",
            title: "Disposition Backlink",
            body: sourceAnchorLabel(ticket.lifecycle.dispositionSource),
          },
        ]
      : []),
];

const deliverySections = (ticket: MattDeliveryTicket): readonly PlanningLineageSection[] => [
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
    body: ticket.lifecycle.state,
    ...trackerClosureItems(ticket.trackerClosure),
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
    items: ticket.comments.map(
      (comment) =>
        `${comment.role}: ${comment.body}${
          comment.sourceAnchor === undefined ? "" : ` · ${sourceAnchorLabel(comment.sourceAnchor)}`
        }`,
    ),
    times: contentTimeFacts(ticket.comments),
    emptyCopy: "No comments are recorded.",
  }),
];

const incomingSections = (issue: MattIncomingIssue): readonly PlanningLineageSection[] => [
  nativeSemanticSection(issue, {
    role: "incoming.classification",
    title: "Classification",
    body: `${issue.classification.category} · ${issue.classification.state}`,
    items: [
      ...(issue.classification.nativeCategory === undefined
        ? []
        : [`Native category: ${issue.classification.nativeCategory}`]),
      ...(issue.classification.nativeState === undefined
        ? []
        : [`Native state: ${issue.classification.nativeState}`]),
    ],
    emptyCopy: "No classification is recorded.",
    unavailableBody: `Classification remains ${issue.classification.category} · ${issue.classification.state}; the provider could not establish one unambiguous mapped classification.`,
  }),
  nativeSemanticSection(issue, {
    role: "incoming.routing",
    title: "Routing",
    body: issue.classification.state,
    emptyCopy: "No routing state is recorded.",
    unavailableBody: `Routing remains ${issue.classification.state}; it is not coerced to needs-triage.`,
  }),
  {
    anchor: "incoming.lifecycle",
    title: "Native Lifecycle",
    body: issue.lifecycle.state === "open" ? "open" : `closed · ${issue.lifecycle.disposition}`,
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
    items: issue.content.map(
      (content) =>
        `${content.role}: ${content.body}${
          content.sourceAnchor === undefined ? "" : ` · ${sourceAnchorLabel(content.sourceAnchor)}`
        }`,
    ),
    times: contentTimeFacts(issue.content),
    emptyCopy: "No issue content or triage notes are recorded.",
  }),
];

const nativeSections = (
  snapshot: LineageModelData,
  record: NativeRecord,
): readonly PlanningLineageSection[] => {
  if (record.recordKind === "native-scope") return [];
  const objectSections = (() => {
    switch (record.object.kind) {
      case "map":
        return mapSections(record.object);
      case "spec":
        return specSections(record.object);
      case "wayfinder-ticket":
        return wayfinderSections(record.object);
      case "delivery-ticket":
        return deliverySections(record.object);
      case "incoming-issue":
        return incomingSections(record.object);
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
  switch (lineage.identity.kind) {
    case "roadmap":
      return roadmapSections(record as Roadmap);
    case "gate":
      return gateSections(snapshot, record as MilestoneGate, entryId);
    case "effort":
      return [];
    case "authority":
      return authoritySections(record as Authority);
    case "planning-review":
      return planningReviewSections(record as PlanningReview);
    case "asset":
      return assetSections(snapshot, record as AssetProjection, entryId, lineage);
    case "native-scope":
    case "native-subject":
      return nativeSections(snapshot, record as NativeRecord);
  }
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
    return "the declared Work Binding does not resolve to a readable provider observation.";
  }
  switch (effort.workBindingState.reason) {
    case "missing":
      return "this Effort has no declared Work Binding.";
    case "unparseable":
      return "the declared Work Binding does not match the supported provider contract.";
    case "conflicting":
      return "another Effort declares the same stable provider-native identity.";
    case "unresolved":
      return "the declared Work Binding does not resolve to a provider observation.";
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
  const workItems =
    disposableWorkRegion?.views[0].items.filter(
      (item) => item.role === "wayfinder" || item.role === "delivery" || item.role === "incoming",
    ) ?? [];
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
    disposableWorkRegion === undefined || binding === undefined || observationUnavailable
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
      : effort.lifecycle === "concluded" && workItems.length === 0
        ? undefined
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
            historyHref: planningLineageSubjectHref(
              entryId,
              { kind: "native-scope", id: binding.nativeScope },
              "native-work-history",
            ),
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
  const headerStatus = headerStatusFor(record, subject);
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
    ...(headerStatus === undefined ? {} : { headerStatus }),
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
  };
};

export const planningLineageRelationFor = (
  model: Extract<PlanningLineageSubjectModel, { state: "available" | "partial" }>,
  key: PlanningLineageRelationKey,
): PlanningLineageRelation | undefined => model.relations.find((relation) => relation.key === key);
