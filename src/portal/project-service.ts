import type { NativeScopeInspectionIntent } from "../native-scope-inspection";
import type { CatalogReadResult } from "./contract";
import type { ProjectOperationError } from "./project-contract";
import {
  createProjectCoordinator,
  type ProjectCoordinator,
  type ProjectOperationMode,
} from "./project-coordinator";
import type { AvailableProjectEntry } from "./project-entry";
import { createProjectEntryResolver } from "./project-entry-resolution";
import {
  createProjectGenerationGraphHost,
  type ProjectGenerationGraphAccess,
  type ProjectGenerationGraphHost,
} from "./project-generation-graph-host";
import { projectLocationChangedFailure } from "./project-location-change";
import {
  createProjectMaterializer,
  type ProjectMaterializationResult,
  type ProjectWriteAuthorizer,
} from "./project-materializer";
import { operationError } from "./project-operation-error";
import { readCurrentProject } from "./project-read-recovery";
import type {
  EntryFailure,
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

type CapturedProjectOperation =
  | Readonly<{ kind: "entry-failure"; result: EntryFailure }>
  | Readonly<{
      kind: "completed";
      entry: AvailableProjectEntry;
      result: ProjectMaterializationResult;
      repoView: ProjectRepoView;
    }>
  | Readonly<{
      kind: "failed";
      entry: AvailableProjectEntry;
      error: ProjectOperationError;
      repoView?: ProjectRepoView;
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
  const attemptedRoots = new Map<string, string>();
  let coordinator: ProjectCoordinator<CapturedProjectOperation>;
  coordinator = createProjectCoordinator<CapturedProjectOperation>({
    run: async (operation) => {
      const resolution = await resolveWithLocator(operation.entryId);
      if (resolution.locatorRevision !== undefined) {
        attemptedRoots.set(operation.entryId, resolution.locatorRevision);
      }
      const resolved = resolution.result;
      if (resolved.kind !== "available") {
        return {
          kind: "entry-failure",
          result: resolved,
        };
      }
      const entry = resolved.entry;
      attemptedRoots.set(entry.entryId, entry.repoRoot);
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
        return captured;
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error : new Error("Unknown project operation failure.");
        let repoView: ProjectRepoView | undefined;
        try {
          repoView = await readProjectRepoView(entry.repoRoot, true, options.packageVersion);
        } catch {
          repoView = undefined;
        }
        return {
          kind: "failed",
          entry,
          error: operationError(normalizedError),
          ...(repoView === undefined ? {} : { repoView }),
        };
      }
    },
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const locatorChanged = (entryId: string, repoRoot: string): boolean => {
    const attempted = attemptedRoots.get(entryId);
    return attempted !== undefined && attempted !== repoRoot;
  };
  const validationFor = (entryId: string, repoRoot?: string) => {
    const validation = coordinator.status({ entryId });
    return repoRoot !== undefined && locatorChanged(entryId, repoRoot)
      ? { ...validation, due: true, cooldownRemainingMs: 0 }
      : validation;
  };

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
      try {
        const initial = await resolveWithLocator(entryId);
        const mappingChanged =
          initial.locatorRevision !== undefined && locatorChanged(entryId, initial.locatorRevision);
        const coordinated = await coordinator.execute({
          entryId,
          mode: mappingChanged && mode === "ensure-current" ? "force" : mode,
          ...(initial.locatorRevision === undefined
            ? {}
            : { locatorRevision: initial.locatorRevision }),
          nativeScopeInspectionIntent,
        });
        if (coordinated.kind === "cooldown") {
          const latest = await resolve(entryId);
          if (latest.kind !== "available") return latest;
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
