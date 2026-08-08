import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { PlanningLineageSubject } from "../planning-lineage-route";
import type { PortalProjectSection } from "../portal-project-read-wire";
import {
  buildProjectFindIndexFromDocuments,
  type ProjectFindScopeState,
} from "../portal-ui/project-find-model";
import type { AssetProjection } from "../project-snapshot/contract";
import { attentionItemSchema, structuralDiagnosticSchema } from "../project-snapshot/schema";
import { planningLineageSubjectProjectionSchema } from "../project-snapshot/schema-planning-lineage";
import { sourceRecordSchema } from "../project-snapshot/source-schema";
import {
  type ProviderObservationSelection,
  providerObservationSelectionFreshnessIsCoherent,
  providerObservationSelectionSchema,
} from "../provider-observation-contract";
import type { MattSkillsV1ProviderObservation } from "../providers/matt-skills-v1/capture";
import { hasCompleteMattNativeEvidence } from "../providers/matt-skills-v1/native-read-model";
import {
  mattNativeScopeKey,
  sameMattNativeBindingDefinition,
} from "../providers/matt-skills-v1/native-subject";
import { mattSkillsV1ProviderObservationSchema } from "../providers/matt-skills-v1/schema";
import {
  assertProjectReadModelObjectIdentity,
  assertProjectReadModelObjectRelationships,
  PROJECT_READ_MODEL_PROJECTION_VERSION,
  type ProjectReadModelProjectionName,
  projectReadModelObjectSchema,
} from "./contract";
import { type ProjectReadModelMetadata, withProjectReadModel } from "./store";

const MAX_PORTAL_ROWS = 500;
const MAX_FIND_RESULTS = 50;
const MAX_FIND_QUERY_LENGTH = 200;

const parseJson = (value: SQLOutputValue | undefined): unknown => {
  if (typeof value !== "string") throw new Error("Project Read Model row is missing.");
  return JSON.parse(value);
};

const boundedRows = (
  database: DatabaseSync,
  statement: string,
  rowKind: string,
  parameters: readonly string[] = [],
): readonly Record<string, SQLOutputValue>[] => {
  const result = database
    .prepare(`${statement} LIMIT ${MAX_PORTAL_ROWS + 1}`)
    .all(...parameters) as readonly Record<string, SQLOutputValue>[];
  if (result.length > MAX_PORTAL_ROWS) {
    throw new Error(`Project Read Model has too many ${rowKind} rows.`);
  }
  return result;
};

const objectKinds: Readonly<Record<PortalProjectSection, readonly string[]>> = {
  overview: [
    "project-summary",
    "project-brief",
    "roadmap",
    "gate",
    "effort",
    "planning-review",
    "portal-projection-state",
    "portal-roadmap-index",
  ],
  roadmaps: [
    "project-summary",
    "roadmap",
    "gate",
    "portal-projection-state",
    "portal-roadmap-index",
  ],
  assets: [
    "project-summary",
    "roadmap",
    "gate",
    "effort",
    "asset",
    "authority",
    "planning-review",
    "portal-reference-title",
    "portal-projection-state",
  ],
  audit: ["project-summary", "planning-review", "portal-projection-state", "portal-audit"],
  lineage: [
    "project-summary",
    "project-brief",
    "portal-projection-state",
    "portal-roadmap-index",
    "portal-audit",
  ],
};

const requiredProjections: Readonly<
  Record<PortalProjectSection, readonly ProjectReadModelProjectionName[]>
> = {
  overview: ["summary", "brief", "roadmaps", "gates", "efforts", "reviews"],
  roadmaps: ["summary", "roadmaps", "gates"],
  assets: ["summary", "roadmaps", "gates", "efforts", "authorities", "assets", "reviews"],
  audit: ["summary", "reviews"],
  lineage: ["summary", "roadmaps", "gates", "efforts", "authorities", "assets", "reviews"],
};

const completeProjections: Readonly<
  Record<PortalProjectSection, readonly ProjectReadModelProjectionName[]>
> = {
  overview: ["summary", "brief", "roadmaps", "gates", "efforts", "reviews"],
  roadmaps: ["summary", "roadmaps", "gates"],
  assets: ["summary", "roadmaps", "gates", "efforts", "authorities", "assets", "reviews"],
  audit: ["summary", "reviews"],
  lineage: ["summary"],
};

const lineageReference = (subject: PlanningLineageSubject): string =>
  subject.kind === "native-scope" || subject.kind === "native-subject"
    ? `${subject.kind}:${subject.id}`
    : subject.id;

export class PortalProjectReadModelUnavailableError extends Error {
  constructor(readonly reason: "need-rebuild" | "need-update") {
    super(
      reason === "need-rebuild"
        ? "Project Read Model needs an explicit rebuild before Portal can read it."
        : "Portal needs a compatible runtime before it can read this Project Read Model.",
    );
    this.name = "PortalProjectReadModelUnavailableError";
  }
}

