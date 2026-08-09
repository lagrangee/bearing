import Fuse from "fuse.js";
import { documentPresentationBlocksPlainText } from "../document-presentation";
import type { PlanningLineageSubject } from "../planning-lineage-route";
import { planningLineageSubjectHref } from "../planning-lineage-route";
import type {
  AssetProjection,
  Authority,
  Effort,
  MilestoneGate,
  PlanningReview,
  ProjectGeneration,
  Roadmap,
} from "../project-generation/contract";
import { assessSelectedProviderObservationEvidence } from "../provider-evidence-contract";
import type {
  MattDeliveryTicket,
  MattIncomingIssue,
  MattMap,
  MattSpec,
  MattWayfinderTicket,
} from "../providers/matt-skills-v1/model";
import {
  type MattNativeRecord,
  mattNativeRecords,
} from "../providers/matt-skills-v1/native-read-model";
import {
  mattNativeScopeKey,
  mattNativeScopeSubject,
} from "../providers/matt-skills-v1/native-subject";
import { buildPlanningLineageSubjectModel } from "./planning-lineage-model";

const FIND_RESULT_LIMIT = 20;
const MAX_INDEXED_FIELD_LENGTH = 16_384;
const CJK_SEGMENTER =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : undefined;
const NON_CJK_TOKEN_PATTERN = /[\p{L}\p{N}_:-]+/gu;
const CJK_TOKEN_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export type FindFieldKey =
  | "identity"
  | "title"
  | "intent"
  | "criteria"
  | "passage"
  | "decision"
  | "nativeBody"
  | "summary";

export type FindField = Readonly<{
  key: FindFieldKey;
  label: string;
  text: string;
  anchor?: string | undefined;
  anchorAvailable?: boolean | undefined;
}>;

type FuseFindDocument = Readonly<{
  identity: string;
  title: string;
  intent: string;
  criteria: string;
  passage: string;
  decision: string;
  nativeBody: string;
  summary: string;
}>;

export type FindDocument = Readonly<{
  id: string;
  subject: ProjectFindSubject;
  subjectType: string;
  title: string;
  parentPath: readonly string[];
  fields: readonly FindField[];
  fallbackExcerpt: string;
}>;

export type ProjectFindSubject =
  | PlanningLineageSubject
  | Readonly<{ kind: "audit"; id: "planning-audit:current" }>;

export type ProjectFindResult = Readonly<{
  subject: ProjectFindSubject;
  subjectType: string;
  title: string;
  parentPath: readonly string[];
  excerpt: string;
  href: string;
  score: number;
}>;

export type ProjectFindScopeState =
  | Readonly<{ state: "available" }>
  | Readonly<{
      state: "invalid" | "partial" | "stale" | "unavailable";
      cause: string;
      impact: string;
      nextStep: string;
    }>;

export type ProjectFindIndex = Readonly<{
  fingerprint: string;
  documentCount: number;
  scopeState: ProjectFindScopeState;
  search: (query: string) => readonly ProjectFindResult[];
}>;

const subjectTypeLabel = (snapshot: ProjectGeneration, subject: ProjectFindSubject): string => {
  switch (subject.kind) {
    case "audit":
      return "Audit";
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
      return "Work Scope";
    case "native-subject": {
      const record = nativeRecordFor(snapshot, subject);
      if (record?.recordKind !== "native-object") return "Bound Work";
      switch (record.object.kind) {
        case "map":
          return "Map";
        case "spec":
          return "Spec";
        case "wayfinder-ticket":
          return "Wayfinder";
        case "delivery-ticket":
          return "Delivery";
        case "incoming-issue":
          return "Incoming";
      }
    }
  }
};

const normalizeTerm = (term: string): string => term.normalize("NFKC").toLocaleLowerCase();

