import { lstat, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { z } from "zod";
import type { AssetContentObservation } from "../asset-inputs";
import type { FingerprintObservation } from "../fingerprint";
import { buildProjectFindDocuments, projectFindScopeState } from "../portal-ui/project-find-model";
import type { ProjectGeneration } from "../project-generation/contract";
import {
  attentionItemSchema,
  projectGenerationSchema,
  structuralDiagnosticSchema,
} from "../project-generation/schema";
import {
  planningLineageRelationSchema,
  planningLineageSubjectProjectionSchema,
} from "../project-generation/schema-planning-lineage";
import { sourceRecordSchema } from "../project-generation/source-schema";
import {
  type ProviderObservationSelection,
  providerObservationSelectionFreshnessIsCoherent,
  providerObservationSelectionSchema,
} from "../provider-evidence-contract";
import type { MattSkillsV1ProviderObservation } from "../providers/matt-skills-v1/capture";
import { mattNativeRecords } from "../providers/matt-skills-v1/native-read-model";
import {
  type MattNativeScopeBinding,
  mattNativeScopeKey,
  mattNativeScopeSubject,
  sameMattNativeBindingDefinition,
} from "../providers/matt-skills-v1/native-subject";
import { mattSkillsV1ProviderObservationSchema } from "../providers/matt-skills-v1/schema";
import {
  assertProjectReadModelObjectIdentity,
  assertProjectReadModelObjectRelationships,
  PROJECT_READ_MODEL_PROJECTION_VERSION,
  PROJECT_READ_MODEL_STORAGE_VERSION,
  type ProjectReadModelObject,
  type ProjectReadModelReceipt,
  projectReadModelObjectSchema,
  projectReadModelReceiptSchema,
} from "./contract";

const BUSY_TIMEOUT_MS = 1_000;

export const projectProviderEvidenceBindingKey = (binding: MattNativeScopeBinding): string =>
  Buffer.from(mattNativeScopeKey(binding), "utf8").toString("hex");

type ObjectRow = Readonly<{
  reference: string;
  kind: string;
  ordinal: number;
  payload: string;
}>;
type RelationRow = Readonly<{
  sourceReference: string;
  relationKey: string;
  targetReference?: string;
  ordinal: number;
  payload: string;
}>;
type PayloadRow = Readonly<{ reference: string; payload: string }>;
type SourceRow = Readonly<{ reference: string; kind: string; payload: string }>;
export type ProjectProviderEvidenceRow = Readonly<{
  bindingKey: string;
  role: "bound" | "detail";
  observationId?: string;
  sourceRevision?: string;
  observation?: string;
  selection: string;
}>;

export type ProjectReadModelCandidate = Readonly<{
  basisFingerprint: string;
  basisInputs: readonly string[];
  basisObservations: readonly FingerprintObservation[];
  assetContentObservations: readonly AssetContentObservation[];
  objects: readonly ObjectRow[];
  relations: readonly RelationRow[];
  subjectContexts: readonly PayloadRow[];
  attention: readonly PayloadRow[];
  diagnostics: readonly PayloadRow[];
  sources: readonly SourceRow[];
  providerEvidence: readonly ProjectProviderEvidenceRow[];
}>;

export type ProjectReadModelMetadata = Readonly<{
  storageVersion: number;
  projectionVersion: number;
  basisFingerprint: string;
  basisInputs: readonly string[];
  basisObservations: readonly FingerprintObservation[];
  assetContentObservations: readonly AssetContentObservation[];
  receipt: ProjectReadModelReceipt;
}>;

export type ProjectReadModelState =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "ready"; metadata: ProjectReadModelMetadata }>
  | Readonly<{ state: "obsolete-compatible"; metadata: ProjectReadModelMetadata }>
  | Readonly<{ state: "recovery-required"; reason: string }>
  | Readonly<{ state: "need-update"; storageVersion: number; projectionVersion?: number }>;

export class ProjectReadModelBusyError extends Error {
  readonly code = "project-read-model-busy";
  constructor(options?: ErrorOptions) {
    super("Project Read Model is busy; retry after the current writer finishes.", options);
    this.name = "ProjectReadModelBusyError";
  }
}

export const projectReadModelPath = (repoRoot: string): string =>
  join(repoRoot, ".bearing", "cache", "project-read-model.sqlite");

export const removeProjectReadModelForRebuild = async (repoRoot: string): Promise<boolean> => {
  const safety = await pathSafety(repoRoot);
  if (safety === "missing") return false;
  if (safety === "unsafe") {
    throw new Error("Project Read Model target is unsafe and was not changed.");
  }
  await unlink(projectReadModelPath(repoRoot));
  return true;
};

const openDatabase = async (
  path: string,
  options?: ConstructorParameters<typeof DatabaseSync>[1],
): Promise<DatabaseSync> => {
  const { DatabaseSync: SqliteDatabase } = await import("node:sqlite");
  return options === undefined ? new SqliteDatabase(path) : new SqliteDatabase(path, options);
};

