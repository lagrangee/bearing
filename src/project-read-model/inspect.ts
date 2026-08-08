import { stat } from "node:fs/promises";
import { posix } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import packageMetadata from "../../package.json";
import type { AssetContentObservation, AssetContentShape } from "../asset-inputs";
import { listFiles } from "../discovery";
import { type FingerprintObservation, fingerprintInputRecords } from "../fingerprint";
import { probeContainedInput, readContainedInput } from "../input-boundary";
import { discoverManagedInputs } from "../managed-input-discovery";
import { resolveRepositoryRoot } from "../path-boundary";
import { compileProjectGeneration, type ProjectCompilationOptions } from "../project-compilation";
import type { ProjectGeneration } from "../project-generation/contract";
import { buildProjectGeneration } from "../project-generation/projection";
import {
  effortSchema,
  gateSchema,
  roadmapSchema,
  structuralDiagnosticSchema,
} from "../project-generation/schema";
import { projectBriefSchema } from "../project-generation/schema-brief";
import { planningLineageSubjectProjectionSchema } from "../project-generation/schema-planning-lineage";
import { projectSummarySchema } from "../project-generation/schema-summary";
import { sourceRecordSchema } from "../project-generation/source-schema";
import type { ProviderDetailEvidenceState } from "../provider-detail-selection";
import { providerObservationSelectionSchema } from "../provider-evidence-contract";
import type { ProviderEvidenceState } from "../provider-evidence-selection";
import { mattNativeSubjectForObject } from "../providers/matt-skills-v1/native-subject";
import { mattObjects } from "../providers/matt-skills-v1/projection";
import { mattSkillsV1ProviderObservationSchema } from "../providers/matt-skills-v1/schema";
import { assertActiveRepositoryIntegration } from "../repository-integration-lifecycle";
import type { StructuralDiagnostic } from "../types";
import {
  nativeInspectResultSchema,
  PROJECT_INSPECT_ENVELOPE_VERSION,
  PROJECT_READ_MODEL_PROJECTION_VERSION,
  PROJECT_READ_MODEL_STORAGE_VERSION,
  type ProjectInspectEnvelope,
  type ProjectInspectRequest,
  planningInspectResultSchema,
  planningReferenceSchema,
  projectContextResultSchema,
} from "./contract";
import {
  compileProjectReadModel,
  inspectProjectReadModel,
  ProjectReadModelBusyError,
  type ProjectReadModelMetadata,
  publishProjectReadModel,
  readProjectProviderEvidence,
  withProjectReadModel,
} from "./store";

const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") throw new Error("Project Read Model payload is missing.");
  return JSON.parse(value);
};

const observationForAsset = async (
  repoRoot: string,
  previous: AssetContentObservation,
): Promise<AssetContentObservation> => {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(previous.location)) {
    return { ...previous, availability: "unreadable", shape: "unavailable" };
  }
  const probe = await probeContainedInput(repoRoot, previous.location);
  if (probe.status === "missing") {
    return { ...previous, availability: "missing", shape: "unavailable" };
  }
  if (probe.status === "blocked") {
    return { ...previous, availability: "unreadable", shape: "unavailable" };
  }
  const metadata = await stat(probe.path);
  const shape: AssetContentShape = metadata.isDirectory()
    ? "directory"
    : metadata.isFile()
      ? "file"
      : "unavailable";
  return {
    ...previous,
    availability: shape === "unavailable" ? "unreadable" : "available",
    shape,
  };
};