export const tokenizeProjectFindText = (text: string): readonly string[] => {
  const tokens = new Set<string>();
  if (CJK_SEGMENTER !== undefined) {
    for (const part of CJK_SEGMENTER.segment(text)) {
      if (part.isWordLike) tokens.add(normalizeTerm(part.segment));
    }
  }
  for (const match of text.matchAll(NON_CJK_TOKEN_PATTERN)) {
    const token = normalizeTerm(match[0]);
    if (!CJK_TOKEN_PATTERN.test(token) && token.length > 0) tokens.add(token);
  }
  if (CJK_SEGMENTER === undefined) {
    for (const character of text) {
      if (CJK_TOKEN_PATTERN.test(character)) tokens.add(character);
    }
  }
  return [...tokens];
};

const boundedText = (text: string): string => text.slice(0, MAX_INDEXED_FIELD_LENGTH);

const itemsFor = (
  snapshot: ProjectGeneration,
  kind: PlanningLineageSubject["kind"],
): readonly Readonly<{ id: string; title: string }>[] => {
  switch (kind) {
    case "roadmap":
      return snapshot.roadmaps.validity === "invalid" ? [] : snapshot.roadmaps.items;
    case "gate":
      return snapshot.gates.validity === "invalid" ? [] : snapshot.gates.items;
    case "effort":
      return snapshot.efforts.validity === "invalid" ? [] : snapshot.efforts.items;
    case "authority":
      return snapshot.authorities.validity === "invalid" ? [] : snapshot.authorities.items;
    case "planning-review":
      return snapshot.reviews.validity === "invalid" ? [] : snapshot.reviews.items;
    case "asset":
      return snapshot.assets.validity === "invalid" ? [] : snapshot.assets.items;
    case "native-scope":
    case "native-subject":
      return [];
  }
};

const canonicalRecordFor = <T extends Readonly<{ id: string }>>(
  snapshot: ProjectGeneration,
  subject: PlanningLineageSubject,
): T | undefined =>
  itemsFor(snapshot, subject.kind).find((item) => String(item.id) === subject.id) as T | undefined;

type NativeObservation = ProjectGeneration["providerObservations"][number];

const nativeObservations = (snapshot: ProjectGeneration): readonly NativeObservation[] => {
  const selected = (
    observations: readonly NativeObservation[],
    selections: ProjectGeneration["providerObservationSelections"],
  ): readonly NativeObservation[] => {
    const byId = new Map(observations.map((observation) => [observation.id, observation]));
    return selections.flatMap((selection) => {
      if (selection.observationId === null) return [];
      const observation = byId.get(selection.observationId);
      return observation === undefined ? [] : [observation];
    });
  };
  const byScope = new Map<string, NativeObservation>();
  for (const observation of selected(
    snapshot.providerObservations,
    snapshot.providerObservationSelections,
  )) {
    byScope.set(mattNativeScopeKey(observation.binding), observation);
  }
  for (const observation of selected(
    snapshot.providerDetailEvidences.observations,
    snapshot.providerDetailEvidences.selections,
  )) {
    const scopeKey = mattNativeScopeKey(observation.binding);
    if (!byScope.has(scopeKey)) byScope.set(scopeKey, observation);
  }
  return [...byScope.values()];
};

const trustedEfforts = (snapshot: ProjectGeneration): readonly Effort[] =>
  snapshot.efforts.validity === "invalid" ? [] : snapshot.efforts.items;

const managedNativeSubjectKeys = (snapshot: ProjectGeneration): ReadonlySet<string> => {
  const keys = new Set<string>();
  const observations = nativeObservations(snapshot);
  for (const effort of trustedEfforts(snapshot)) {
    if (effort.workBindingState.state !== "bound") continue;
    const binding = effort.workBinding;
    if (binding === undefined) continue;
    const scopeSubject = mattNativeScopeSubject({ binding });
    keys.add(`${scopeSubject.kind}:${scopeSubject.id}`);
    for (const record of mattNativeRecords(
      observations.filter(
        (observation) => mattNativeScopeKey(observation.binding) === mattNativeScopeKey(binding),
      ),
      snapshot.sources,
    )) {
      keys.add(`native-subject:${record.id}`);
    }
  }
  return keys;
};

