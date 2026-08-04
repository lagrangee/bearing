import type { NativeScopeInspectionIntent } from "../native-scope-inspection";
import type { CatalogReadResult } from "./contract";
import {
  createProjectCoordinator,
  type ProjectCoordinator,
  type ProjectOperationMode,
} from "./project-coordinator";
import { createProjectEntryResolver } from "./project-entry-resolution";
import {
  createProjectGenerationGraphHost,
  type ProjectGenerationGraphAccess,
  type ProjectGenerationGraphHost,
} from "./project-generation-graph-host";
import { projectLocationChangedFailure } from "./project-location-change";
import {
  type CapturedProjectOperation,
  createProjectLocationRecovery,
} from "./project-location-recovery";
import {
  createProjectMaterializer,
  type ProjectMaterializationResult,
  type ProjectWriteAuthorizer,
} from "./project-materializer";
import { operationError } from "./project-operation-error";
import { readCurrentProject } from "./project-read-recovery";
import type {
  ProjectReadServiceResult,
  ProjectSyncServiceResult,
} from "./project-service-contract";
import {
  composeProjectView,
  type ProjectRepoView,
  projectRepoViewFromMaterialization,
  readProjectRepoView,
  readProjectView,
} from "./project-view";
import {
  executeWithWritesDenied,
  type ProjectOperationExecutorFactory,
} from "./project-write-executor";

type Materializer = Readonly<{
  run(
    repoRoot: string,
    mode: ProjectOperationMode,
    authorizer?: ProjectWriteAuthorizer,
    generationGraph?: ProjectGenerationGraphAccess,
    providerObservationIntent?: "ordinary-sync",
    nativeScopeInspectionIntent?: NativeScopeInspectionIntent,
  ): Promise<ProjectMaterializationResult>;
}>;