const configure = (database: DatabaseSync): void => {
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
};

const json = (value: unknown): string => JSON.stringify(value);
const parseJson = (value: SQLOutputValue | undefined): unknown => {
  if (typeof value !== "string") throw new Error("Project Read Model JSON value is missing.");
  return JSON.parse(value);
};

const metadataSchema = z.strictObject({
  storageVersion: z.number().int().positive(),
  projectionVersion: z.number().int().nonnegative(),
  basisFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  basisInputs: z.array(z.string()),
  basisObservations: z.array(z.strictObject({ key: z.string(), value: z.string() })),
  assetContentObservations: z.array(
    z.strictObject({
      id: z.string(),
      location: z.string(),
      availability: z.enum(["available", "missing", "unreadable"]),
      shape: z.enum(["file", "directory", "unavailable"]),
    }),
  ),
  receipt: projectReadModelReceiptSchema,
});

const initializeSchema = (database: DatabaseSync): void => {
  database.exec(`
    CREATE TABLE read_model_metadata (
      singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
      projection_version INTEGER NOT NULL,
      basis_fingerprint TEXT NOT NULL,
      basis_inputs_json TEXT NOT NULL,
      basis_observations_json TEXT NOT NULL,
      asset_observations_json TEXT NOT NULL,
      receipt_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE project_objects (
      reference TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX project_objects_kind_order ON project_objects(kind, ordinal);
    CREATE TABLE project_relations (
      source_reference TEXT NOT NULL,
      relation_key TEXT NOT NULL,
      target_reference TEXT,
      ordinal INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (source_reference, relation_key, ordinal)
    ) STRICT;
    CREATE INDEX project_relations_target ON project_relations(target_reference);
    CREATE TABLE subject_contexts (
      reference TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE project_diagnostics (
      reference TEXT PRIMARY KEY NOT NULL,
      impact TEXT NOT NULL,
      target TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX project_diagnostics_target ON project_diagnostics(target, impact);
    CREATE TABLE project_attention (
      reference TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE project_sources (
      reference TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE provider_evidence (
      binding_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('bound', 'detail')),
      observation_id TEXT,
      source_revision TEXT,
      observation_json TEXT,
      selection_json TEXT NOT NULL,
      PRIMARY KEY (binding_key, role)
    ) STRICT;
    PRAGMA user_version = ${PROJECT_READ_MODEL_STORAGE_VERSION};
  `);
};

const tableNames = [
  "read_model_metadata",
  "project_objects",
  "project_relations",
  "subject_contexts",
  "project_diagnostics",
  "project_attention",
  "project_sources",
  "provider_evidence",
] as const;

const assertSchema = (database: DatabaseSync): number => {
  const version = database.prepare("PRAGMA user_version").get()?.["user_version"];
  if (typeof version !== "number") throw new Error("Project Read Model version is missing.");
  if (version !== PROJECT_READ_MODEL_STORAGE_VERSION) return version;
  const names = new Set(
    database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .all()
      .map((row) => row["name"]),
  );
  if (!tableNames.every((name) => names.has(name))) {
    throw new Error("Project Read Model schema is incomplete.");
  }
  const quickCheck = database.prepare("PRAGMA quick_check").get()?.["quick_check"];
  if (quickCheck !== "ok") throw new Error("Project Read Model integrity check failed.");
  return version;
};

const referenceForSubject = (subject: ProjectGeneration["lineage"]["subjects"][number]): string =>
  subject.identity.kind === "native-subject" || subject.identity.kind === "native-scope"
    ? `${subject.identity.kind}:${subject.identity.id}`
    : String(subject.identity.id);