export const projectFindScopeState = (snapshot: ProjectGeneration): ProjectFindScopeState => {
  const canonicalCollections = [
    ["Roadmap", snapshot.roadmaps],
    ["Gate", snapshot.gates],
    ["Effort", snapshot.efforts],
    ["Authority", snapshot.authorities],
    ["Planning Review", snapshot.reviews],
    ["Asset", snapshot.assets],
  ] as const;
  const invalid = canonicalCollections.find(([, collection]) => collection.validity === "invalid");
  if (invalid !== undefined || snapshot.audit.validity === "invalid") {
    const label = invalid?.[0] ?? "Audit";
    return {
      state: "invalid",
      cause: `${label} content is unavailable.`,
      impact: "Readable managed content remains searchable, but results can omit that area.",
      nextStep: "Close Find and repair the affected project source in Agent Surface.",
    };
  }
  const partial = canonicalCollections.find(([, collection]) => collection.validity === "partial");
  if (partial !== undefined || snapshot.audit.validity === "partial") {
    const label = partial?.[0] ?? "Audit";
    return {
      state: "partial",
      cause: `${label} coverage is incomplete.`,
      impact: "Confirmed managed content remains searchable, but some results may be missing.",
      nextStep: "Close Find and complete the affected project source in Agent Surface.",
    };
  }
  if (snapshot.audit.validity === "absent") {
    return {
      state: "unavailable",
      cause: "No current Audit is available.",
      impact: "Other managed content remains searchable; Audit findings cannot be searched yet.",
      nextStep: "Close Find and open Audit for the Agent Surface resume instructions.",
    };
  }
  if (
    snapshot.audit.value.semanticFreshness !== "current" ||
    snapshot.audit.value.coverage !== "complete"
  ) {
    return {
      state: snapshot.audit.value.semanticFreshness === "stale" ? "stale" : "partial",
      cause:
        snapshot.audit.value.semanticFreshness === "stale"
          ? "Audit content is stale."
          : "Audit coverage is incomplete.",
      impact: "Current managed content remains searchable, but Audit results may be incomplete.",
      nextStep: "Close Find and open Audit for the Agent Surface resume instructions.",
    };
  }
  const observationGroups = [
    [snapshot.providerObservations, snapshot.providerObservationSelections],
    [snapshot.providerDetailEvidences.observations, snapshot.providerDetailEvidences.selections],
  ] as const;
  for (const effort of trustedEfforts(snapshot)) {
    if (effort.workBindingState.state !== "bound") continue;
    const binding = effort.workBinding;
    if (binding === undefined) continue;
    let assessment: ReturnType<typeof assessSelectedProviderObservationEvidence> | undefined;
    for (const [observations, selections] of observationGroups) {
      const selection = selections.find(
        (candidate) => mattNativeScopeKey(candidate) === mattNativeScopeKey(binding),
      );
      const observation =
        selection?.observationId === null || selection?.observationId === undefined
          ? undefined
          : observations.find((candidate) => candidate.id === selection.observationId);
      if (selection !== undefined || observation !== undefined) {
        assessment = assessSelectedProviderObservationEvidence(observation, selection);
        break;
      }
    }
    if (assessment === undefined || assessment.projectionState === "missing") {
      return {
        state: "unavailable",
        cause: "A bound work scope has no readable current detail.",
        impact: "Other managed content remains searchable; results can omit that bound scope.",
        nextStep:
          "Close Find and open the affected bound work from Roadmaps to inspect its details.",
      };
    }
    if (assessment.projectionState === "invalid" || assessment.blockingDiagnosticCount > 0) {
      return {
        state: "invalid",
        cause: "A bound work scope has invalid detail.",
        impact: "Other managed content remains searchable; results omit untrusted scope detail.",
        nextStep:
          "Close Find and open the affected bound work from Roadmaps to inspect or retry its details.",
      };
    }
    if (assessment.freshness !== "current") {
      return {
        state: assessment.freshness === "stale" ? "stale" : "unavailable",
        cause:
          assessment.freshness === "stale"
            ? "A bound work scope is stale."
            : "A bound work scope has undetermined freshness.",
        impact:
          "Readable managed context remains searchable, but current scope results may be missing.",
        nextStep:
          "Close Find and open the affected bound work from Roadmaps to inspect or retry its details.",
      };
    }
    if (assessment.projectionState === "partial" || assessment.coverage !== "complete") {
      return {
        state: "partial",
        cause: "A bound work scope has incomplete coverage.",
        impact:
          "Confirmed managed context remains searchable, but some scope results may be missing.",
        nextStep:
          "Close Find and open the affected bound work from Roadmaps to inspect or retry its details.",
      };
    }
  }
  return { state: "available" };
};