export type {
  ProjectReadServiceResult,
  ProjectSyncServiceResult,
  ProjectValidation,
} from "./project-service-contract";
export type { ProjectOperationExecutorFactory } from "./project-write-executor";
export const createProjectService = (options: {
  readonly readCatalog: () => Promise<CatalogReadResult>;
  readonly packageVersion: string;
  readonly packageName?: string;
  readonly clock?: () => number;
  readonly now?: () => string;
  readonly materializer?: Materializer;
  readonly generationGraphs?: ProjectGenerationGraphHost;
  readonly operationExecutorFor?: ProjectOperationExecutorFactory;
  readonly entryResolver?: ReturnType<typeof createProjectEntryResolver>;
}) => {
  const materializer =
    options.materializer ??
    createProjectMaterializer({
      packageVersion: options.packageVersion,
      ...(options.packageName === undefined ? {} : { packageName: options.packageName }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  const { resolve, resolveWithLocator } =
    options.entryResolver ?? createProjectEntryResolver(options.readCatalog);
  const operationExecutorFor = options.operationExecutorFor ?? executeWithWritesDenied;
  const generationGraphs = options.generationGraphs ?? createProjectGenerationGraphHost();
  let coordinator: ProjectCoordinator<CapturedProjectOperation>;
  const locationRecovery = createProjectLocationRecovery({
    execute: (entryId, mode, nativeScopeInspectionIntent) =>
      coordinator.execute({
        entryId,
        mode,
        nativeScopeInspectionIntent,
      }),
    status: (entryId) => coordinator.status({ entryId }),
  });
  coordinator = createProjectCoordinator<CapturedProjectOperation>({
    run: async (operation) => {
      const resolution = await resolveWithLocator(operation.entryId);
      if (resolution.locatorRevision !== undefined) {
        locationRecovery.observeLocator(operation.entryId, resolution.locatorRevision);
      }
      const resolved = resolution.result;
      if (resolved.kind !== "available") {
        return locationRecovery.record(operation.entryId, {
          kind: "entry-failure",
          result: resolved,
        });
      }
      const entry = resolved.entry;
      locationRecovery.observeLocator(entry.entryId, entry.repoRoot);
      try {
        const result = await operationExecutorFor(entry)(async (authorizeWrites) => {
          const retainedGraph = generationGraphs.forEntry(entry.entryId);
          const currentGraph = retainedGraph.current();
          let publication: Parameters<ProjectGenerationGraphAccess["publish"]>[0] | undefined;
          const operationGraph = Object.freeze({
            current: () => currentGraph,
            publish: (graph: Parameters<ProjectGenerationGraphAccess["publish"]>[0]): void => {
              publication = graph;
            },
          });
          const materialized = await materializer.run(
            entry.repoRoot,
            operation.mode,
            authorizeWrites,
            operationGraph,
            "ordinary-sync",
            operation.nativeScopeInspectionIntent ?? { kind: "none" },
          );
          if (publication !== undefined) {
            if (publication === currentGraph) {
              retainedGraph.publish(publication);
            } else {
              const confirmation = await resolveWithLocator(entry.entryId);
              if (confirmation.locatorRevision !== undefined) {
                locationRecovery.observeLocator(entry.entryId, confirmation.locatorRevision);
              }
              if (
                confirmation.result.kind === "available" &&
                confirmation.result.entry.repoRoot === entry.repoRoot
              ) {
                retainedGraph.publish(publication);
              }
            }
          }
          return materialized;
        });
        const captured = {
          kind: "completed",
          entry,
          result,
          repoView: projectRepoViewFromMaterialization(result),
        } as const;
        return locationRecovery.record(operation.entryId, captured);
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error : new Error("Unknown project operation failure.");
        let repoView: ProjectRepoView | undefined;
        try {
          repoView = await readProjectRepoView(entry.repoRoot, true, options.packageVersion);
        } catch {
          repoView = undefined;
        }
        return locationRecovery.record(operation.entryId, {
          kind: "failed",
          entry,
          error: operationError(normalizedError),
          ...(repoView === undefined ? {} : { repoView }),
        });
      }
    },
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const validationFor = (entryId: string, repoRoot?: string) =>
    locationRecovery.validation(entryId, repoRoot);

  return Object.freeze({
    async read(entryId: string): Promise<ProjectReadServiceResult> {
      return readCurrentProject({
        entryId,
        resolve,
        readRepo: (repoRoot) => readProjectRepoView(repoRoot, false, options.packageVersion),
        validation: validationFor,
      });
    },
    async sync(
      entryId: string,
      mode: ProjectOperationMode,
      nativeScopeInspectionIntent: NativeScopeInspectionIntent = { kind: "none" },
    ): Promise<ProjectSyncServiceResult> {
      const recoveryCheckpoint = locationRecovery.checkpoint(entryId);
      try {
        const initial = await resolve(entryId);
        const recoveryRoot =
          initial.kind === "available"
            ? locationRecovery.rootRequiringRecovery(entryId, mode, initial.entry.repoRoot)
            : undefined;
        const coordinated =
          recoveryRoot === undefined
            ? await coordinator.execute({
                entryId,
                mode,
                nativeScopeInspectionIntent,
              })
            : await locationRecovery.recover(
                entryId,
                recoveryRoot,
                recoveryCheckpoint,
                nativeScopeInspectionIntent,
              );
        if (coordinated.kind === "cooldown") {
          const latest = await resolve(entryId);
          if (latest.kind !== "available") return latest;
          const changedRoot = locationRecovery.rootRequiringRecovery(
            entryId,
            "ensure-current",
            latest.entry.repoRoot,
          );
          void changedRoot;
          return {
            kind: "cooldown",
            mode: "ensure-current",
            outcome: "cooldown",
            view: await readProjectView(latest.entry, false, options.packageVersion),
            validation: validationFor(entryId),
          };
        }
        const captured = coordinated.value;
        const latest = await resolve(entryId);
        if (latest.kind !== "available") return latest;
        const locationChanged =
          captured.kind === "entry-failure" || latest.entry.repoRoot !== captured.entry.repoRoot;
        if (locationChanged) {
          return {
            kind: "failed",
            mode,
            outcome: "failed",
            ...(await projectLocationChangedFailure(latest.entry, (entry) =>
              readProjectView(entry, false, options.packageVersion),
            )),
            validation: validationFor(entryId),
          };
        }
        if (captured.kind === "failed") {
          return {
            kind: "failed",
            mode,
            outcome: "failed",
            error: captured.error,
            ...(captured.repoView === undefined
              ? {}
              : { view: composeProjectView(latest.entry, captured.repoView) }),
            validation: validationFor(entryId),
          };
        }
        const result = captured.result;
        const view = composeProjectView(latest.entry, captured.repoView);
        const validation = validationFor(entryId);
        const reconciliation =
          result.reconciliation === undefined ? {} : { reconciliation: result.reconciliation };
        if (mode === "ensure-current") {
          return {
            kind: "completed",
            mode,
            outcome: result.mode === "force" ? "synced" : result.outcome,
            ...reconciliation,
            snapshotDisposition: result.snapshotDisposition,
            view,
            validation,
          };
        }
        if (result.mode !== "force") {
          throw new Error("Forced project operation completed with an automatic result.");
        }
        return {
          kind: "completed",
          mode,
          outcome: result.outcome,
          ...reconciliation,
          snapshotDisposition: result.snapshotDisposition,
          view,
          validation,
        };
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error : new Error("Unknown project synchronization failure.");
        return {
          kind: "failed",
          mode,
          outcome: "failed",
          error: operationError(normalizedError),
          validation: validationFor(entryId),
        };
      }
    },
  });
};
export type ProjectService = ReturnType<typeof createProjectService>;