export const currentBasisFingerprint = async (
  repoRoot: string,
  metadata: ProjectReadModelMetadata,
): Promise<string | undefined> => {
  const discovery = await discoverManagedInputs(repoRoot);
  const assets = await Promise.all(
    metadata.assetContentObservations.map((observation) =>
      observationForAsset(repoRoot, observation),
    ),
  );
  const previousAssetObservations = new Map(
    metadata.assetContentObservations.map((observation) => [
      `${observation.id}\0${observation.location}`,
      observation,
    ]),
  );
  if (
    assets.some((observation) => {
      const previous = previousAssetObservations.get(`${observation.id}\0${observation.location}`);
      return (
        previous === undefined ||
        previous.availability !== observation.availability ||
        previous.shape !== observation.shape
      );
    })
  ) {
    return undefined;
  }
  const inputs = new Set(discovery.inputs);
  const discovered = new Set(discovery.inputs);
  for (const input of metadata.basisInputs) if (!discovered.has(input)) inputs.add(input);
  for (const observation of assets) {
    if (observation.availability !== "available" || observation.shape !== "directory") continue;
    const prefix = `${posix.normalize(observation.location)}/`;
    if (!metadata.basisInputs.some((input) => input.startsWith(prefix))) continue;
    for (const input of [...inputs]) if (input.startsWith(prefix)) inputs.delete(input);
    const diagnostics: StructuralDiagnostic[] = [];
    for (const input of await listFiles(repoRoot, observation.location, false, diagnostics)) {
      inputs.add(input);
    }
    if (diagnostics.length > 0) return undefined;
  }
  const records = [];
  for (const locator of [...inputs]) {
    const input = await readContainedInput(repoRoot, locator);
    if (input.status !== "available") return undefined;
    records.push({ locator, bytes: input.bytes });
  }
  const assetObservationKeys = new Set(
    metadata.assetContentObservations.map(
      (observation) => `asset-content-availability:${observation.id}:${observation.location}`,
    ),
  );
  const observations: FingerprintObservation[] = metadata.basisObservations.map((observation) => {
    if (observation.key === "repository-identity") {
      return {
        key: observation.key,
        value: fingerprintInputRecords([], [{ key: "repository-root", value: repoRoot }])
          .fingerprint,
      };
    }
    if (observation.key === "input-discovery-diagnostics") {
      return { key: observation.key, value: JSON.stringify(discovery.diagnostics) };
    }
    if (!assetObservationKeys.has(observation.key)) return observation;
    const asset = assets.find(
      (candidate) =>
        observation.key === `asset-content-availability:${candidate.id}:${candidate.location}`,
    );
    return asset === undefined
      ? observation
      : {
          key: observation.key,
          value: `${asset.availability}:${asset.shape}`,
        };
  });
  return fingerprintInputRecords(records, observations).fingerprint;
};

export const prepareProjectReadModelCandidate = async (
  repoRoot: string,
  options: Readonly<{
    providerObservationStore?: ProviderEvidenceState | null;
    providerObservationIntent?: ProjectCompilationOptions["providerObservationIntent"];
    providerFactory?: ProjectCompilationOptions["providerFactory"];
    providerObservationNow?: () => string;
    requestedProviderBindings?: ProjectCompilationOptions["requestedProviderBindings"];
    nativeReconciliationRequest?: import("../native-reconciliation-contract").NativeReconciliationRequest;
    providerDetailEvidenceIntent?: ProjectCompilationOptions["providerDetailEvidenceIntent"];
    providerDetailEvidenceState?: ProviderDetailEvidenceState | null;
  }> = {},
) => {
  const plan = await compileProjectGeneration(repoRoot, {
    ...(options.providerObservationStore === undefined
      ? {}
      : { providerObservationStore: options.providerObservationStore }),
    ...(options.providerObservationIntent === undefined
      ? {}
      : { providerObservationIntent: options.providerObservationIntent }),
    ...(options.providerFactory === undefined ? {} : { providerFactory: options.providerFactory }),
    ...(options.providerObservationNow === undefined
      ? {}
      : { providerObservationNow: options.providerObservationNow }),
    ...(options.requestedProviderBindings === undefined
      ? {}
      : { requestedProviderBindings: options.requestedProviderBindings }),
    ...(options.providerDetailEvidenceIntent !== undefined
      ? { providerDetailEvidenceIntent: options.providerDetailEvidenceIntent }
      : options.nativeReconciliationRequest === undefined
        ? {}
        : {
            providerDetailEvidenceIntent: {
              kind: "reconcile" as const,
              request: options.nativeReconciliationRequest,
            },
          }),
    ...(options.providerDetailEvidenceState === undefined
      ? {}
      : { providerDetailEvidenceState: options.providerDetailEvidenceState }),
  });
  const generation = await buildProjectGeneration({
    repoRoot,
    packageVersion: packageMetadata.version,
    basisFingerprint: plan.fingerprint,
    diagnostics: plan.diagnostics,
    advisoryFreshness: plan.advisoryFreshness,
    decoded: plan.decoded,
    providerObservations: plan.providerObservations,
    providerObservationSelections: plan.providerObservationSelections,
    providerDetailEvidenceObservations: plan.providerDetailEvidenceObservations,
    providerDetailEvidenceSelections: plan.providerDetailEvidenceSelections,
    assetContentObservations: plan.assetContentObservations,
    projectProjections: plan.projectProjections,
  });
  const candidate = compileProjectReadModel({
    snapshot: generation,
    basisFingerprint: plan.projectReadModelBasisFingerprint,
    basisInputs: plan.inputs,
    basisObservations: plan.basisObservations,
    assetContentObservations: plan.assetContentObservations,
  });
  return { candidate, plan };
};