const nativeRecordFor = (
  snapshot: ProjectGeneration,
  subject: PlanningLineageSubject,
): MattNativeRecord | undefined =>
  mattNativeRecords(nativeObservations(snapshot), snapshot.sources).find(
    (record) => record.id === subject.id,
  );

const semanticAnchorState = (
  snapshot: ProjectGeneration,
  subject: PlanningLineageSubject,
  anchor: string,
): "available" | "unavailable" | "excluded" => {
  const lineage = snapshot.lineage.subjects.find(
    (candidate) => candidate.identity.kind === subject.kind && candidate.identity.id === subject.id,
  );
  const semanticSection = lineage?.semanticSections.find((section) => section.role === anchor);
  if (
    semanticSection?.availability === "unavailable" ||
    semanticSection?.availability === "unsupported" ||
    semanticSection?.availability === "confirmed-empty"
  ) {
    return "excluded";
  }
  return semanticSection?.availability === "available" ? "available" : "unavailable";
};

const contentField = (
  snapshot: ProjectGeneration,
  subject: PlanningLineageSubject,
  input: Omit<FindField, "anchorAvailable"> & Readonly<{ anchor: string }>,
): FindField | undefined => {
  const text = boundedText(input.text.trim());
  if (text.length === 0) return undefined;
  const anchorState = semanticAnchorState(snapshot, subject, input.anchor);
  if (anchorState === "excluded") return undefined;
  return { ...input, text, anchorAvailable: anchorState === "available" };
};

const join = (values: readonly string[]): string =>
  values.filter((value) => value.length > 0).join(" · ");

