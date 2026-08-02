import type { PlanningLineageRelationKey, PlanningLineageSubject } from "../planning-lineage-route";
import {
  planningLineageFilteredViewHref,
  planningLineageSubjectHref,
} from "../planning-lineage-route";
import type {
  AlignmentCheck,
  AssetProjection,
  Authority,
  Effort,
  MilestoneGate,
  PlanningLineageSubjectProjection,
  PlanningReview,
  ProjectSnapshot,
  Roadmap,
  PlanningLineageRelation as SnapshotLineageRelation,
  SourceRecord,
} from "../project-snapshot/contract";
import { findPlanningLineageSubjectProjection } from "../project-snapshot/planning-lineage";
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
  type MattNativeWorkRegionModel,
} from "../providers/matt-skills-v1/work-region";
import { projectExpectedSourceEventTime } from "../source-event-time";
import { assetEvidenceRoleLabel } from "./asset-evidence-role-label";
import {
  type PlanningLineageEvent,
  type PlanningLineageEventTime,
  planningLineageEventsFor,
  planningLineageRelationEvent,
} from "./planning-lineage-events";
import { assetPreviewHref } from "./project-route";

const RELATION_PREVIEW_LIMIT = 3;

type CanonicalSubjectRecord =
  | Roadmap
  | MilestoneGate
  | Effort
  | Authority
  | AlignmentCheck
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
  copy?: Readonly<{ label: string; value: string }> | undefined;
  items?: readonly string[] | undefined;
  links?:
    | readonly Readonly<{
        label: string;
        detail: string;
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
  events: readonly PlanningLineageEvent<PlanningLineageEventTime>[];
  sections: readonly PlanningLineageSection[];
  workRegion?: MattNativeWorkRegionModel | undefined;
  nativeInspection?:
    | Readonly<{
        freshness: "current" | "stale" | "undetermined";
        latestAttempt: ProjectSnapshot["nativeScopeInspections"]["selections"][number]["latestAttempt"];
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
  | ProjectSnapshot["providerObservations"][number]
  | ProjectSnapshot["nativeScopeInspections"]["observations"][number];

const nativeObservations = (snapshot: ProjectSnapshot): readonly NativeObservation[] => {
  const byScope = new Map(
    snapshot.nativeScopeInspections.observations.map((observation) => [
      mattNativeScopeKey(observation.binding),
      observation,
    ]),
  );
  for (const observation of snapshot.providerObservations) {
    byScope.set(mattNativeScopeKey(observation.binding), observation);
  }
  return [...byScope.values()];
};

const nativeSelections = (snapshot: ProjectSnapshot) => {
  const byScope = new Map(
    snapshot.nativeScopeInspections.selections.map((selection) => [
      mattNativeScopeKey(selection),
      selection,
    ]),
  );
  for (const selection of snapshot.providerObservationSelections) {
    byScope.set(mattNativeScopeKey(selection), selection);
  }
  return [...byScope.values()];
};

const nativeEvidenceAssessment = (snapshot: ProjectSnapshot, observation: NativeObservation) =>
  assessMattNativeEvidence(observation, nativeSelections(snapshot));

const hasCompleteNativeEvidence = (
  snapshot: ProjectSnapshot,
  observation: NativeObservation,
): boolean => hasCompleteMattNativeEvidence(observation, nativeSelections(snapshot));

const providerSubjectRecords = (snapshot: ProjectSnapshot): readonly NativeRecord[] =>
  mattNativeRecords(nativeObservations(snapshot), snapshot.sources);

const nativeCollectionFor = (
  snapshot: ProjectSnapshot,
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
  snapshot: ProjectSnapshot,
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
    case "alignment-check":
      return snapshot.checks;
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
  snapshot: ProjectSnapshot,
  subject: PlanningLineageSubject,
): SubjectRecord | undefined => {
  const collection = collectionFor(snapshot, subject.kind);
  return collection.validity === "invalid"
    ? undefined
    : collection.items.find((candidate) => String(candidate.id) === subject.id);
};

const sourceIndex = (snapshot: ProjectSnapshot): ReadonlyMap<string, SourceRecord> =>
  new Map(snapshot.sources.map((source) => [source.reference, source]));

const projectTitle = (snapshot: ProjectSnapshot): string =>
  snapshot.summary.validity === "available" || snapshot.summary.validity === "partial"
    ? snapshot.summary.value.title
    : "Project";

const titleFor = (snapshot: ProjectSnapshot, subject: PlanningLineageSubject): string =>
  recordFor(snapshot, subject)?.title ?? subject.id;

const relationItem = (
  snapshot: ProjectSnapshot,
  entryId: string,
  owner: PlanningLineageSubject,
  relationKey: PlanningLineageRelationKey,
  target: Extract<SnapshotLineageRelation, { state: "present" }>["targets"][number],
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
  snapshot: ProjectSnapshot,
  entryId: string,
  owner: PlanningLineageSubject,
  relation: SnapshotLineageRelation,
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
  snapshot: ProjectSnapshot,
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

const roadmapSections = (
  snapshot: ProjectSnapshot,
  roadmap: Roadmap,
  entryId: string,
): readonly PlanningLineageSection[] => {
  const gateLabels = roadmap.gateOrder.map((id) => {
    const gate = recordFor(snapshot, { kind: "gate", id });
    return gate?.title ?? "Unavailable Gate";
  });
  const focused =
    roadmap.focusedGateId === null
      ? "No focused Gate"
      : (recordFor(snapshot, { kind: "gate", id: roadmap.focusedGateId })?.title ??
        "Focused Gate unavailable");
  return [
    { anchor: "roadmap.intent", title: "Intent", body: roadmap.intent },
    {
      anchor: "roadmap.gates",
      title: "Complete Gate order",
      items: gateLabels.length === 0 ? ["No Gates in the declared horizon."] : gateLabels,
    },
    {
      anchor: "roadmap.focus",
      title: "Lifecycle and Focus",
      body: `${focused}. Lifecycle ${roadmap.lifecycle}; horizon ${roadmap.horizon}.`,
    },
    contributingEffortsSection(snapshot, roadmap.effortIds, entryId),
  ];
};

const gateSections = (
  snapshot: ProjectSnapshot,
  gate: MilestoneGate,
  entryId: string,
): readonly PlanningLineageSection[] => [
  { anchor: "gate.intent", title: "Intent", body: gate.intent },
  { anchor: "gate.exit-criteria", title: "Exit Criteria", items: gate.exitCriteria },
  {
    anchor: "gate.readiness",
    title: "Lifecycle and Readiness",
    body: `Lifecycle ${gate.lifecycle}; horizon ${gate.horizonState}; readiness ${gate.readiness}.`,
  },
  {
    anchor: "gate.passage",
    title: "Passage",
    body:
      gate.passage === undefined
        ? "No Gate Passage is recorded."
        : `${gate.passage.acceptedDecision} ${gate.passage.rationale}`,
    ...(gate.passage === undefined || gate.passage.exceptions.length === 0
      ? {}
      : { items: gate.passage.exceptions }),
  },
  contributingEffortsSection(snapshot, gate.effortIds, entryId),
];

const effortSections = (
  effort: Effort,
  lineage: PlanningLineageSubjectProjection,
): readonly PlanningLineageSection[] => {
  const conclusion = effort.conclusion;
  const binding = effort.workBinding;
  const workRelation = lineage.relations.find((relation) => relation.key === "native-work.binding");
  const workTrust = workRelation?.state === "present" ? workRelation.targets[0]?.note : undefined;
  return [
    { anchor: "effort.intent", title: "Intent", body: effort.intent },
    {
      anchor: "effort.lifecycle",
      title: "Effort Lifecycle",
      body: effort.lifecycle,
      ...(conclusion === undefined
        ? {}
        : { items: [`Conclusion: ${conclusion.disposition}`, conclusion.rationale] }),
    },
    {
      anchor: "effort.native-work",
      title: "Work Binding",
      body:
        binding === undefined
          ? "No Work Binding is declared."
          : `${binding.provider} · ${binding.nativeScope}. ${workTrust ?? "Trust evidence unavailable."}`,
    },
  ];
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
  {
    anchor: "authority.adoption-decisions",
    title: "Adoption Decisions",
    body:
      authority.adoptions.length === 0
        ? "No explicit Authority Adoption is recorded. Current baseline membership is not substituted for decision provenance."
        : "Each adoption cites the Accepted Decision that owns its Source Event Time.",
    ...(authority.adoptions.length === 0
      ? {}
      : {
          items: authority.adoptions.map(
            (adoption) => `${adoption.assetId} · ${adoption.decisionReference}`,
          ),
        }),
  },
  {
    anchor: "authority.superseded-context",
    title: "Superseded Baseline Context",
    body: "Superseded Authority context is unavailable in the current typed contract.",
  },
];

const resolutionSections = (
  prefix: "alignment-check" | "planning-review",
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

const alignmentCheckSections = (check: AlignmentCheck): readonly PlanningLineageSection[] => [
  { anchor: "alignment-check.target", title: "Target", body: check.target },
  ...resolutionSections(
    "alignment-check",
    check.status,
    check.title,
    check.resolution,
    check.citations.length,
  ),
];

const planningReviewSections = (review: PlanningReview): readonly PlanningLineageSection[] => [
  { anchor: "planning-review.scope", title: "Scope", body: review.scope },
  ...resolutionSections(
    "planning-review",
    review.status,
    review.title,
    review.resolution,
    review.citations.length,
  ),
];

const assetSections = (
  asset: AssetProjection,
  entryId: string,
): readonly PlanningLineageSection[] => {
  const evidenceRoles = asset.evidenceRoles.map(assetEvidenceRoleLabel);
  return [
    {
      anchor: "asset.identity",
      title: "Asset Identity",
      body: `${asset.id} · ${asset.kind} · content ${asset.contentAvailability}.`,
    },
    {
      anchor: "asset.lifecycle",
      title: "Lifecycle",
      body: `${asset.lifecycleSource}${asset.disposition === undefined ? "" : ` · ${asset.disposition}`}`,
      ...(asset.supersededBy === undefined
        ? {}
        : { items: [`Replacement: ${asset.supersededBy}`] }),
    },
    {
      anchor: "asset.provenance",
      title: "Provenance",
      body: `Producer ${asset.producer.kind} / ${asset.producer.name}.`,
      copy: { label: "Copy Asset Location", value: asset.displayLocation },
      items: [
        `Location: ${asset.displayLocation}`,
        `Owner: ${asset.owner}`,
        `Produced For: ${asset.producedFor ?? "Not declared"}`,
        ...(asset.producer.reference === undefined
          ? []
          : [`Producer Reference: ${asset.producer.reference}`]),
      ],
    },
    {
      anchor: "asset.evidence-roles",
      title: "Evidence Roles",
      body:
        evidenceRoles.length === 0
          ? "No explicit Evidence role is recorded."
          : "Only the following explicit Evidence roles are recorded.",
      ...(evidenceRoles.length === 0 ? {} : { items: evidenceRoles }),
    },
    {
      anchor: "asset.preview",
      title: "Preview Availability",
      body:
        asset.contentAvailability === "available"
          ? "Open preview reads current-checkout content and does not claim historical Snapshot bytes."
          : `Preview is unavailable because Content Availability is ${asset.contentAvailability}.`,
      ...(asset.contentAvailability === "available"
        ? {
            links: [
              {
                label: "Open preview",
                detail: "Current-checkout content · isolated window",
                href: assetPreviewHref(entryId, asset.id),
                external: true,
              },
            ],
          }
        : {}),
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
  snapshot: ProjectSnapshot,
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

const nativeScopeSections = (
  snapshot: ProjectSnapshot,
  record: NativeScopeRecord,
): readonly PlanningLineageSection[] => {
  const evidence = nativeEvidenceAssessment(snapshot, record.observation);
  return [
    {
      anchor: "native-scope.trust",
      title: "Scope Context and Trust",
      body: `${record.observation.provider} · ${record.title}. Projection ${record.observation.state}; freshness ${evidence.freshness}; coverage ${record.observation.coverage.assessment}; completion ${record.observation.completion}; selected evidence ${evidence.frontierEvidence}. Current means verified at the recorded observation against the confirmed source revision; it does not promise live currency.`,
      times: [
        {
          key: `observation:${record.observation.id}:verified-at`,
          label: "Verified at",
          time: projectExpectedSourceEventTime(record.observation.observedAt),
          mode: "compact",
          detail: record.observation.sourceRevision ?? "Source revision unavailable",
        },
      ],
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
  ...spec.sections.map((section) =>
    nativeSemanticSection(spec, {
      role: `spec.${section.role}`,
      title: section.title,
      body: section.body,
      emptyCopy: `No ${section.title.toLocaleLowerCase()} content is recorded.`,
    }),
  ),
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
  snapshot: ProjectSnapshot,
  record: NativeRecord,
): readonly PlanningLineageSection[] => {
  if (record.recordKind === "native-scope") return nativeScopeSections(snapshot, record);
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
  snapshot: ProjectSnapshot,
  lineage: PlanningLineageSubjectProjection,
  record: SubjectRecord,
  entryId: string,
): readonly PlanningLineageSection[] => {
  switch (lineage.identity.kind) {
    case "roadmap":
      return roadmapSections(snapshot, record as Roadmap, entryId);
    case "gate":
      return gateSections(snapshot, record as MilestoneGate, entryId);
    case "effort":
      return effortSections(record as Effort, lineage);
    case "authority":
      return authoritySections(record as Authority);
    case "alignment-check":
      return alignmentCheckSections(record as AlignmentCheck);
    case "planning-review":
      return planningReviewSections(record as PlanningReview);
    case "asset":
      return assetSections(record as AssetProjection, entryId);
    case "native-scope":
    case "native-subject":
      return nativeSections(snapshot, record as NativeRecord);
  }
};

const parentPathForDisplay = (
  snapshot: ProjectSnapshot,
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

const readableEfforts = (snapshot: ProjectSnapshot): readonly Effort[] =>
  snapshot.efforts.validity === "invalid" ? [] : snapshot.efforts.items;

const scopeContextFor = (
  snapshot: ProjectSnapshot,
  observation: NativeObservation,
): MattNativeWorkRegionContext | undefined =>
  mattNativeWorkReadingContextForScope(readableEfforts(snapshot), observation);

const effortWorkRegion = (
  snapshot: ProjectSnapshot,
  effort: Effort,
  readingState?: MattNativeWorkReadingState | undefined,
): MattNativeWorkRegionModel | undefined => {
  const binding = effort.workBinding;
  if (binding === undefined) return undefined;
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
  snapshot: ProjectSnapshot,
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

export const buildPlanningLineageSubjectModel = (
  snapshot: ProjectSnapshot,
  subject: PlanningLineageSubject,
  entryId: string,
): PlanningLineageSubjectModel => {
  const lineage = findPlanningLineageSubjectProjection(snapshot.lineage, subject);
  if (lineage === undefined) {
    const collection = collectionFor(snapshot, subject.kind);
    if (collection.validity === "available") {
      return {
        state: "missing",
        requested: subject,
        reason: "This persistent identity is not present in the current Project Snapshot.",
      };
    }
    return {
      state: "unavailable",
      requested: subject,
      issueCount: collection.issues.length,
      reason:
        collection.validity === "partial"
          ? "Partial collection coverage cannot establish whether this persistent identity is present."
          : "The requested subject projection cannot be trusted in the current Snapshot.",
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
  const inspectionSelection = isNativeSubject(subject)
    ? snapshot.nativeScopeInspections.selections.find((selection) => {
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
      title: record.title,
      source: sourceIndex(snapshot).get(record.source),
      ...(sourceHref === undefined ? {} : { sourceHref }),
    },
    parentPath: parentPathForDisplay(snapshot, entryId, lineage),
    ...(lineage.parentPath.state === "complete"
      ? {}
      : {
          parentNotice: `${lineage.parentPath.reason ?? "Canonical parentage is unavailable."} The path stops at the last trustworthy ancestor.`,
        }),
    events: isNativeSubject(subject)
      ? nativeLifecycleEvents(record as NativeRecord)
      : planningLineageEventsFor(snapshot, subject, record as CanonicalSubjectRecord),
    sections: sectionsFor(snapshot, lineage, record, entryId),
    ...(workRegion === undefined ? {} : { workRegion }),
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