export const compileProjectReadModel = (input: {
  readonly snapshot: ProjectGeneration;
  readonly basisFingerprint: string;
  readonly basisInputs: readonly string[];
  readonly basisObservations: readonly FingerprintObservation[];
  readonly assetContentObservations: readonly AssetContentObservation[];
}): ProjectReadModelCandidate => {
  const snapshot = projectGenerationSchema.parse(input.snapshot);
  const objects: ObjectRow[] = [];
  const appendSingleton = (
    kind: string,
    projection: { readonly validity: string; readonly value?: unknown },
  ) => {
    if (
      (projection.validity !== "available" && projection.validity !== "partial") ||
      projection.value === undefined
    ) {
      return;
    }
    const value = projection.value as { readonly id: string };
    objects.push({ reference: value.id, kind, ordinal: 0, payload: json(value) });
  };
  const appendCollection = (
    kind: string,
    projection: { readonly validity: string; readonly items?: readonly { readonly id: string }[] },
  ) => {
    if (projection.validity === "invalid") return;
    for (const [ordinal, value] of (projection.items ?? []).entries()) {
      objects.push({ reference: value.id, kind, ordinal, payload: json(value) });
    }
  };
  appendSingleton("project-summary", snapshot.summary);
  appendSingleton("project-brief", snapshot.brief);
  appendCollection("roadmap", snapshot.roadmaps);
  appendCollection("gate", snapshot.gates);
  appendCollection("effort", snapshot.efforts);
  appendCollection("authority", snapshot.authorities);
  appendCollection("asset", snapshot.assets);
  appendCollection("planning-review", snapshot.reviews);
  for (const [ordinal, document] of buildProjectFindDocuments(snapshot, "project").entries()) {
    const value = { id: `portal-find-document:${document.id}`, document };
    objects.push({
      reference: value.id,
      kind: "portal-find-document",
      ordinal,
      payload: json(value),
    });
  }
  objects.push({
    reference: "portal-find-state:current",
    kind: "portal-find-state",
    ordinal: 0,
    payload: json({ id: "portal-find-state:current", scopeState: projectFindScopeState(snapshot) }),
  });
  const appendProjectionState = (
    projection:
      | "summary"
      | "brief"
      | "roadmaps"
      | "gates"
      | "efforts"
      | "authorities"
      | "assets"
      | "reviews",
    value: { readonly validity: string; readonly issues?: readonly unknown[] },
  ) => {
    objects.push({
      reference: `portal-projection:${projection}`,
      kind: "portal-projection-state",
      ordinal: 0,
      payload: json({
        id: `portal-projection:${projection}`,
        projection,
        validity: value.validity,
        ...(value.issues === undefined ? {} : { issues: value.issues }),
      }),
    });
  };
  appendProjectionState("summary", snapshot.summary);
  appendProjectionState("brief", snapshot.brief);
  appendProjectionState("roadmaps", snapshot.roadmaps);
  appendProjectionState("gates", snapshot.gates);
  appendProjectionState("efforts", snapshot.efforts);
  appendProjectionState("authorities", snapshot.authorities);
  appendProjectionState("assets", snapshot.assets);
  appendProjectionState("reviews", snapshot.reviews);
  objects.push({
    reference: "portal-projection:roadmap-index",
    kind: "portal-roadmap-index",
    ordinal: 0,
    payload: json({ id: "portal-projection:roadmap-index", projection: snapshot.roadmapIndex }),
  });
  objects.push({
    reference: "portal-projection:audit",
    kind: "portal-audit",
    ordinal: 0,
    payload: json({ id: "portal-projection:audit", projection: snapshot.audit }),
  });

  const relations: RelationRow[] = [];
  const subjectContexts: PayloadRow[] = [];
  for (const subject of snapshot.lineage.subjects) {
    const sourceReference = referenceForSubject(subject);
    subjectContexts.push({ reference: sourceReference, payload: json(subject) });
    for (const relation of subject.relations) {
      if (relation.state === "present") {
        for (const [ordinal, target] of relation.targets.entries()) {
          relations.push({
            sourceReference,
            relationKey: relation.key,
            targetReference: target.reference,
            ordinal,
            payload: json(relation),
          });
        }
      } else {
        relations.push({
          sourceReference,
          relationKey: relation.key,
          ordinal: 0,
          payload: json(relation),
        });
      }
    }
  }
  const providerEvidenceRows = (
    role: ProjectProviderEvidenceRow["role"],
    selections:
      | ProjectGeneration["providerObservationSelections"]
      | ProjectGeneration["providerDetailEvidences"]["selections"],
    observations:
      | ProjectGeneration["providerObservations"]
      | ProjectGeneration["providerDetailEvidences"]["observations"],
  ): ProjectProviderEvidenceRow[] =>
    selections.map((selection) => {
      const observation = observations.find(
        (candidate) => mattNativeScopeKey(candidate.binding) === mattNativeScopeKey(selection),
      );
      return {
        bindingKey: projectProviderEvidenceBindingKey(selection),
        role,
        ...(observation === undefined
          ? {}
          : {
              observationId: observation.id,
              ...(observation.sourceRevision === undefined
                ? {}
                : { sourceRevision: observation.sourceRevision }),
              observation: json(observation),
            }),
        selection: json(selection),
      };
    });
  const appendPortalEvidence = (
    role: ProjectProviderEvidenceRow["role"],
    selections:
      | ProjectGeneration["providerObservationSelections"]
      | ProjectGeneration["providerDetailEvidences"]["selections"],
    observations:
      | ProjectGeneration["providerObservations"]
      | ProjectGeneration["providerDetailEvidences"]["observations"],
  ) => {
    for (const selection of selections) {
      const observation = observations.find(
        (candidate) => mattNativeScopeKey(candidate.binding) === mattNativeScopeKey(selection),
      );
      const subjectReferences = new Set<string>([
        `native-scope:${mattNativeScopeSubject({ binding: selection }).id}`,
        ...(snapshot.efforts.validity === "invalid"
          ? []
          : snapshot.efforts.items
              .filter(
                (effort) =>
                  effort.workBinding !== undefined &&
                  mattNativeScopeKey(effort.workBinding) === mattNativeScopeKey(selection),
              )
              .map((effort) => String(effort.id))),
        ...(observation === undefined
          ? []
          : mattNativeRecords([observation], snapshot.sources).map((record) =>
              record.recordKind === "native-scope"
                ? `native-scope:${record.id}`
                : `native-subject:${record.id}`,
            )),
      ]);
      for (const subjectReference of subjectReferences) {
        const id = `portal-native-evidence:${role}:${subjectReference}`;
        objects.push({
          reference: id,
          kind: "portal-native-evidence",
          ordinal: 0,
          payload: json({
            id,
            subjectReference,
            role,
            selection,
            ...(observation === undefined ? {} : { observation }),
          }),
        });
      }
    }
  };
  appendPortalEvidence(
    "bound",
    snapshot.providerObservationSelections,
    snapshot.providerObservations,
  );
  appendPortalEvidence(
    "detail",
    snapshot.providerDetailEvidences.selections,
    snapshot.providerDetailEvidences.observations,
  );
  const referenceTitles = new Map<string, string>();
  for (const record of mattNativeRecords(
    [...snapshot.providerObservations, ...snapshot.providerDetailEvidences.observations],
    snapshot.sources,
  )) {
    referenceTitles.set(record.id, record.title);
  }
  for (const [reference, title] of referenceTitles) {
    const id = `portal-reference-title:${reference}`;
    objects.push({
      reference: id,
      kind: "portal-reference-title",
      ordinal: 0,
      payload: json({ id, reference, title }),
    });
  }
  const providerEvidence = [
    ...providerEvidenceRows(
      "bound",
      snapshot.providerObservationSelections,
      snapshot.providerObservations,
    ),
    ...providerEvidenceRows(
      "detail",
      snapshot.providerDetailEvidences.selections,
      snapshot.providerDetailEvidences.observations,
    ),
  ];
  return {
    basisFingerprint: input.basisFingerprint,
    basisInputs: [...input.basisInputs],
    basisObservations: [...input.basisObservations],
    assetContentObservations: [...input.assetContentObservations],
    objects,
    relations,
    subjectContexts,
    attention: snapshot.attention.map((item) => ({
      reference:
        "diagnosticReference" in item ? item.diagnosticReference : `${item.kind}:${item.id}`,
      payload: json(item),
    })),
    diagnostics: snapshot.diagnostics.map((diagnostic) => ({
      reference: diagnostic.reference,
      payload: json(diagnostic),
    })),
    sources: snapshot.sources.map((source) => ({
      reference: source.reference,
      kind: source.kind,
      payload: json(source),
    })),
    providerEvidence,
  };
};