const canonicalFields = (
  snapshot: ProjectGeneration,
  subject: PlanningLineageSubject,
): readonly FindField[] => {
  const record = canonicalRecordFor<
    Roadmap | MilestoneGate | Effort | Authority | PlanningReview | AssetProjection
  >(snapshot, subject);
  if (record === undefined) return [];
  const fields: (FindField | undefined)[] = [];
  switch (subject.kind) {
    case "roadmap": {
      const roadmap = record as Roadmap;
      fields.push(
        contentField(snapshot, subject, {
          key: "intent",
          label: "Intent",
          text: roadmap.intent,
          anchor: "roadmap.intent",
        }),
        contentField(snapshot, subject, {
          key: "summary",
          label: "Gate order",
          text: join(roadmap.gateOrder),
          anchor: "roadmap.gates",
        }),
        contentField(snapshot, subject, {
          key: "summary",
          label: "Lifecycle and horizon",
          text: join([roadmap.lifecycle, roadmap.horizon]),
          anchor: "roadmap.focus",
        }),
      );
      break;
    }
    case "gate": {
      const gate = record as MilestoneGate;
      fields.push(
        contentField(snapshot, subject, {
          key: "intent",
          label: "Intent",
          text: gate.intent,
          anchor: "gate.intent",
        }),
        contentField(snapshot, subject, {
          key: "criteria",
          label: "Exit criteria",
          text: gate.exitCriteria.join(" · "),
          anchor: "gate.exit-criteria",
        }),
        contentField(snapshot, subject, {
          key: "summary",
          label: "Lifecycle and readiness",
          text: join([gate.lifecycle, gate.horizonState, gate.readiness]),
          anchor: "gate.readiness",
        }),
        gate.passage === undefined
          ? undefined
          : contentField(snapshot, subject, {
              key: "passage",
              label: "Accepted decision",
              text: join([gate.passage.acceptedDecision, gate.passage.rationale]),
              anchor: "gate.passage",
            }),
      );
      break;
    }
    case "effort": {
      const effort = record as Effort;
      fields.push(
        contentField(snapshot, subject, {
          key: "intent",
          label: "Intent",
          text: effort.intent,
          anchor: "effort.intent",
        }),
        contentField(snapshot, subject, {
          key: "summary",
          label: "Lifecycle",
          text: join([effort.lifecycle, effort.conclusion?.disposition ?? ""]),
          anchor: "effort.lifecycle",
        }),
      );
      break;
    }
    case "authority": {
      const authority = record as Authority;
      fields.push(
        contentField(snapshot, subject, {
          key: "summary",
          label: "Scope",
          text: authority.scope,
          anchor: "authority.scope",
        }),
      );
      break;
    }
    case "planning-review": {
      const decision = record as PlanningReview;
      fields.push(
        contentField(snapshot, subject, {
          key: "summary",
          label: "Question",
          text: decision.question,
          anchor: "planning-review.question",
        }),
        contentField(snapshot, subject, {
          key: "summary",
          label: "Scope",
          text: decision.scope.kind === "project" ? "Whole project" : decision.scope.target,
          anchor: "planning-review.scope",
        }),
        contentField(snapshot, subject, {
          key: "decision",
          label: "Accepted decision",
          text: decision.resolution?.acceptedDecision ?? "",
          anchor: "planning-review.resolution",
        }),
        contentField(snapshot, subject, {
          key: "summary",
          label: "Rationale",
          text: decision.resolution?.rationale ?? "",
          anchor: "planning-review.rationale",
        }),
      );
      break;
    }
    case "asset": {
      const asset = record as AssetProjection;
      fields.push(
        contentField(snapshot, subject, {
          key: "summary",
          label: "Asset summary",
          text: join([asset.kind, asset.purpose, asset.owner, asset.sourceLocator]),
          anchor: "asset.identity",
        }),
      );
      break;
    }
    case "native-scope":
    case "native-subject":
      break;
  }
  return fields.filter((candidate): candidate is FindField => candidate !== undefined);
};

const nativeContentFields = (
  snapshot: ProjectGeneration,
  subject: PlanningLineageSubject,
  object: MattMap | MattSpec | MattWayfinderTicket | MattDeliveryTicket | MattIncomingIssue,
): readonly FindField[] => {
  const documentText = (
    document: MattMap["destination"] | MattWayfinderTicket["question"],
    role: string,
  ) => {
    const section = document.sections.find((candidate) => candidate.semanticRole === role);
    return section?.availability === "available"
      ? documentPresentationBlocksPlainText(section.blocks)
      : "";
  };
  const fields: (FindField | undefined)[] = [];
  switch (object.kind) {
    case "map":
      fields.push(
        contentField(snapshot, subject, {
          key: "intent",
          label: "Destination",
          text: documentText(object.destination, "map.destination"),
          anchor: "map.destination",
        }),
        contentField(snapshot, subject, {
          key: "decision",
          label: "Decisions",
          text: object.decisions.map((decision) => decision.gist).join(" · "),
          anchor: "map.decisions",
        }),
      );
      break;
    case "spec":
      fields.push(
        ...object.document.sections.map((section) =>
          section.availability === "available"
            ? contentField(snapshot, subject, {
                key: "nativeBody",
                label: section.title,
                text: documentPresentationBlocksPlainText(section.blocks),
                anchor: section.semanticRole ?? section.sourceIdentity,
              })
            : undefined,
        ),
      );
      break;
    case "wayfinder-ticket":
      fields.push(
        contentField(snapshot, subject, {
          key: "intent",
          label: "Question",
          text: documentText(object.question, "wayfinder.question"),
          anchor: "wayfinder.question",
        }),
        object.answer.availability === "available"
          ? contentField(snapshot, subject, {
              key: "nativeBody",
              label: "Answer",
              text: documentText(object.answer.content.document, "wayfinder.answer"),
              anchor: "wayfinder.answer",
            })
          : undefined,
      );
      break;
    case "delivery-ticket":
      fields.push(
        contentField(snapshot, subject, {
          key: "nativeBody",
          label: "What to build",
          text: object.whatToBuild,
          anchor: "delivery.what-to-build",
        }),
        contentField(snapshot, subject, {
          key: "criteria",
          label: "Acceptance criteria",
          text: object.acceptanceCriteria.join(" · "),
          anchor: "delivery.acceptance-criteria",
        }),
      );
      break;
    case "incoming-issue":
      fields.push(
        contentField(snapshot, subject, {
          key: "nativeBody",
          label: "Issue content",
          text: object.content
            .filter((content) => content.role === "issue-body")
            .map((content) => content.body)
            .join(" · "),
          anchor: "incoming.content",
        }),
      );
      break;
  }
  return fields.filter((candidate): candidate is FindField => candidate !== undefined);
};