export const materializeProjectReadModelCandidate = async (
  repoRoot: string,
  options: Parameters<typeof prepareProjectReadModelCandidate>[1] = {},
) => (await prepareProjectReadModelCandidate(repoRoot, options)).candidate;

const ensureCurrent = async (repoRoot: string) => {
  const state = await inspectProjectReadModel(repoRoot);
  if (state.state === "need-update" || state.state === "recovery-required") return state;
  if (state.state === "ready") {
    const fingerprint = await currentBasisFingerprint(repoRoot, state.metadata);
    if (fingerprint === state.metadata.basisFingerprint) return state;
  }
  const providerEvidence =
    state.state === "ready" || state.state === "obsolete-compatible"
      ? await readProjectProviderEvidence(repoRoot)
      : undefined;
  const providerObservationStore =
    providerEvidence === undefined
      ? undefined
      : {
          schemaVersion: 1 as const,
          observations: providerEvidence.flatMap((entry) =>
            entry.role === "bound" && entry.observation !== undefined ? [entry.observation] : [],
          ),
          selections: providerEvidence.flatMap((entry) =>
            entry.role === "bound" ? [entry.selection] : [],
          ),
        };
  const candidate = await materializeProjectReadModelCandidate(repoRoot, {
    ...(providerObservationStore === undefined ? {} : { providerObservationStore }),
    ...(providerEvidence === undefined ? {} : { providerDetailEvidenceState: null }),
  });
  const receipt = await publishProjectReadModel(repoRoot, candidate);
  return {
    state: "ready" as const,
    metadata: {
      storageVersion: PROJECT_READ_MODEL_STORAGE_VERSION,
      projectionVersion: PROJECT_READ_MODEL_PROJECTION_VERSION,
      basisFingerprint: candidate.basisFingerprint,
      basisInputs: candidate.basisInputs,
      basisObservations: candidate.basisObservations,
      assetContentObservations: candidate.assetContentObservations,
      receipt,
    },
  };
};

const diagnostics = (database: DatabaseSync): ProjectGeneration["diagnostics"] =>
  database
    .prepare("SELECT payload_json FROM project_diagnostics ORDER BY impact, reference")
    .all()
    .map((row) => structuralDiagnosticSchema.parse(parseJson(row["payload_json"])));