const pathSafety = async (repoRoot: string): Promise<"missing" | "safe" | "unsafe"> => {
  for (const directory of [join(repoRoot, ".bearing"), join(repoRoot, ".bearing", "cache")]) {
    try {
      const metadata = await lstat(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) return "unsafe";
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return "missing";
      return "unsafe";
    }
  }
  try {
    const metadata = await lstat(projectReadModelPath(repoRoot));
    return metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1
      ? "safe"
      : "unsafe";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "missing";
    return "unsafe";
  }
};

const readMetadata = (database: DatabaseSync, storageVersion: number): ProjectReadModelMetadata => {
  const row = database.prepare("SELECT * FROM read_model_metadata WHERE singleton = 1").get();
  if (row === undefined) throw new Error("Project Read Model metadata is missing.");
  const metadata = metadataSchema.parse({
    storageVersion,
    projectionVersion: row["projection_version"],
    basisFingerprint: row["basis_fingerprint"],
    basisInputs: parseJson(row["basis_inputs_json"]),
    basisObservations: parseJson(row["basis_observations_json"]),
    assetContentObservations: parseJson(row["asset_observations_json"]),
    receipt: parseJson(row["receipt_json"]),
  });
  if (metadata.basisFingerprint !== metadata.receipt.basisFingerprint) {
    throw new Error("Project Read Model generation basis is inconsistent.");
  }
  return metadata;
};

