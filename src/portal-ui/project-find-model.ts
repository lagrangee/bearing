import Fuse from "fuse.js";
import type { PlanningLineageSubject } from "../planning-lineage-route";
import { planningLineageSubjectHref } from "../planning-lineage-route";
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
import { mattNativeScopeKey } from "../providers/matt-skills-v1/native-subject";
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

type FindFieldKey =
  | "identity"
  | "title"
  | "intent"
  | "criteria"
  | "passage"
  | "decision"
  | "nativeBody"
  | "summary";

type FindField = Readonly<{
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

type FindDocument = Readonly<{
  id: string;
  subject: PlanningLineageSubject;
  subjectType: string;
  title: string;
  parentPath: readonly string[];
  fields: readonly FindField[];
}>;

export type ProjectFindResult = Readonly<{
  subject: PlanningLineageSubject;
  subjectType: string;
  title: string;
  parentPath: readonly string[];
  matchedField: string;
  excerpt: string;
  href: string;
  semanticAnchor?: string | undefined;
  anchorAvailability: "available" | "unavailable";
  score: number;
}>;

export type ProjectFindIndex = Readonly<{
  fingerprint: string;
  documentCount: number;
  search: (query: string) => readonly ProjectFindResult[];
}>;

const subjectTypeLabel = (kind: PlanningLineageSubject["kind"]): string => {
  switch (kind) {
    case "roadmap":
      return "Roadmap";
    case "gate":
      return "Gate";
    case "effort":
      return "Effort";
    case "authority":
      return "Authority";
    case "alignment-check":
      return "Alignment Check";
    case "planning-review":
      return "Planning Review";
    case "asset":
      return "Asset";
    case "native-scope":
      return "Native Scope";
    case "native-subject":
      return "Native Subject";
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
  snapshot: ProjectSnapshot,
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
    case "alignment-check":
      return snapshot.checks.validity === "invalid" ? [] : snapshot.checks.items;
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
  snapshot: ProjectSnapshot,
  subject: PlanningLineageSubject,
): T | undefined =>
  itemsFor(snapshot, subject.kind).find((item) => String(item.id) === subject.id) as T | undefined;

type NativeObservation =
  | ProjectSnapshot["providerObservations"][number]
  | ProjectSnapshot["nativeScopeInspections"]["observations"][number];

const nativeObservations = (snapshot: ProjectSnapshot): readonly NativeObservation[] => {
  const byScope = new Map<string, NativeObservation>();
  for (const observation of snapshot.nativeScopeInspections.observations) {
    byScope.set(mattNativeScopeKey(observation.binding), observation);
  }
  for (const observation of snapshot.providerObservations) {
    byScope.set(mattNativeScopeKey(observation.binding), observation);
  }
  return [...byScope.values()];
};

const nativeRecordFor = (
  snapshot: ProjectSnapshot,
  subject: PlanningLineageSubject,
): MattNativeRecord | undefined =>
  mattNativeRecords(nativeObservations(snapshot), snapshot.sources).find(
    (record) => record.id === subject.id,
  );

const semanticAnchorState = (
  snapshot: ProjectSnapshot,
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
  snapshot: ProjectSnapshot,
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
  snapshot: ProjectSnapshot,
  subject: PlanningLineageSubject,
): readonly FindField[] => {
  const record = canonicalRecordFor<
    Roadmap | MilestoneGate | Effort | Authority | AlignmentCheck | PlanningReview | AssetProjection
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
        contentField(snapshot, subject, {
          key: "decision",
          label: "Adoption decisions",
          text: authority.adoptions.map((adoption) => adoption.decisionReference).join(" · "),
          anchor: "authority.adoption-decisions",
        }),
      );
      break;
    }
    case "alignment-check":
    case "planning-review": {
      const decision = record as AlignmentCheck | PlanningReview;
      const prefix = subject.kind;
      fields.push(
        contentField(snapshot, subject, {
          key: "summary",
          label: "Scope / target",
          text: "target" in decision ? decision.target : decision.scope,
          anchor: `${prefix}.${"target" in decision ? "target" : "scope"}`,
        }),
        contentField(snapshot, subject, {
          key: "decision",
          label: "Accepted decision",
          text: decision.resolution?.acceptedDecision ?? "",
          anchor: `${prefix}.resolution`,
        }),
        contentField(snapshot, subject, {
          key: "summary",
          label: "Rationale",
          text: decision.resolution?.rationale ?? "",
          anchor: `${prefix}.rationale`,
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
          text: join([asset.kind, asset.owner, asset.producer.name, asset.producedFor ?? ""]),
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
  snapshot: ProjectSnapshot,
  subject: PlanningLineageSubject,
  object: MattMap | MattSpec | MattWayfinderTicket | MattDeliveryTicket | MattIncomingIssue,
): readonly FindField[] => {
  const fields: (FindField | undefined)[] = [];
  switch (object.kind) {
    case "map":
      fields.push(
        contentField(snapshot, subject, {
          key: "intent",
          label: "Destination",
          text: object.destination,
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
        ...object.sections.map((section) =>
          section.availability === "available"
            ? contentField(snapshot, subject, {
                key: "nativeBody",
                label: section.title,
                text: section.body,
                anchor: `spec.${section.role}`,
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
          text: object.question,
          anchor: "wayfinder.question",
        }),
        object.answer.availability === "available"
          ? contentField(snapshot, subject, {
              key: "nativeBody",
              label: "Answer",
              text: object.answer.content.body,
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
  snapshot: ProjectSnapshot,
  subject: PlanningLineageSubject,
  title: string,
): readonly FindField[] => {
  const fields: FindField[] = [
    { key: "identity", label: "Identity", text: subject.id },
    { key: "title", label: "Title", text: boundedText(title) },
  ];
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
      key: "identity",
      label: "Identity",
      text: document.subject.id,
    }
  );
};

export const buildProjectFindDocuments = (
  snapshot: ProjectSnapshot,
  entryId: string,
): readonly FindDocument[] =>
  snapshot.lineage.subjects.flatMap((lineageSubject) => {
    const subject = lineageSubject.identity;
    const model = buildPlanningLineageSubjectModel(snapshot, subject, entryId);
    if (model.state !== "available" && model.state !== "partial") return [];
    const fields = findFieldsFor(snapshot, subject, model.subject.title);
    return [
      {
        id: `${subject.kind}:${subject.id}`,
        subject,
        subjectType: subjectTypeLabel(subject.kind),
        title: model.subject.title,
        parentPath: model.parentPath.map((crumb) => crumb.label),
        fields,
      },
    ];
  });

export const buildProjectFindIndex = (
  snapshot: ProjectSnapshot,
  entryId: string,
): ProjectFindIndex => {
  const documents = buildProjectFindDocuments(snapshot, entryId);
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
    fingerprint: snapshot.basis.sitemapFingerprint,
    documentCount: documents.length,
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
          const baseHref = planningLineageSubjectHref(entryId, document.subject);
          const href =
            matchedField.anchor !== undefined && matchedField.anchorAvailable === true
              ? planningLineageSubjectHref(entryId, document.subject, matchedField.anchor)
              : baseHref;
          return [
            {
              subject: document.subject,
              subjectType: document.subjectType,
              title: document.title,
              parentPath: document.parentPath,
              matchedField: matchedField.label,
              excerpt: excerptFor(matchedField.text, trimmed),
              href,
              ...(matchedField.anchor === undefined ? {} : { semanticAnchor: matchedField.anchor }),
              anchorAvailability:
                matchedField.anchor === undefined || matchedField.anchorAvailable === true
                  ? ("available" as const)
                  : ("unavailable" as const),
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
