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
import {
  type PlanningLineageEvent,
  planningLineageEventsFor,
  planningLineageRelationEvent,
} from "./planning-lineage-events";

const RELATION_PREVIEW_LIMIT = 3;

type SubjectRecord =
  | Roadmap
  | MilestoneGate
  | Effort
  | Authority
  | AlignmentCheck
  | PlanningReview
  | AssetProjection;

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
  items?: readonly string[] | undefined;
}>;

export type PlanningLineageParentCrumb = Readonly<{
  label: string;
  href?: string | undefined;
  reference?: string | undefined;
}>;

type ReadablePlanningLineageSubjectModel = Readonly<{
  state: "available" | "partial";
  subject: Readonly<{
    kind: PlanningLineageSubject["kind"];
    id: string;
    title: string;
    source?: SourceRecord | undefined;
  }>;
  parentPath: readonly PlanningLineageParentCrumb[];
  parentNotice?: string | undefined;
  events: readonly PlanningLineageEvent[];
  sections: readonly PlanningLineageSection[];
  semanticAvailability: ReadonlyMap<string, "available" | "confirmed-empty" | "unavailable">;
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
    ownerRecord === undefined
      ? undefined
      : planningLineageRelationEvent(
          snapshot,
          owner,
          ownerRecord,
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

const roadmapSections = (
  snapshot: ProjectSnapshot,
  roadmap: Roadmap,
): readonly PlanningLineageSection[] => {
  const gateLabels = roadmap.gateOrder.map((id) => {
    const gate = recordFor(snapshot, { kind: "gate", id });
    return gate?.title ?? `${id} · unavailable`;
  });
  const focused =
    roadmap.focusedGateId === null
      ? "No focused Gate"
      : (recordFor(snapshot, { kind: "gate", id: roadmap.focusedGateId })?.title ??
        `${roadmap.focusedGateId} · unavailable`);
  return [
    { anchor: "roadmap.intent", title: "Intent", body: roadmap.intent },
    {
      anchor: "roadmap.gates",
      title: "Complete Gate order",
      items: gateLabels.length === 0 ? ["No Gates in the declared horizon."] : gateLabels,
    },
    {
      anchor: "roadmap.focus",
      title: "Focused Gate summary",
      body: `${focused}. Lifecycle ${roadmap.lifecycle}; horizon ${roadmap.horizon}.`,
    },
  ];
};

const gateSections = (gate: MilestoneGate): readonly PlanningLineageSection[] => [
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
      title: "Contributing Work",
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

const assetSections = (asset: AssetProjection): readonly PlanningLineageSection[] => {
  const evidenceRoles = [
    ...(asset.kind === "execution-evidence" ? ["Execution Evidence"] : []),
    ...(asset.citations.length > 0 ? ["Planning Citation"] : []),
    ...(asset.adoptedByAuthorityIds.length > 0 ? ["Authority Adoption"] : []),
    ...(asset.gatePassageEvidenceFor.length > 0 ? ["Passage Evidence"] : []),
  ];
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
      body: `${asset.displayLocation} · Producer ${asset.producer.kind} / ${asset.producer.name}.`,
      items: [`Owner: ${asset.owner}`, `Produced For: ${asset.producedFor ?? "Not declared"}`],
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
      body: `Preview capability is unavailable in the current typed contract. Content availability is ${asset.contentAvailability}.`,
    },
  ];
};

const sectionsFor = (
  snapshot: ProjectSnapshot,
  lineage: PlanningLineageSubjectProjection,
  record: SubjectRecord,
): readonly PlanningLineageSection[] => {
  switch (lineage.identity.kind) {
    case "roadmap":
      return roadmapSections(snapshot, record as Roadmap);
    case "gate":
      return gateSections(record as MilestoneGate);
    case "effort":
      return effortSections(record as Effort, lineage);
    case "authority":
      return authoritySections(record as Authority);
    case "alignment-check":
      return alignmentCheckSections(record as AlignmentCheck);
    case "planning-review":
      return planningReviewSections(record as PlanningReview);
    case "asset":
      return assetSections(record as AssetProjection);
  }
};

const parentPathForDisplay = (
  snapshot: ProjectSnapshot,
  entryId: string,
  lineage: PlanningLineageSubjectProjection,
  record: SubjectRecord,
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
  return [
    project,
    ...collection,
    ...ancestors,
    { label: record.title, reference: lineage.identity.id },
  ];
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
  const degraded =
    collection.validity === "partial" ||
    lineage.parentPath.state !== "complete" ||
    lineage.semanticSections.some((section) => section.availability === "unavailable") ||
    lineage.relations.some(
      (relation) => relation.state === "unknown" || relation.state === "unavailable",
    );
  return {
    state: degraded ? "partial" : "available",
    subject: {
      kind: subject.kind,
      id: subject.id,
      title: record.title,
      source: sourceIndex(snapshot).get(record.source),
    },
    parentPath: parentPathForDisplay(snapshot, entryId, lineage, record),
    ...(lineage.parentPath.state === "complete"
      ? {}
      : {
          parentNotice: `${lineage.parentPath.reason ?? "Canonical parentage is unavailable."} The path stops at the last trustworthy ancestor.`,
        }),
    events: planningLineageEventsFor(snapshot, subject, record),
    sections: sectionsFor(snapshot, lineage, record),
    semanticAvailability,
    relations,
  };
};

export const planningLineageRelationFor = (
  model: Extract<PlanningLineageSubjectModel, { state: "available" | "partial" }>,
  key: PlanningLineageRelationKey,
): PlanningLineageRelation | undefined => model.relations.find((relation) => relation.key === key);