const findFieldsFor = (
  snapshot: ProjectGeneration,
  subject: ProjectFindSubject,
  title: string,
): readonly FindField[] => {
  const fields: FindField[] = [
    { key: "identity", label: "Identity", text: subject.id },
    { key: "title", label: "Title", text: boundedText(title) },
  ];
  if (subject.kind === "audit") {
    if (snapshot.audit.validity === "available" || snapshot.audit.validity === "partial") {
      fields.push({
        key: "summary",
        label: "Audit findings",
        text: boundedText(
          join([
            `${snapshot.audit.value.coverage} coverage`,
            `${snapshot.audit.value.semanticFreshness} freshness`,
            ...snapshot.audit.value.findings.flatMap((finding) => [
              finding.title,
              finding.summary,
              finding.consequence,
            ]),
          ]),
        ),
        anchor: "audit.findings",
        anchorAvailable: false,
      });
    } else {
      fields.push({
        key: "summary",
        label: "Audit availability",
        text:
          snapshot.audit.validity === "absent"
            ? "No current Audit is available."
            : "Audit content is unavailable.",
      });
    }
    return fields;
  }
  if (subject.kind === "native-scope" || subject.kind === "native-subject") {
    const nativeRecord = nativeRecordFor(snapshot, subject);
    if (nativeRecord?.recordKind === "native-object") {
      fields.push(...nativeContentFields(snapshot, subject, nativeRecord.object));
    }
  } else {
    fields.push(...canonicalFields(snapshot, subject));
  }
  return fields;
};

const fieldValues = (fields: readonly FindField[], key: FindFieldKey): string =>
  fields
    .filter((candidate) => candidate.key === key)
    .map((candidate) => candidate.text)
    .join(" · ");

const toFuseDocument = (document: FindDocument): FuseFindDocument => ({
  identity: fieldValues(document.fields, "identity"),
  title: fieldValues(document.fields, "title"),
  intent: fieldValues(document.fields, "intent"),
  criteria: fieldValues(document.fields, "criteria"),
  passage: fieldValues(document.fields, "passage"),
  decision: fieldValues(document.fields, "decision"),
  nativeBody: fieldValues(document.fields, "nativeBody"),
  summary: fieldValues(document.fields, "summary"),
});

const excerptFor = (text: string, query: string): string => {
  const normalizedText = normalizeTerm(text);
  const queryTokens = tokenizeProjectFindText(query)
    .map(normalizeTerm)
    .sort((left, right) => right.length - left.length);
  const match = queryTokens
    .map((token) => ({ token, index: normalizedText.indexOf(token) }))
    .find((candidate) => candidate.index >= 0);
  if (match === undefined) return `${text.slice(0, 156)}${text.length > 156 ? "…" : ""}`;
  const start = Math.max(0, match.index - 56);
  const end = Math.min(text.length, match.index + match.token.length + 96);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
};