const validateProviderEvidenceRow = (
  row: Readonly<Record<string, SQLOutputValue>>,
  projectionVersion: number,
): void => {
  const selection = providerObservationSelectionSchema.parse(parseJson(row["selection_json"]));
  const bindingKey = row["binding_key"];
  const expectedBindingKeys =
    projectionVersion < 5
      ? new Set([mattNativeScopeKey(selection), projectProviderEvidenceBindingKey(selection)])
      : new Set([projectProviderEvidenceBindingKey(selection)]);
  if (
    !expectedBindingKeys.has(String(bindingKey)) ||
    selection.observationId !== row["observation_id"]
  ) {
    throw new Error("Project Read Model provider selection identity is inconsistent.");
  }
  if (typeof row["observation_json"] === "string") {
    const observation = mattSkillsV1ProviderObservationSchema.parse(
      parseJson(row["observation_json"]),
    );
    if (
      observation.id !== row["observation_id"] ||
      (observation.sourceRevision ?? null) !== row["source_revision"] ||
      !sameMattNativeBindingDefinition(selection, observation.binding) ||
      !providerObservationSelectionFreshnessIsCoherent(selection, observation)
    ) {
      throw new Error("Project Read Model provider observation identity is inconsistent.");
    }
  } else if (row["observation_id"] !== null || row["source_revision"] !== null) {
    throw new Error("Project Read Model provider observation payload is missing.");
  }
};

const validatePayloads = (database: DatabaseSync, projectionVersion: number): void => {
  const objects: ProjectReadModelObject[] = [];
  for (const row of database
    .prepare("SELECT reference, kind, payload_json FROM project_objects")
    .all()) {
    const parsed = projectReadModelObjectSchema.parse({
      kind: row["kind"],
      value: parseJson(row["payload_json"]),
    });
    assertProjectReadModelObjectIdentity(z.string().parse(row["reference"]), parsed);
    objects.push(parsed);
  }
  assertProjectReadModelObjectRelationships(objects);
  const relationRows = database
    .prepare(
      "SELECT source_reference, relation_key, target_reference, ordinal, payload_json FROM project_relations",
    )
    .all();
  const relationGroups = new Map<string, { count: number; payload: SQLOutputValue | undefined }>();
  for (const row of relationRows) {
    const groupKey = `${String(row["source_reference"])}\0${String(row["relation_key"])}`;
    const group = relationGroups.get(groupKey);
    if (group === undefined) {
      relationGroups.set(groupKey, { count: 1, payload: row["payload_json"] });
    } else {
      if (group.payload !== row["payload_json"]) {
        throw new Error("Project Read Model relation payload is inconsistent.");
      }
      group.count += 1;
    }
  }
  for (const row of relationRows) {
    const relation = planningLineageRelationSchema.parse(parseJson(row["payload_json"]));
    if (relation.key !== row["relation_key"]) {
      throw new Error("Project Read Model relation key is inconsistent.");
    }
    const groupKey = `${String(row["source_reference"])}\0${String(row["relation_key"])}`;
    const group = relationGroups.get(groupKey);
    if (relation.state === "present") {
      const ordinal = row["ordinal"];
      if (
        typeof ordinal !== "number" ||
        relation.targets[ordinal]?.reference !== row["target_reference"] ||
        group?.count !== relation.targets.length
      ) {
        throw new Error("Project Read Model relation target order is inconsistent.");
      }
    } else if (row["target_reference"] !== null || row["ordinal"] !== 0 || group?.count !== 1) {
      throw new Error("Project Read Model relation target is inconsistent.");
    }
  }
  for (const row of database
    .prepare("SELECT reference, payload_json FROM subject_contexts")
    .all()) {
    const subject = planningLineageSubjectProjectionSchema.parse(parseJson(row["payload_json"]));
    if (referenceForSubject(subject) !== row["reference"]) {
      throw new Error("Project Read Model subject identity is inconsistent.");
    }
  }
  for (const row of database
    .prepare("SELECT reference, impact, target, payload_json FROM project_diagnostics")
    .all()) {
    const diagnostic = structuralDiagnosticSchema.parse(parseJson(row["payload_json"]));
    if (
      diagnostic.reference !== row["reference"] ||
      diagnostic.impact !== row["impact"] ||
      diagnostic.target !== row["target"]
    ) {
      throw new Error("Project Read Model diagnostic identity is inconsistent.");
    }
  }
  for (const row of database
    .prepare("SELECT reference, payload_json FROM project_attention")
    .all()) {
    const item = attentionItemSchema.parse(parseJson(row["payload_json"]));
    const reference =
      "diagnosticReference" in item ? item.diagnosticReference : `${item.kind}:${item.id}`;
    if (reference !== row["reference"]) {
      throw new Error("Project Read Model Attention identity is inconsistent.");
    }
  }
  for (const row of database
    .prepare("SELECT reference, kind, payload_json FROM project_sources")
    .all()) {
    const source = sourceRecordSchema.parse(parseJson(row["payload_json"]));
    if (source.reference !== row["reference"] || source.kind !== row["kind"]) {
      throw new Error("Project Read Model Source identity is inconsistent.");
    }
  }
  for (const row of database
    .prepare(
      "SELECT binding_key, observation_id, source_revision, observation_json, selection_json FROM provider_evidence",
    )
    .all()) {
    validateProviderEvidenceRow(row, projectionVersion);
  }
};