const requireCurrentProjection = (metadata: ProjectReadModelMetadata): void => {
  if (metadata.projectionVersion !== PROJECT_READ_MODEL_PROJECTION_VERSION) {
    throw new PortalProjectReadModelUnavailableError(
      metadata.projectionVersion < PROJECT_READ_MODEL_PROJECTION_VERSION
        ? "need-rebuild"
        : "need-update",
    );
  }
};

const queryLineage = (database: DatabaseSync, target: PlanningLineageSubject | undefined) => {
  if (target === undefined) return [];
  const targetReference = lineageReference(target);
  const targetRow = database
    .prepare("SELECT reference, payload_json FROM subject_contexts WHERE reference = ?")
    .get(targetReference);
  if (targetRow === undefined) return [];
  const dossier = planningLineageSubjectProjectionSchema.parse(
    parseJson(targetRow["payload_json"]),
  );
  if (lineageReference(dossier.identity) !== targetRow["reference"]) {
    throw new Error("Project Read Model subject identity is inconsistent.");
  }
  const references = new Set<string>([
    lineageReference(dossier.identity),
    ...dossier.parentPath.ancestors.map(lineageReference),
    ...dossier.relations.flatMap((relation) =>
      relation.state === "present"
        ? relation.targets.flatMap((related) =>
            related.subject === undefined ? [] : [lineageReference(related.subject)],
          )
        : [],
    ),
  ]);
  const placeholders = [...references].map(() => "?").join(", ");
  return boundedRows(
    database,
    `SELECT reference, payload_json FROM subject_contexts WHERE reference IN (${placeholders}) ORDER BY reference`,
    "lineage",
    [...references],
  ).map((row) => {
    const subject = planningLineageSubjectProjectionSchema.parse(parseJson(row["payload_json"]));
    if (lineageReference(subject.identity) !== row["reference"]) {
      throw new Error("Project Read Model subject identity is inconsistent.");
    }
    return subject;
  });
};

const nativeTargetState = (
  database: DatabaseSync,
  target: PlanningLineageSubject | undefined,
  lineage: readonly unknown[],
): "covered-missing" | "unavailable" | undefined => {
  if (
    target === undefined ||
    (target.kind !== "native-scope" && target.kind !== "native-subject") ||
    lineage.length > 0
  ) {
    return undefined;
  }
  if (target.kind === "native-subject") return "unavailable";
  const bindingKey = `matt-skills/v1\0${target.id}`;
  const evidence = boundedRows(
    database,
    "SELECT binding_key, observation_id, source_revision, observation_json, selection_json FROM provider_evidence WHERE binding_key = ? ORDER BY role",
    "provider evidence",
    [bindingKey],
  ).map((row) => {
    const selection = providerObservationSelectionSchema.parse(
      parseJson(row["selection_json"]),
    ) as ProviderObservationSelection;
    if (
      mattNativeScopeKey(selection) !== row["binding_key"] ||
      selection.observationId !== row["observation_id"]
    ) {
      throw new Error("Project Read Model provider selection identity is inconsistent.");
    }
    if (typeof row["observation_json"] !== "string") {
      if (row["observation_id"] !== null || row["source_revision"] !== null) {
        throw new Error("Project Read Model provider observation payload is missing.");
      }
      return { selection };
    }
    const observation = mattSkillsV1ProviderObservationSchema.parse(
      parseJson(row["observation_json"]),
    ) as MattSkillsV1ProviderObservation;
    if (
      observation.id !== row["observation_id"] ||
      (observation.sourceRevision ?? null) !== row["source_revision"] ||
      !sameMattNativeBindingDefinition(selection, observation.binding) ||
      !providerObservationSelectionFreshnessIsCoherent(selection, observation)
    ) {
      throw new Error("Project Read Model provider observation identity is inconsistent.");
    }
    return { selection, observation };
  });
  const selections = evidence.map((item) => item.selection);
  const observations = evidence.flatMap((item) =>
    item.observation === undefined ? [] : [item.observation],
  );
  return observations.length > 0 &&
    observations.every((observation) => hasCompleteMattNativeEvidence(observation, selections))
    ? "covered-missing"
    : "unavailable";
};