const matchedFieldFor = (
  document: FindDocument,
  matches: readonly Readonly<{ key?: string | undefined }>[],
  query: string,
): FindField => {
  const matchedKeys = new Set(
    matches.flatMap((match) => (match.key === undefined ? [] : [match.key])),
  );
  const queryTokens = tokenizeProjectFindText(query).map(normalizeTerm);
  const queryText = normalizeTerm(query);
  const score = (candidate: FindField): number => {
    const text = normalizeTerm(candidate.text);
    const exactPhrase = text.includes(queryText) ? 10_000 + queryText.length : 0;
    const tokenCoverage = queryTokens.reduce(
      (total, token) => total + (text.includes(token) ? token.length * 10 : 0),
      0,
    );
    const indexedMatch = matchedKeys.has(candidate.key) ? 1 : 0;
    return exactPhrase + tokenCoverage + indexedMatch;
  };
  return (
    [...document.fields]
      .filter((candidate) => matchedKeys.has(candidate.key))
      .sort((left, right) => score(right) - score(left))[0] ??
    document.fields.find((candidate) => candidate.key === "title") ?? {
      key: "title",
      label: "Title",
      text: document.title,
    }
  );
};

const safeDisplayTitle = (
  subject: ProjectFindSubject,
  subjectType: string,
  title: string,
): string =>
  (subject.kind === "native-scope" || subject.kind === "native-subject") && title === subject.id
    ? subjectType
    : title;

const subjectHref = (entryId: string, subject: ProjectFindSubject, anchor?: string): string =>
  subject.kind === "audit"
    ? `/projects/${encodeURIComponent(entryId)}/audit`
    : planningLineageSubjectHref(entryId, subject, anchor);

export const buildProjectFindDocuments = (
  snapshot: ProjectGeneration,
  entryId: string,
): readonly FindDocument[] => {
  const managedNativeSubjects = managedNativeSubjectKeys(snapshot);
  const candidates = new Map(
    snapshot.lineage.subjects.map((lineageSubject) => [
      `${lineageSubject.identity.kind}:${lineageSubject.identity.id}`,
      lineageSubject.identity,
    ]),
  );
  for (const record of mattNativeRecords(nativeObservations(snapshot), snapshot.sources)) {
    const subject: PlanningLineageSubject = {
      kind: record.recordKind === "native-scope" ? "native-scope" : "native-subject",
      id: record.id,
    };
    candidates.set(`${subject.kind}:${subject.id}`, subject);
  }
  const lineageDocuments = [...candidates.values()].flatMap((subject) => {
    if (
      (subject.kind === "native-scope" || subject.kind === "native-subject") &&
      !managedNativeSubjects.has(`${subject.kind}:${subject.id}`)
    ) {
      return [];
    }
    const model = buildPlanningLineageSubjectModel(snapshot, subject, entryId);
    if (model.state !== "available" && model.state !== "partial") return [];
    const subjectType = subjectTypeLabel(snapshot, subject);
    const title = safeDisplayTitle(subject, subjectType, model.subject.title);
    const fields = [...findFieldsFor(snapshot, subject, title)];
    const parentPath = model.parentPath.map((crumb) => crumb.label);
    return [
      {
        id: `${subject.kind}:${subject.id}`,
        subject,
        subjectType,
        title,
        parentPath,
        fields,
        fallbackExcerpt:
          parentPath.length === 0
            ? `${subjectType}: ${title}.`
            : `${subjectType} under ${parentPath.at(-1)}.`,
      },
    ];
  });
  const auditSubject = { kind: "audit", id: "planning-audit:current" } as const;
  return [
    ...lineageDocuments,
    {
      id: `${auditSubject.kind}:${auditSubject.id}`,
      subject: auditSubject,
      subjectType: "Audit",
      title: "Planning Audit",
      parentPath: [],
      fields: findFieldsFor(snapshot, auditSubject, "Planning Audit"),
      fallbackExcerpt: "Planning Audit for this project.",
    },
  ];
};

