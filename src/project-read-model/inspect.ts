import { stat } from "node:fs/promises";
import { posix } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import packageMetadata from "../../package.json";
import type { AssetContentObservation, AssetContentShape } from "../asset-inputs";
import { listFiles } from "../discovery";
import { type FingerprintObservation, fingerprintInputRecords } from "../fingerprint";
import { probeContainedInput, readContainedInput } from "../input-boundary";
import { resolveRepositoryRoot } from "../path-boundary";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import { buildProjectSnapshot } from "../project-snapshot/projection";
import {
  effortSchema,
  gateSchema,
  roadmapSchema,
  structuralDiagnosticSchema,
} from "../project-snapshot/schema";
import { projectBriefSchema } from "../project-snapshot/schema-brief";
import { planningLineageSubjectProjectionSchema } from "../project-snapshot/schema-planning-lineage";
import { projectSummarySchema } from "../project-snapshot/schema-summary";
import { sourceRecordSchema } from "../project-snapshot/source-schema";
import { discoverProjectSitemapInputs } from "../sitemap-discovery";
import { prepareSync } from "../sync-plan";
import type { StructuralDiagnostic } from "../types";
import {
  PROJECT_INSPECT_ENVELOPE_VERSION,
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
  const discovery = await discoverProjectSitemapInputs(repoRoot);
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

export const materializeProjectReadModelCandidate = async (repoRoot: string) => {
  const plan = await prepareSync(repoRoot);
  const snapshot = await buildProjectSnapshot({
    repoRoot,
    packageVersion: packageMetadata.version,
    sitemapFingerprint: plan.fingerprint,
    diagnostics: plan.diagnostics,
    advisoryFreshness: plan.advisoryFreshness,
    decoded: plan.decoded,
    providerObservations: plan.providerObservations,
    providerObservationSelections: plan.providerObservationSelections,
    nativeScopeInspectionObservations: plan.nativeScopeInspectionObservations,
    nativeScopeInspectionSelections: plan.nativeScopeInspectionSelections,
    assetContentObservations: plan.assetContentObservations,
    planningGraph: plan.planningGraph,
  });
  return compileProjectReadModel({
    snapshot,
    basisFingerprint: plan.projectReadModelBasisFingerprint,
    basisInputs: plan.inputs,
    basisObservations: plan.basisObservations,
    assetContentObservations: plan.assetContentObservations,
  });
};

const ensureCurrent = async (repoRoot: string) => {
  const state = await inspectProjectReadModel(repoRoot);
  if (state.state === "need-update" || state.state === "recovery-required") return state;
  if (state.state === "ready") {
    const fingerprint = await currentBasisFingerprint(repoRoot, state.metadata);
    if (fingerprint === state.metadata.basisFingerprint) return state;
  }
  const candidate = await materializeProjectReadModelCandidate(repoRoot);
  const receipt = await publishProjectReadModel(repoRoot, candidate);
  return {
    state: "ready" as const,
    metadata: {
      storageVersion: 1,
      projectionVersion: 1,
      basisFingerprint: candidate.basisFingerprint,
      basisInputs: candidate.basisInputs,
      basisObservations: candidate.basisObservations,
      assetContentObservations: candidate.assetContentObservations,
      receipt,
    },
  };
};

const diagnostics = (database: DatabaseSync): ProjectSnapshot["diagnostics"] =>
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

export const inspectProject = async (
  repoRoot: string,
  request: ProjectInspectRequest,
): Promise<ProjectInspectEnvelope> => {
  try {
    const root = await resolveRepositoryRoot(repoRoot);
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
    return withProjectReadModel(root, (database, metadata) => {
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
  } catch (error) {
    if (error instanceof ProjectReadModelBusyError) {
      return {
        schemaVersion: PROJECT_INSPECT_ENVELOPE_VERSION,
        command: "inspect",
        outcome: "unfulfilled",
        request,
        diagnostics: [],
        result: { reason: error.code },
      };
    }
    throw error;
  }
};