const projectResult = (database: DatabaseSync, metadata: ProjectReadModelMetadata) => {
  const summaryRow = database
    .prepare("SELECT payload_json FROM project_objects WHERE reference = 'project-summary:current'")
    .get();
  const summary =
    summaryRow === undefined
      ? { validity: "absent" as const }
      : {
          validity: "available" as const,
          value: projectSummarySchema.parse(parseJson(summaryRow["payload_json"])),
        };
  const briefRow = database
    .prepare("SELECT payload_json FROM project_objects WHERE reference = 'project-brief:current'")
    .get();
  const brief =
    briefRow === undefined
      ? { validity: "absent" as const }
      : {
          validity: "available" as const,
          value: projectBriefSchema.parse(parseJson(briefRow["payload_json"])),
        };
  const roadmaps = database
    .prepare(
      "SELECT payload_json FROM project_objects WHERE kind = 'roadmap' ORDER BY ordinal LIMIT 50",
    )
    .all()
    .map((row) => roadmapSchema.parse(parseJson(row["payload_json"])));
  const gateQuery = database.prepare(
    "SELECT payload_json FROM project_objects WHERE kind = 'gate' AND reference = ?",
  );
  const gates = new Map(
    roadmaps.flatMap((roadmap) => {
      if (roadmap.focusedGateId === null) return [];
      const row = gateQuery.get(roadmap.focusedGateId);
      if (row === undefined) return [];
      const gate = gateSchema.parse(parseJson(row["payload_json"]));
      return [[gate.id, gate] as const];
    }),
  );
  const efforts = database
    .prepare(
      "SELECT payload_json FROM project_objects WHERE kind = 'effort' ORDER BY ordinal LIMIT 100",
    )
    .all()
    .map((row) => effortSchema.parse(parseJson(row["payload_json"])));
  const projectDiagnostics = diagnostics(database);
  const attentionCount = database
    .prepare("SELECT count(*) AS count FROM project_attention")
    .get()?.["count"];
  if (typeof attentionCount !== "number") {
    throw new Error("Project Read Model Attention count is unavailable.");
  }
  const sourceReferences = [
    ...(summary.validity === "available" ? [summary.value.source] : []),
    ...(brief.validity === "available" ? [brief.value.source] : []),
    ...roadmaps.map((roadmap) => roadmap.source),
    ...[...gates.values()].map((gate) => gate.source),
    ...efforts.map((effort) => effort.source),
  ];
  const sourceQuery = database.prepare(
    "SELECT payload_json FROM project_sources WHERE reference = ?",
  );
  const sources = [...new Set(sourceReferences)]
    .sort()
    .slice(0, 100)
    .flatMap((reference) => {
      const row = sourceQuery.get(reference);
      return row === undefined ? [] : [sourceRecordSchema.parse(parseJson(row["payload_json"]))];
    });
  const deeperReads = database
    .prepare(
      "SELECT reference FROM project_objects WHERE kind IN ('roadmap', 'gate', 'effort', 'authority', 'asset', 'planning-review') ORDER BY kind, ordinal LIMIT 200",
    )
    .all()
    .flatMap((row) => (typeof row["reference"] === "string" ? [row["reference"]] : []));
  return projectContextResultSchema.parse({
    basis: {
      fingerprint: metadata.basisFingerprint,
      publicationCount: metadata.receipt.publicationCount,
      publishedAt: metadata.receipt.publishedAt,
    },
    summary,
    brief,
    sources,
    roadmapFocus: roadmaps.map((roadmap) => {
      const focusedGate =
        roadmap.focusedGateId === null ? undefined : gates.get(roadmap.focusedGateId);
      return {
        roadmap: { id: roadmap.id, title: roadmap.title, lifecycle: roadmap.lifecycle },
        ...(focusedGate === undefined
          ? {}
          : {
              focusedGate: {
                id: focusedGate.id,
                title: focusedGate.title,
                lifecycle: focusedGate.lifecycle,
                readiness: focusedGate.readiness,
              },
            }),
      };
    }),
    scopeOutline: efforts.map((effort) => ({
      effortId: effort.id,
      title: effort.title,
      lifecycle: effort.lifecycle,
      targetGateId: effort.targetGateId,
      binding:
        effort.workBindingState.state === "bound" && effort.workBinding !== undefined
          ? { state: "bound" as const, nativeScope: effort.workBinding.nativeScope }
          : {
              state: "attention" as const,
              reason:
                effort.workBindingState.state === "invalid"
                  ? effort.workBindingState.reason
                  : "missing",
            },
    })),
    attentionCount,
    diagnosticCounts: {
      blocking: projectDiagnostics.filter((diagnostic) => diagnostic.impact === "blocking").length,
      nonBlocking: projectDiagnostics.filter((diagnostic) => diagnostic.impact === "non-blocking")
        .length,
    },
    deeperReads,
  });
};