export const inspectProjectReadModel = async (repoRoot: string): Promise<ProjectReadModelState> => {
  const safety = await pathSafety(repoRoot);
  if (safety === "missing") return { state: "missing" };
  if (safety === "unsafe") {
    return { state: "recovery-required", reason: "Project Read Model target is unsafe." };
  }
  let database: DatabaseSync | undefined;
  try {
    database = await openDatabase(projectReadModelPath(repoRoot), { readOnly: true });
    configure(database);
    const version = assertSchema(database);
    if (version > PROJECT_READ_MODEL_STORAGE_VERSION) {
      return { state: "need-update", storageVersion: version };
    }
    if (version < PROJECT_READ_MODEL_STORAGE_VERSION) {
      return {
        state: "recovery-required",
        reason: "Project Read Model storage version is incompatible.",
      };
    }
    const metadata = readMetadata(database, version);
    if (metadata.projectionVersion > PROJECT_READ_MODEL_PROJECTION_VERSION) {
      return {
        state: "need-update",
        storageVersion: version,
        projectionVersion: metadata.projectionVersion,
      };
    }
    validatePayloads(database, metadata.projectionVersion);
    return metadata.projectionVersion < PROJECT_READ_MODEL_PROJECTION_VERSION
      ? { state: "obsolete-compatible", metadata }
      : { state: "ready", metadata };
  } catch {
    return { state: "recovery-required", reason: "Project Read Model is corrupt or unreadable." };
  } finally {
    database?.close();
  }
};

const insertCandidate = (
  database: DatabaseSync,
  candidate: ProjectReadModelCandidate,
  receipt: ProjectReadModelReceipt,
): void => {
  const currentBindings = candidate.providerEvidence
    .filter((row) => row.role === "bound")
    .map((row) => providerObservationSelectionSchema.parse(parseJson(row.selection)));
  const matchesCurrentBinding = (selectionJson: string): boolean => {
    const selection = providerObservationSelectionSchema.parse(parseJson(selectionJson));
    return currentBindings.some((binding) => sameMattNativeBindingDefinition(binding, selection));
  };
  const currentBindingKeys = new Set(
    candidate.providerEvidence.filter((row) => row.role === "bound").map((row) => row.bindingKey),
  );
  const retainedDetailEvidence =
    currentBindingKeys.size === 0
      ? []
      : database
          .prepare(
            `SELECT binding_key, role, observation_id, source_revision, observation_json, selection_json FROM provider_evidence WHERE role = 'detail' AND binding_key IN (${[...currentBindingKeys].map(() => "?").join(", ")})`,
          )
          .all(...currentBindingKeys)
          .filter((row) => {
            validateProviderEvidenceRow(row, PROJECT_READ_MODEL_PROJECTION_VERSION);
            return matchesCurrentBinding(z.string().parse(row["selection_json"]));
          });
  for (const table of [
    "project_objects",
    "project_relations",
    "subject_contexts",
    "project_diagnostics",
    "project_attention",
    "project_sources",
    "provider_evidence",
    "read_model_metadata",
  ]) {
    database.exec(`DELETE FROM ${table}`);
  }
  const objectInsert = database.prepare(
    "INSERT INTO project_objects(reference, kind, ordinal, payload_json) VALUES (?, ?, ?, ?)",
  );
  for (const row of candidate.objects)
    objectInsert.run(row.reference, row.kind, row.ordinal, row.payload);
  const relationInsert = database.prepare(
    "INSERT INTO project_relations(source_reference, relation_key, target_reference, ordinal, payload_json) VALUES (?, ?, ?, ?, ?)",
  );
  for (const row of candidate.relations)
    relationInsert.run(
      row.sourceReference,
      row.relationKey,
      row.targetReference ?? null,
      row.ordinal,
      row.payload,
    );
  const contextInsert = database.prepare(
    "INSERT INTO subject_contexts(reference, payload_json) VALUES (?, ?)",
  );
  for (const row of candidate.subjectContexts) contextInsert.run(row.reference, row.payload);
  const diagnosticInsert = database.prepare(
    "INSERT INTO project_diagnostics(reference, impact, target, payload_json) VALUES (?, ?, ?, ?)",
  );
  for (const row of candidate.diagnostics) {
    const value = parseJson(row.payload) as { readonly impact: string; readonly target: string };
    diagnosticInsert.run(row.reference, value.impact, value.target, row.payload);
  }
  const attentionInsert = database.prepare(
    "INSERT INTO project_attention(reference, payload_json) VALUES (?, ?)",
  );
  for (const row of candidate.attention) attentionInsert.run(row.reference, row.payload);
  const sourceInsert = database.prepare(
    "INSERT INTO project_sources(reference, kind, payload_json) VALUES (?, ?, ?)",
  );
  for (const row of candidate.sources) sourceInsert.run(row.reference, row.kind, row.payload);
  const providerInsert = database.prepare(
    "INSERT INTO provider_evidence(binding_key, role, observation_id, source_revision, observation_json, selection_json) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const retainedDetailKeys = new Set(
    retainedDetailEvidence.map((row) => z.string().parse(row["binding_key"])),
  );
  for (const row of candidate.providerEvidence) {
    if (
      row.role === "detail" &&
      (!currentBindingKeys.has(row.bindingKey) || !matchesCurrentBinding(row.selection))
    ) {
      continue;
    }
    if (row.role === "detail" && retainedDetailKeys.has(row.bindingKey)) continue;
    providerInsert.run(
      row.bindingKey,
      row.role,
      row.observationId ?? null,
      row.sourceRevision ?? null,
      row.observation ?? null,
      row.selection,
    );
  }
  for (const row of retainedDetailEvidence) {
    providerInsert.run(
      z.string().parse(row["binding_key"]),
      z.literal("detail").parse(row["role"]),
      row["observation_id"] ?? null,
      row["source_revision"] ?? null,
      row["observation_json"] ?? null,
      z.string().parse(row["selection_json"]),
    );
  }
  database
    .prepare(
      "INSERT INTO read_model_metadata(singleton, projection_version, basis_fingerprint, basis_inputs_json, basis_observations_json, asset_observations_json, receipt_json) VALUES (1, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      PROJECT_READ_MODEL_PROJECTION_VERSION,
      candidate.basisFingerprint,
      json(candidate.basisInputs),
      json(candidate.basisObservations),
      json(candidate.assetContentObservations),
      json(receipt),
    );
};