export const buildProjectFindIndexFromDocuments = (
  documents: readonly FindDocument[],
  entryId: string,
  fingerprint: string,
  scopeState: ProjectFindScopeState,
): ProjectFindIndex => {
  const fuseDocuments = documents.map(toFuseDocument);
  const byIndex = new Map(documents.map((document, index) => [index, document]));
  const fuse = new Fuse(fuseDocuments, {
    keys: [
      { name: "identity", weight: 6 },
      { name: "title", weight: 5 },
      { name: "intent", weight: 3 },
      { name: "criteria", weight: 3 },
      { name: "passage", weight: 3 },
      { name: "decision", weight: 2 },
      { name: "nativeBody", weight: 1 },
      { name: "summary", weight: 1 },
    ],
    includeMatches: true,
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.36,
    minMatchCharLength: 1,
  });
  return {
    fingerprint,
    documentCount: documents.length,
    scopeState,
    search: (query) => {
      const trimmed = query.trim();
      const tokens = tokenizeProjectFindText(trimmed);
      if (tokens.length === 0) return [];
      const candidates = new Map<
        number,
        {
          score: number;
          termCount: number;
          matches: ReadonlyArray<Readonly<{ key?: string | undefined }>>;
        }
      >();
      for (const token of tokens) {
        for (const result of fuse.search(token)) {
          const current = candidates.get(result.refIndex);
          if (current === undefined) {
            candidates.set(result.refIndex, {
              score: result.score ?? 1,
              termCount: 1,
              matches: result.matches ?? [],
            });
          } else {
            candidates.set(result.refIndex, {
              score: current.score + (result.score ?? 1),
              termCount: current.termCount + 1,
              matches: [...current.matches, ...(result.matches ?? [])],
            });
          }
        }
      }
      return [...candidates.entries()]
        .filter(
          ([, candidate]) => candidate.termCount === tokens.length && candidate.matches.length > 0,
        )
        .flatMap(([refIndex, candidate]) => {
          const document = byIndex.get(refIndex);
          if (document === undefined) return [];
          const matchedField = matchedFieldFor(document, candidate.matches, trimmed);
          const excerptField =
            matchedField.key === "identity" || matchedField.key === "title"
              ? (document.fields.find(
                  (field) => field.key !== "identity" && field.key !== "title",
                ) ?? matchedField)
              : matchedField;
          const semanticExcerpt = document.fields.find(
            (field) => field.key !== "identity" && field.key !== "title",
          );
          const baseHref = subjectHref(entryId, document.subject);
          const href =
            matchedField.anchor !== undefined && matchedField.anchorAvailable === true
              ? subjectHref(entryId, document.subject, matchedField.anchor)
              : baseHref;
          return [
            {
              subject: document.subject,
              subjectType: document.subjectType,
              title: document.title,
              parentPath: document.parentPath,
              excerpt: excerptFor(
                excerptField.key === "identity" || excerptField.key === "title"
                  ? (semanticExcerpt?.text ?? document.fallbackExcerpt)
                  : excerptField.text,
                trimmed,
              ),
              href,
              score:
                normalizeTerm(document.subject.id) === normalizeTerm(trimmed)
                  ? -1
                  : candidate.score,
            },
          ];
        })
        .sort(
          (left, right) =>
            left.score - right.score ||
            left.title.localeCompare(right.title) ||
            left.subject.id.localeCompare(right.subject.id),
        )
        .slice(0, FIND_RESULT_LIMIT);
    },
  };
};

export const buildProjectFindIndex = (
  snapshot: ProjectGeneration,
  entryId: string,
): ProjectFindIndex =>
  buildProjectFindIndexFromDocuments(
    buildProjectFindDocuments(snapshot, entryId),
    entryId,
    snapshot.basis.basisFingerprint,
    projectFindScopeState(snapshot),
  );