const planningResult = (
  database: DatabaseSync,
  metadata: ProjectReadModelMetadata,
  reference: string,
) => {
  const row = database
    .prepare("SELECT kind, payload_json FROM project_objects WHERE reference = ?")
    .get(reference);
  if (row === undefined) return undefined;
  const contextRow = database
    .prepare("SELECT payload_json FROM subject_contexts WHERE reference = ?")
    .get(reference);
  const directRelations = database
    .prepare(
      "SELECT payload_json FROM project_relations WHERE source_reference = ? GROUP BY relation_key ORDER BY relation_key",
    )
    .all(reference)
    .map((relation) => parseJson(relation["payload_json"]));
  const payload = parseJson(row["payload_json"]) as { readonly source?: string };
  const source =
    payload.source === undefined
      ? undefined
      : database
          .prepare("SELECT payload_json FROM project_sources WHERE reference = ?")
          .get(payload.source);
  const parsedSource =
    source === undefined ? undefined : sourceRecordSchema.parse(parseJson(source["payload_json"]));
  const context =
    contextRow === undefined
      ? undefined
      : planningLineageSubjectProjectionSchema.parse(parseJson(contextRow["payload_json"]));
  const diagnosticTargets = [
    reference,
    ...(payload.source === undefined ? [] : [payload.source]),
    ...(parsedSource === undefined ? [] : [parsedSource.displayLocator]),
  ];
  const scopedDiagnostics = database
    .prepare(
      "SELECT payload_json FROM project_diagnostics WHERE target IN (?, ?, ?) ORDER BY impact, reference",
    )
    .all(diagnosticTargets[0] ?? "", diagnosticTargets[1] ?? "", diagnosticTargets[2] ?? "")
    .map((diagnostic) => structuralDiagnosticSchema.parse(parseJson(diagnostic["payload_json"])));
  return planningInspectResultSchema.parse({
    target: { kind: row["kind"], value: payload },
    directRelations,
    coverage:
      context === undefined
        ? { state: "unavailable" }
        : {
            state: "available",
            parentPath: context.parentPath,
            semanticSections: context.semanticSections,
          },
    diagnostics: scopedDiagnostics,
    revision: {
      generationFingerprint: metadata.basisFingerprint,
      ...(parsedSource === undefined ? {} : { source: parsedSource }),
    },
  });
};

const nativeResult = (
  database: DatabaseSync,
  metadata: ProjectReadModelMetadata,
  reference: string,
) => {
  const rows = database
    .prepare(
      "SELECT observation_json, selection_json FROM provider_evidence WHERE role = 'bound' ORDER BY binding_key",
    )
    .all();
  for (const row of rows) {
    const selection = providerObservationSelectionSchema.parse(parseJson(row["selection_json"]));
    const observation =
      typeof row["observation_json"] === "string"
        ? mattSkillsV1ProviderObservationSchema.parse(parseJson(row["observation_json"]))
        : undefined;
    const relativeNativeReference = posix.relative(selection.nativeScope, reference);
    const locallyContained =
      selection.nativeScope.startsWith(".") &&
      relativeNativeReference !== "" &&
      relativeNativeReference !== ".." &&
      !relativeNativeReference.startsWith("../") &&
      !posix.isAbsolute(relativeNativeReference);
    const subjectMatched =
      reference === selection.nativeScope ||
      locallyContained ||
      (observation !== undefined &&
        mattObjects(observation).some(
          (candidate) =>
            mattNativeSubjectForObject(candidate).id === reference ||
            (candidate.native.kind === "github" && candidate.native.identity.url === reference),
        ));
    if (!subjectMatched) continue;
    const planningReferences = database
      .prepare("SELECT reference, payload_json FROM project_objects WHERE kind = 'effort'")
      .all()
      .flatMap((effortRow) => {
        const effort = effortSchema.parse(parseJson(effortRow["payload_json"]));
        return effort.workBinding?.nativeScope === selection.nativeScope ? [effort.id] : [];
      });
    return nativeInspectResultSchema.parse({
      reference,
      binding: {
        state: "bound",
        provider: selection.provider,
        nativeScope: selection.nativeScope,
        role: "bound",
        observationId: selection.observationId,
        effectiveFreshness: selection.effectiveFreshness,
        planningReferences,
      },
      coverage:
        observation === undefined
          ? { state: "unavailable" }
          : {
              state: "available",
              assessment: observation.coverage.assessment,
              completion: observation.completion,
            },
      generationFingerprint: metadata.basisFingerprint,
    });
  }
  return nativeInspectResultSchema.parse({
    reference,
    binding: { state: "unbound" },
    coverage: { state: "unavailable" },
    generationFingerprint: metadata.basisFingerprint,
  });
};