const validateProjectReadModelCandidate = async (
  candidate: ProjectReadModelCandidate,
): Promise<void> => {
  const database = await openDatabase(":memory:");
  try {
    initializeSchema(database);
    insertCandidate(
      database,
      candidate,
      projectReadModelReceiptSchema.parse({
        basisFingerprint: candidate.basisFingerprint,
        publishedAt: "1970-01-01T00:00:00.000Z",
        publicationCount: 1,
      }),
    );
    validatePayloads(database, PROJECT_READ_MODEL_PROJECTION_VERSION);
  } finally {
    database.close();
  }
};

export const publishProjectReadModel = async (
  repoRoot: string,
  candidate: ProjectReadModelCandidate,
  options: Readonly<{
    now?: () => string;
    faultAt?: "before-commit";
  }> = {},
): Promise<ProjectReadModelReceipt> => {
  await validateProjectReadModelCandidate(candidate);
  const cacheRoot = dirname(projectReadModelPath(repoRoot));
  const bearingRoot = dirname(cacheRoot);
  const bearingMetadata = await lstat(bearingRoot);
  if (!bearingMetadata.isDirectory() || bearingMetadata.isSymbolicLink()) {
    throw new Error("Bearing state boundary is unavailable.");
  }
  await mkdir(cacheRoot, { recursive: true, mode: 0o755 });
  if ((await pathSafety(repoRoot)) === "unsafe") {
    throw new Error("Project Read Model target is unsafe.");
  }
  const path = projectReadModelPath(repoRoot);
  let database: DatabaseSync | undefined;
  let began = false;
  try {
    database = await openDatabase(path, { timeout: BUSY_TIMEOUT_MS });
    configure(database);
    database.exec("BEGIN IMMEDIATE");
    began = true;
    const version = database.prepare("PRAGMA user_version").get()?.["user_version"];
    let previousMetadata: ProjectReadModelMetadata | undefined;
    if (version === 0) initializeSchema(database);
    else {
      const asserted = assertSchema(database);
      if (asserted !== PROJECT_READ_MODEL_STORAGE_VERSION) {
        throw new Error("Project Read Model storage version is incompatible.");
      }
      previousMetadata = readMetadata(database, asserted);
      if (previousMetadata.projectionVersion > PROJECT_READ_MODEL_PROJECTION_VERSION) {
        throw new Error("Project Read Model projection version is newer than this binary.");
      }
      if (
        previousMetadata.projectionVersion === PROJECT_READ_MODEL_PROJECTION_VERSION &&
        previousMetadata.basisFingerprint === candidate.basisFingerprint
      ) {
        database.exec("COMMIT");
        began = false;
        return previousMetadata.receipt;
      }
    }
    const receipt = projectReadModelReceiptSchema.parse({
      basisFingerprint: candidate.basisFingerprint,
      publishedAt: (options.now ?? (() => new Date().toISOString()))(),
      publicationCount: (previousMetadata?.receipt.publicationCount ?? 0) + 1,
    });
    insertCandidate(database, candidate, receipt);
    if (options.faultAt === "before-commit") throw new Error("Injected publication failure.");
    database.exec("COMMIT");
    began = false;
    return receipt;
  } catch (error) {
    if (began) {
      try {
        database?.exec("ROLLBACK");
      } catch {
        // Preserve the publication failure.
      }
    }
    if (error instanceof Error && /busy|locked/iu.test(error.message)) {
      throw new ProjectReadModelBusyError({ cause: error });
    }
    throw error;
  } finally {
    database?.close();
  }
};

