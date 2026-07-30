import { join } from "node:path";
import packageMetadata from "../../package.json";
import { readProjectSnapshotCache } from "../project-snapshot/cache";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import { buildProjectSnapshot } from "../project-snapshot/projection";
import type { ProviderObservationIntent } from "../provider-observation-store";
import { commitSyncPlan, prepareSync, type SyncPlan } from "../sync-plan";
import { createSyncReceipt, readSyncReceipt, type SyncReceipt } from "../sync-receipt";
import { commitProjectCache } from "./project-cache-transaction";
import type { ProjectOperationMode } from "./project-coordinator";
import type { ProjectGenerationGraphAccess } from "./project-generation-graph-host";

export type ProjectMaterializerErrorCode =
  | "input-validation-failed"
  | "sync-failed"
  | "snapshot-materialization-failed"
  | "snapshot-write-failed";
export type ProjectWritePhase = "sync" | "cache";
export type ProjectWriteAuthorizer = (
  phase: ProjectWritePhase,
  operation: () => Promise<unknown>,
) => Promise<unknown>;

export class ProjectMaterializerError extends Error {
  readonly name = "ProjectMaterializerError";

  constructor(
    readonly code: ProjectMaterializerErrorCode,
    message: string,
    cause: unknown,
  ) {
    super(message, { cause });
  }
}

type ProjectMaterializationBase = Readonly<{
  reconciliation?: "applied" | "no-op";
  snapshotDisposition: "reused" | "materialized";
  snapshot: ProjectSnapshot;
  receipt?: SyncReceipt;
}>;
export type ProjectMaterializationResult =
  | (ProjectMaterializationBase &
      Readonly<{
        mode: "ensure-current";
        outcome: "checked" | "materialized" | "synced";
      }>)
  | (ProjectMaterializationBase &
      Readonly<{
        mode: "force";
        outcome: "applied" | "no-op";
      }>);

type Dependencies = Readonly<{
  prepare: typeof prepareSync;
  commit: typeof commitSyncPlan;
  buildSnapshot: typeof buildProjectSnapshot;
  readSnapshot: typeof readProjectSnapshotCache;
  readReceipt: typeof readSyncReceipt;
  commitCache: typeof commitProjectCache;
}>;

const currentSnapshot = (
  cache: Awaited<ReturnType<typeof readProjectSnapshotCache>>,
  packageVersion: string,
): ProjectSnapshot | undefined =>
  cache.kind === "available" && cache.snapshot.producer.packageVersion === packageVersion
    ? cache.snapshot
    : undefined;
const availableReceipt = (
  result: Awaited<ReturnType<typeof readSyncReceipt>>,
): SyncReceipt | undefined => (result.kind === "available" ? result.receipt : undefined);
const phase = async <T>(
  code: ProjectMaterializerErrorCode,
  message: string,
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProjectMaterializerError) throw error;
    throw new ProjectMaterializerError(code, message, error);
  }
};