const queryCommittedProjectReadModel = (
  root: string,
  request: ProjectInspectRequest,
): Promise<ProjectInspectEnvelope> =>
  withProjectReadModel(root, (database, metadata) => {
    const base = {
      schemaVersion: PROJECT_INSPECT_ENVELOPE_VERSION,
      command: "inspect" as const,
      request,
      generation: metadata.receipt,
    };
    if (request.kind === "diagnostics") {
      const projectDiagnostics = diagnostics(database);
      const blocked = projectDiagnostics.some((diagnostic) => diagnostic.impact === "blocking");
      return {
        ...base,
        outcome: blocked ? ("partial" as const) : ("complete" as const),
        diagnostics: projectDiagnostics,
        result: projectDiagnostics,
      };
    }
    if (request.kind === "project") {
      const projectDiagnostics = diagnostics(database);
      const blocked = projectDiagnostics.some((diagnostic) => diagnostic.impact === "blocking");
      return {
        ...base,
        outcome: blocked ? ("partial" as const) : ("complete" as const),
        diagnostics: projectDiagnostics,
        result: projectResult(database, metadata),
      };
    }
    if (request.kind === "native-reference") {
      const result = nativeResult(database, metadata, request.reference);
      return {
        ...base,
        outcome: "complete" as const,
        diagnostics: [],
        result,
      };
    }
    const reference = planningReferenceSchema.parse(request.reference);
    const result = planningResult(database, metadata, reference);
    return result === undefined
      ? { ...base, outcome: "unfulfilled" as const, diagnostics: [] }
      : {
          ...base,
          outcome: result.diagnostics.some((diagnostic) => diagnostic.impact === "blocking")
            ? ("partial" as const)
            : ("complete" as const),
          diagnostics: result.diagnostics,
          result,
        };
  });

const busyProjectInspectEnvelope = (request: ProjectInspectRequest): ProjectInspectEnvelope => ({
  schemaVersion: PROJECT_INSPECT_ENVELOPE_VERSION,
  command: "inspect",
  outcome: "unfulfilled",
  request,
  diagnostics: [],
  result: { reason: "project-read-model-busy" },
});

export const queryCommittedProject = async (
  repoRoot: string,
  request: ProjectInspectRequest,
): Promise<ProjectInspectEnvelope> => {
  const root = await resolveRepositoryRoot(repoRoot);
  await assertActiveRepositoryIntegration(root, "inspect");
  try {
    return await queryCommittedProjectReadModel(root, request);
  } catch (error) {
    if (error instanceof ProjectReadModelBusyError) return busyProjectInspectEnvelope(request);
    throw error;
  }
};

export const inspectProject = async (
  repoRoot: string,
  request: ProjectInspectRequest,
): Promise<ProjectInspectEnvelope> => {
  try {
    const root = await resolveRepositoryRoot(repoRoot);
    await assertActiveRepositoryIntegration(root, "inspect");
    const current = await ensureCurrent(root);
    if (current.state === "need-update") {
      return {
        schemaVersion: PROJECT_INSPECT_ENVELOPE_VERSION,
        command: "inspect",
        outcome: "need-update",
        request,
        diagnostics: [],
      };
    }
    if (current.state === "recovery-required") {
      return {
        schemaVersion: PROJECT_INSPECT_ENVELOPE_VERSION,
        command: "inspect",
        outcome: "recovery-required",
        request,
        diagnostics: [],
        result: { reason: current.reason },
      };
    }
    return queryCommittedProjectReadModel(root, request);
  } catch (error) {
    if (error instanceof ProjectReadModelBusyError) return busyProjectInspectEnvelope(request);
    throw error;
  }
};