export const withProjectReadModel = async <Result>(
  repoRoot: string,
  read: (database: DatabaseSync, metadata: ProjectReadModelMetadata) => Result,
): Promise<Result> => {
  let database: DatabaseSync | undefined;
  try {
    database = await openDatabase(projectReadModelPath(repoRoot), { readOnly: true });
    configure(database);
    const version = assertSchema(database);
    if (version !== PROJECT_READ_MODEL_STORAGE_VERSION) {
      throw new Error("Project Read Model storage version is incompatible.");
    }
    database.exec("BEGIN");
    const metadata = readMetadata(database, version);
    const result = read(database, metadata);
    database.exec("COMMIT");
    return result;
  } finally {
    database?.close();
  }
};

export type ProjectProviderEvidence = Readonly<{
  bindingKey: string;
  role: "bound" | "detail";
  observation?: MattSkillsV1ProviderObservation;
  selection: ProviderObservationSelection;
}>;

const projectProviderEvidence = (
  database: DatabaseSync,
  role?: ProjectProviderEvidence["role"],
): readonly ProjectProviderEvidence[] =>
  database
    .prepare(
      role === undefined
        ? "SELECT binding_key, role, observation_json, selection_json FROM provider_evidence ORDER BY binding_key, role"
        : "SELECT binding_key, role, observation_json, selection_json FROM provider_evidence WHERE role = ? ORDER BY binding_key",
    )
    .all(...(role === undefined ? [] : [role]))
    .map((row) => {
      const parsedRole = z.enum(["bound", "detail"]).parse(row["role"]);
      const selection = providerObservationSelectionSchema.parse(
        parseJson(row["selection_json"]),
      ) as ProviderObservationSelection;
      return {
        bindingKey: z.string().parse(row["binding_key"]),
        role: parsedRole,
        selection,
        ...(typeof row["observation_json"] === "string"
          ? {
              observation: mattSkillsV1ProviderObservationSchema.parse(
                parseJson(row["observation_json"]),
              ) as MattSkillsV1ProviderObservation,
            }
          : {}),
      };
    });

export const readProjectProviderEvidence = async (
  repoRoot: string,
  role?: ProjectProviderEvidence["role"],
): Promise<readonly ProjectProviderEvidence[]> =>
  withProjectReadModel(repoRoot, (database) => projectProviderEvidence(database, role));

export const replaceProjectProviderEvidence = async (
  repoRoot: string,
  evidence: ProjectProviderEvidence,
): Promise<void> => {
  let database: DatabaseSync | undefined;
  let began = false;
  try {
    database = await openDatabase(projectReadModelPath(repoRoot));
    configure(database);
    const version = assertSchema(database);
    if (version !== PROJECT_READ_MODEL_STORAGE_VERSION) {
      throw new Error("Project Read Model storage version is incompatible.");
    }
    database.exec("BEGIN IMMEDIATE");
    began = true;
    const metadata = readMetadata(database, version);
    const observation = evidence.observation;
    const existing = database
      .prepare(
        "SELECT observation_id, source_revision, observation_json FROM provider_evidence WHERE binding_key = ? AND role = ?",
      )
      .get(evidence.bindingKey, evidence.role);
    if (
      evidence.role === "bound" &&
      (existing === undefined ||
        existing["observation_id"] !== (observation?.id ?? null) ||
        existing["source_revision"] !== (observation?.sourceRevision ?? null) ||
        existing["observation_json"] !== (observation === undefined ? null : json(observation)))
    ) {
      throw new Error(
        "Scoped bound evidence replacement cannot change the selected observation outside generation publication.",
      );
    }
    database
      .prepare(
        "INSERT INTO provider_evidence(binding_key, role, observation_id, source_revision, observation_json, selection_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(binding_key, role) DO UPDATE SET observation_id = excluded.observation_id, source_revision = excluded.source_revision, observation_json = excluded.observation_json, selection_json = excluded.selection_json",
      )
      .run(
        evidence.bindingKey,
        evidence.role,
        observation?.id ?? null,
        observation?.sourceRevision ?? null,
        observation === undefined ? null : json(observation),
        json(evidence.selection),
      );
    validatePayloads(database, metadata.projectionVersion);
    if (readMetadata(database, version).basisFingerprint !== metadata.basisFingerprint) {
      throw new Error("Scoped provider evidence replacement changed the Project generation.");
    }
    database.exec("COMMIT");
    began = false;
  } catch (error) {
    if (began) {
      try {
        database?.exec("ROLLBACK");
      } catch {
        // Preserve the scoped replacement failure.
      }
    }
    if (error instanceof Error && /busy|locked/iu.test(error.message)) {
      throw new ProjectReadModelBusyError({ cause: error });
    }
    throw error;
  } finally {
    database?.close();
  }
};