export const createProjectMaterializer = (options: {
  readonly packageVersion: string;
  readonly packageName?: string;
  readonly now?: () => string;
  readonly dependencies?: Partial<Dependencies>;
}) => {
  const dependencies: Dependencies = {
    prepare: options.dependencies?.prepare ?? prepareSync,
    commit: options.dependencies?.commit ?? commitSyncPlan,
    buildSnapshot: options.dependencies?.buildSnapshot ?? buildProjectSnapshot,
    readSnapshot: options.dependencies?.readSnapshot ?? readProjectSnapshotCache,
    readReceipt: options.dependencies?.readReceipt ?? readSyncReceipt,
    commitCache: options.dependencies?.commitCache ?? commitProjectCache,
  };
  const now = options.now ?? (() => new Date().toISOString());
  const packageName = options.packageName ?? packageMetadata.name;
  const receiptAt = async (repoRoot: string): Promise<SyncReceipt | undefined> =>
    phase("input-validation-failed", "Project cache validation failed.", async () =>
      availableReceipt(
        await dependencies.readReceipt(join(repoRoot, ".bearing/cache/sync-receipt.json")),
      ),
    );
  const correspondingReceiptAt = async (
    repoRoot: string,
    snapshot: ProjectSnapshot,
  ): Promise<SyncReceipt | undefined> => {
    const receipt = await receiptAt(repoRoot);
    return receipt?.sitemap.fingerprint === snapshot.basis.sitemapFingerprint ? receipt : undefined;
  };
  const buildFor = async (repoRoot: string, plan: SyncPlan): Promise<ProjectSnapshot> => {
    const snapshot = await phase(
      "snapshot-materialization-failed",
      "Project Snapshot materialization failed.",
      async () =>
        dependencies.buildSnapshot({
          repoRoot,
          packageVersion: options.packageVersion,
          sitemapFingerprint: plan.fingerprint,
          diagnostics: plan.diagnostics,
          advisoryFreshness: plan.advisoryFreshness,
          decoded: plan.decoded,
          providerObservations: plan.providerObservations,
          providerObservationSelections: plan.providerObservationSelections,
          assetContentObservations: plan.assetContentObservations,
          planningGraph: plan.planningGraph,
        }),
    );
    return snapshot;
  };
  const createReceiptFor = (plan: SyncPlan): SyncReceipt =>
    createSyncReceipt({
      producer: { packageName, packageVersion: options.packageVersion },
      completedAt: now(),
      sitemap: { version: 1, fingerprint: plan.fingerprint },
      reconciliation: plan.changed ? "applied" : "no-op",
    });
  const executeWrite = async (
    executor: ProjectWriteAuthorizer | undefined,
    writePhase: ProjectWritePhase,
    errorCode: ProjectMaterializerErrorCode,
    errorMessage: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    await phase("input-validation-failed", "Project write authorization failed.", async () =>
      executor === undefined
        ? phase(errorCode, errorMessage, operation)
        : executor(writePhase, () => phase(errorCode, errorMessage, operation)),
    );
  };
  const executeCoherentWrite = async (
    executor: ProjectWriteAuthorizer | undefined,
    operation: () => Promise<void>,
  ): Promise<void> =>
    phase("input-validation-failed", "Project write authorization failed.", async () => {
      const authorizedCache = () =>
        executor === undefined
          ? operation()
          : executor("cache", () =>
              phase("snapshot-write-failed", "Project cache commit failed.", operation),
            );
      if (executor === undefined) {
        await phase("snapshot-write-failed", "Project cache commit failed.", operation);
        return;
      }
      await executor("sync", authorizedCache);
    });

  return Object.freeze({
    async run(
      repoRoot: string,
      mode: ProjectOperationMode,
      writeExecutor?: ProjectWriteAuthorizer,
      generationGraph?: ProjectGenerationGraphAccess,
      providerObservationIntent: ProviderObservationIntent = "ordinary-sync",
    ): Promise<ProjectMaterializationResult> {
      const currentGraph = generationGraph?.current();
      const initial = await phase(
        "input-validation-failed",
        "Project inputs could not be validated.",
        async () =>
          dependencies.prepare(repoRoot, {
            ...(currentGraph === undefined ? {} : { planningGraph: currentGraph }),
            providerObservationIntent,
          }),
      );
      const complete = (result: ProjectMaterializationResult): ProjectMaterializationResult => {
        generationGraph?.publish(initial.planningGraph);
        return result;
      };
      const cache = await phase(
        "input-validation-failed",
        "Project Snapshot cache could not be validated.",
        async () => dependencies.readSnapshot(repoRoot, initial.fingerprint),
      );
      const reusable = currentSnapshot(cache, options.packageVersion);
      if (mode === "ensure-current" && !initial.changed && reusable !== undefined) {
        const receipt = await correspondingReceiptAt(repoRoot, reusable);
        return complete({
          mode,
          outcome: "checked",
          snapshotDisposition: "reused",
          snapshot: reusable,
          ...(receipt === undefined ? {} : { receipt }),
        });
      }

      const snapshot =
        initial.changed || reusable === undefined ? await buildFor(repoRoot, initial) : reusable;
      const plan = initial;
      if (mode === "ensure-current" && !plan.changed) {
        const receipt = await correspondingReceiptAt(repoRoot, snapshot);
        await executeWrite(
          writeExecutor,
          "cache",
          "snapshot-write-failed",
          "Project Snapshot could not be saved.",
          async () => {
            await dependencies.commitCache({
              repoRoot,
              snapshot,
              ...(initial.providerObservationStoreChanged
                ? {
                    providerObservationStore: {
                      bytes: initial.providerObservationStoreBytes,
                    },
                  }
                : {}),
              ...(receipt === undefined ? {} : { receipt }),
            });
          },
        );
        return complete({
          mode,
          outcome: "materialized",
          snapshotDisposition: "materialized",
          snapshot,
          ...(receipt === undefined ? {} : { receipt }),
        });
      }

      const receipt = createReceiptFor(plan);
      const snapshotDisposition = snapshot === reusable ? "reused" : "materialized";
      await executeCoherentWrite(writeExecutor, async () => {
        await dependencies.commitCache({
          repoRoot,
          sync: {
            reportPath: plan.reportPath,
            sitemapPath: plan.sitemapPath,
            commit: () =>
              phase("sync-failed", "Project reconciliation failed.", async () =>
                dependencies.commit(plan, { publishProviderObservations: false }),
              ),
          },
          ...(plan.providerObservationStoreChanged
            ? {
                providerObservationStore: {
                  bytes: plan.providerObservationStoreBytes,
                },
              }
            : {}),
          ...(snapshotDisposition === "materialized" ? { snapshot } : {}),
          receipt,
        });
      });
      const common: ProjectMaterializationBase = {
        reconciliation: receipt.reconciliation,
        snapshotDisposition,
        snapshot,
        receipt,
      };
      return complete(
        mode === "force"
          ? { ...common, mode, outcome: receipt.reconciliation }
          : { ...common, mode, outcome: "synced" },
      );
    },
  });
};