const queryRows = (
  database: DatabaseSync,
  section: PortalProjectSection,
  target: PlanningLineageSubject | undefined,
) => {
  const kinds = objectKinds[section];
  const lineage = section === "lineage" ? queryLineage(database, target) : [];
  const targetState = nativeTargetState(database, target, lineage);
  const subjectReferences = lineage.map((subject) => lineageReference(subject.identity));
  const objectReferences =
    section === "lineage"
      ? [
          ...subjectReferences,
          ...subjectReferences.flatMap((reference) => [
            `portal-native-evidence:bound:${reference}`,
            `portal-native-evidence:detail:${reference}`,
            `portal-reference-title:${reference.replace(/^native-(?:scope|subject):/u, "")}`,
          ]),
        ]
      : [];
  const kindPlaceholders = kinds.map(() => "?").join(", ");
  const referencePredicate =
    objectReferences.length === 0
      ? ""
      : ` OR reference IN (${objectReferences.map(() => "?").join(", ")})`;
  const objects = boundedRows(
    database,
    `SELECT reference, kind, payload_json FROM project_objects WHERE kind IN (${kindPlaceholders})${referencePredicate} ORDER BY kind, ordinal, reference`,
    "object",
    [...kinds, ...objectReferences],
  ).map((row) => {
    const parsed = projectReadModelObjectSchema.parse({
      kind: row["kind"],
      value: parseJson(row["payload_json"]),
    });
    assertProjectReadModelObjectIdentity(String(row["reference"]), parsed);
    return parsed;
  });
  assertProjectReadModelObjectRelationships(objects, {
    requiredProjections: requiredProjections[section],
    completeProjections: completeProjections[section],
  });
  const attentionCount = database
    .prepare("SELECT COUNT(*) AS count FROM project_attention")
    .get()?.["count"];
  if (typeof attentionCount !== "number") {
    throw new Error("Project Read Model Attention count is missing.");
  }
  const attention =
    section === "overview"
      ? boundedRows(
          database,
          "SELECT reference, payload_json FROM project_attention ORDER BY reference",
          "attention",
        ).map((row) => {
          const item = attentionItemSchema.parse(parseJson(row["payload_json"]));
          const reference =
            "diagnosticReference" in item ? item.diagnosticReference : `${item.kind}:${item.id}`;
          if (reference !== row["reference"]) {
            throw new Error("Project Read Model Attention identity is inconsistent.");
          }
          return item;
        })
      : [];
  const sourceReferences = new Set<string>();
  const diagnosticReferences = new Set<string>();
  const collectReferences = (value: unknown, key?: string): void => {
    if (typeof value === "string") {
      if (/^source:[0-9a-f]{64}$/u.test(value)) sourceReferences.add(value);
      if (key === "diagnosticReference") diagnosticReferences.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectReferences(item);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [childKey, child] of Object.entries(value)) collectReferences(child, childKey);
    }
  };
  if (section !== "audit") {
    collectReferences(objects);
    collectReferences(lineage);
    collectReferences(attention);
  }
  const diagnosticTargets = [
    ...new Set([
      ...objects.map((object) => object.value.id),
      ...subjectReferences,
      ...sourceReferences,
    ]),
  ];
  const diagnostics =
    (section !== "overview" && section !== "lineage") ||
    (diagnosticTargets.length === 0 && diagnosticReferences.size === 0)
      ? []
      : boundedRows(
          database,
          `SELECT reference, impact, target, payload_json FROM project_diagnostics WHERE target IN (${diagnosticTargets.map(() => "?").join(", ") || "NULL"}) OR reference IN (${[...diagnosticReferences].map(() => "?").join(", ") || "NULL"}) ORDER BY impact, reference`,
          "diagnostic",
          [...diagnosticTargets, ...diagnosticReferences],
        ).map((row) => {
          const diagnostic = structuralDiagnosticSchema.parse(parseJson(row["payload_json"]));
          if (
            diagnostic.reference !== row["reference"] ||
            diagnostic.impact !== row["impact"] ||
            diagnostic.target !== row["target"]
          ) {
            throw new Error("Project Read Model diagnostic identity is inconsistent.");
          }
          return diagnostic;
        });
  collectReferences(diagnostics);
  const sources =
    sourceReferences.size === 0
      ? []
      : boundedRows(
          database,
          `SELECT reference, kind, payload_json FROM project_sources WHERE reference IN (${[...sourceReferences].map(() => "?").join(", ")}) ORDER BY reference`,
          "source",
          [...sourceReferences],
        ).map((row) => {
          const source = sourceRecordSchema.parse(parseJson(row["payload_json"]));
          if (source.reference !== row["reference"] || source.kind !== row["kind"]) {
            throw new Error("Project Read Model Source identity is inconsistent.");
          }
          return source;
        });
  return {
    section,
    ...(section === "lineage" && target !== undefined ? { target } : {}),
    ...(targetState === undefined ? {} : { nativeTargetState: targetState }),
    objects,
    lineage,
    attentionCount,
    attention,
    diagnostics,
    sources,
  };
};

export type PortalProjectRows = Readonly<ReturnType<typeof queryRows>>;

