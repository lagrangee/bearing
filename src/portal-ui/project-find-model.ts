import Fuse from "fuse.js";
import type { PlanningLineageSubject } from "../planning-lineage-route";
import { planningLineageSubjectHref } from "../planning-lineage-route";
import type { Effort, ProjectGeneration } from "../project-generation/contract";
import { assessSelectedProviderObservationEvidence } from "../provider-evidence-contract";
import {
  type MattNativeRecord,
  mattNativeRecords,
} from "../providers/matt-skills-v1/native-read-model";
import { mattNativeScopeKey } from "../providers/matt-skills-v1/native-subject";

const FIND_RESULT_LIMIT = 20;
const CJK_SEGMENTER =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : undefined;
const NON_CJK_TOKEN_PATTERN = /[\p{L}\p{N}_:-]+/gu;
const CJK_TOKEN_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export type ProjectFindSubject =
  | PlanningLineageSubject
  | Readonly<{ kind: "audit"; id: "planning-audit:current" }>;

export type FindDocument = Readonly<{
  id: string;
  subject: ProjectFindSubject;
  subjectType: string;
  title: string;
  parentPath: readonly string[];
}>;

export type ProjectFindResult = Omit<FindDocument, "id"> &
  Readonly<{
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

const trustedEfforts = (snapshot: ProjectGeneration): readonly Effort[] =>
  snapshot.efforts.validity === "invalid" ? [] : snapshot.efforts.items;

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
      impact: "Other managed content remains searchable; Audit detail is not available yet.",
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

type NativeObservation = ProjectGeneration["providerObservations"][number];

// Bound selection is authoritative even when it has no readable observation.
// Detail evidence can fill only an otherwise unselected scope.
const nativeObservations = (snapshot: ProjectGeneration): readonly NativeObservation[] => {
  const byScope = new Map<string, NativeObservation | undefined>();
  for (const [observations, selections] of [
    [snapshot.providerObservations, snapshot.providerObservationSelections],
    [snapshot.providerDetailEvidences.observations, snapshot.providerDetailEvidences.selections],
  ] as const) {
    const byId = new Map(observations.map((observation) => [observation.id, observation]));
    for (const selection of selections) {
      const key = mattNativeScopeKey(selection);
      if (!byScope.has(key)) {
        byScope.set(
          key,
          selection.observationId === null ? undefined : byId.get(selection.observationId),
        );
      }
    }
  }
  return [...byScope.values()].filter(
    (observation): observation is NativeObservation => observation !== undefined,
  );
};

const nativeType = (record: MattNativeRecord): string => {
  if (record.recordKind === "native-scope") return "Work Scope";
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
};

export const buildProjectFindDocuments = (
  snapshot: ProjectGeneration,
  _entryId: string,
): readonly FindDocument[] => {
  const records = new Map<string, Readonly<{ title: string; subjectType: string }>>();
  for (const [kind, subjectType, collection] of [
    ["roadmap", "Roadmap", snapshot.roadmaps],
    ["gate", "Gate", snapshot.gates],
    ["effort", "Effort", snapshot.efforts],
    ["authority", "Authority", snapshot.authorities],
    ["planning-review", "Planning Review", snapshot.reviews],
    ["asset", "Asset", snapshot.assets],
  ] as const) {
    if (collection.validity === "invalid") continue;
    for (const record of collection.items) {
      records.set(`${kind}:${record.id}`, { title: record.title, subjectType });
    }
  }
  const managedScopes = new Set(
    trustedEfforts(snapshot).flatMap((effort) =>
      effort.workBindingState.state === "bound" && effort.workBinding !== undefined
        ? [mattNativeScopeKey(effort.workBinding)]
        : [],
    ),
  );
  for (const record of mattNativeRecords(nativeObservations(snapshot), snapshot.sources)) {
    if (!managedScopes.has(mattNativeScopeKey(record.observation.binding))) continue;
    const kind = record.recordKind === "native-scope" ? "native-scope" : "native-subject";
    const subjectType = nativeType(record);
    const title = record.title === record.id ? subjectType : record.title;
    records.set(`${kind}:${record.id}`, { title, subjectType });
  }
  const projectTitle =
    snapshot.summary.validity === "available" || snapshot.summary.validity === "partial"
      ? snapshot.summary.value.title
      : "Project";
  const documents = snapshot.lineage.subjects.flatMap((lineage): FindDocument[] => {
    const subject = lineage.identity;
    const id = `${subject.kind}:${subject.id}`;
    const record = records.get(id);
    // Both a typed lineage identity and trustworthy detail record are required.
    // Partial/stale context remains readable; it is disclosed by scopeState.
    if (record === undefined) return [];
    return [
      {
        id,
        subject,
        ...record,
        title: subject.kind === "native-scope" ? "Contributing Work" : record.title,
        parentPath: [
          projectTitle,
          ...(subject.kind === "asset" ? ["Assets"] : []),
          ...lineage.parentPath.ancestors.map(
            (ancestor) => records.get(`${ancestor.kind}:${ancestor.id}`)?.title ?? ancestor.id,
          ),
        ],
      },
    ];
  });
  return [
    ...documents,
    {
      id: "audit:planning-audit:current",
      subject: { kind: "audit", id: "planning-audit:current" },
      subjectType: "Audit",
      title: "Planning Audit",
      parentPath: [],
    },
  ];
};

export const buildProjectFindIndexFromDocuments = (
  documents: readonly FindDocument[],
  entryId: string,
  fingerprint: string,
  scopeState: ProjectFindScopeState,
): ProjectFindIndex => {
  const fuse = new Fuse(
    documents.map((document) => ({
      title: normalizeTerm(document.title),
    })),
    {
      keys: ["title"],
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.36,
      minMatchCharLength: 1,
    },
  );
  return {
    fingerprint,
    documentCount: documents.length,
    scopeState,
    search: (query) => {
      const tokens = tokenizeProjectFindText(query.trim());
      if (tokens.length === 0) return [];
      const candidates = new Map<number, { score: number; termCount: number }>();
      for (const token of tokens) {
        for (const result of fuse.search(token)) {
          const current = candidates.get(result.refIndex);
          candidates.set(result.refIndex, {
            score: (current?.score ?? 0) + (result.score ?? 1),
            termCount: (current?.termCount ?? 0) + 1,
          });
        }
      }
      return [...candidates.entries()]
        .filter(([, candidate]) => candidate.termCount === tokens.length)
        .flatMap(([index, candidate]): ProjectFindResult[] => {
          const document = documents[index];
          if (document === undefined) return [];
          return [
            {
              subject: document.subject,
              subjectType: document.subjectType,
              title: document.title,
              parentPath: document.parentPath,
              href:
                document.subject.kind === "audit"
                  ? `/projects/${encodeURIComponent(entryId)}/audit`
                  : planningLineageSubjectHref(entryId, document.subject),
              score: candidate.score,
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