export const queryPortalProjectRows = async (
  repoRoot: string,
  section: PortalProjectSection = "overview",
  target?: PlanningLineageSubject | undefined,
): Promise<PortalProjectRows> =>
  withProjectReadModel(repoRoot, (database, metadata) => {
    requireCurrentProjection(metadata);
    return queryRows(database, section, target);
  });

export type PortalAssetRowQuery =
  | Readonly<{ state: "available"; asset: AssetProjection }>
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "unavailable" }>;

export const queryPortalAssetRow = async (
  repoRoot: string,
  assetId: string,
): Promise<PortalAssetRowQuery> =>
  withProjectReadModel(repoRoot, (database, metadata) => {
    requireCurrentProjection(metadata);
    const stateRow = database
      .prepare(
        "SELECT reference, kind, payload_json FROM project_objects WHERE reference = 'portal-projection:assets'",
      )
      .get();
    if (stateRow === undefined) throw new Error("Project Read Model Assets state is missing.");
    const state = projectReadModelObjectSchema.parse({
      kind: stateRow["kind"],
      value: parseJson(stateRow["payload_json"]),
    });
    assertProjectReadModelObjectIdentity(String(stateRow["reference"]), state);
    if (state.kind !== "portal-projection-state" || state.value.projection !== "assets") {
      throw new Error("Project Read Model Assets state is invalid.");
    }
    if (state.value.validity === "invalid") return { state: "unavailable" };
    const row = database
      .prepare(
        "SELECT reference, kind, payload_json FROM project_objects WHERE kind = 'asset' AND reference = ?",
      )
      .get(assetId);
    if (row === undefined) {
      return state.value.validity === "partial" ? { state: "unavailable" } : { state: "missing" };
    }
    const parsed = projectReadModelObjectSchema.parse({
      kind: row["kind"],
      value: parseJson(row["payload_json"]),
    });
    assertProjectReadModelObjectIdentity(String(row["reference"]), parsed);
    if (parsed.kind !== "asset") {
      throw new Error("Project Read Model Asset row is invalid.");
    }
    return { state: "available", asset: parsed.value };
  });

export type PortalFindMatch = Readonly<{
  subject: Readonly<{ kind: string; id: string }>;
  subjectType: string;
  title: string;
  excerpt: string;
  parentPath: readonly string[];
  href: string;
  score: number;
}>;
export type PortalFindQuery = Readonly<{
  results: readonly PortalFindMatch[];
  scopeState: ProjectFindScopeState;
}>;

const findMatches = (
  database: DatabaseSync,
  metadata: ProjectReadModelMetadata,
  entryId: string,
  query: string,
  limit: number,
): PortalFindQuery => {
  const documents = boundedRows(
    database,
    "SELECT reference, kind, payload_json FROM project_objects WHERE kind = 'portal-find-document' ORDER BY ordinal, reference",
    "Find document",
  ).map((row) => {
    const parsed = projectReadModelObjectSchema.parse({
      kind: row["kind"],
      value: parseJson(row["payload_json"]),
    });
    assertProjectReadModelObjectIdentity(String(row["reference"]), parsed);
    if (parsed.kind !== "portal-find-document") {
      throw new Error("Project Find document row is invalid.");
    }
    return parsed.value.document;
  });
  const stateRow = database
    .prepare(
      "SELECT reference, kind, payload_json FROM project_objects WHERE kind = 'portal-find-state'",
    )
    .get();
  if (stateRow === undefined) throw new Error("Project Find state is missing.");
  const state = projectReadModelObjectSchema.parse({
    kind: stateRow["kind"],
    value: parseJson(stateRow["payload_json"]),
  });
  assertProjectReadModelObjectIdentity(String(stateRow["reference"]), state);
  if (state.kind !== "portal-find-state") {
    throw new Error("Project Find state is invalid.");
  }
  const index = buildProjectFindIndexFromDocuments(
    documents,
    entryId,
    metadata.receipt.basisFingerprint,
    state.value.scopeState,
  );
  return { results: index.search(query).slice(0, limit), scopeState: index.scopeState };
};

export const searchPortalProjectRows = async (
  repoRoot: string,
  entryId: string,
  query: string,
  limit = 20,
): Promise<PortalFindQuery> => {
  const normalized = query.trim().slice(0, MAX_FIND_QUERY_LENGTH);
  const boundedLimit = Math.max(1, Math.min(MAX_FIND_RESULTS, Math.trunc(limit)));
  return withProjectReadModel(repoRoot, (database, metadata) => {
    requireCurrentProjection(metadata);
    if (normalized.length === 0) {
      return { results: [], scopeState: { state: "available" } };
    }
    return findMatches(database, metadata, entryId, normalized, boundedLimit);
  });
};
