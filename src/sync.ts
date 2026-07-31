import packageMetadata from "../package.json";
import { applyInstallPlans } from "./installer";
import type { NativeReconciliationRequest } from "./native-reconciliation-contract";
import type { NativeScopeDiscoveryIntent } from "./native-scope-discovery";
import type { ProviderObservationIntent } from "./provider-observation-store";
import {
  prepareSync,
  type SyncPerformanceMetrics,
  syncProjectionResultFromPlan,
} from "./sync-plan";
import { buildSyncTransactionTargets } from "./sync-transaction";
import type { SyncResult } from "./types";

type RunSyncOptions = Readonly<{
  packageVersion?: string;
  completedAt?: string;
  providerObservationIntent?: ProviderObservationIntent;
  nativeScopeDiscoveryIntent?: NativeScopeDiscoveryIntent;
  nativeReconciliationRequest?: NativeReconciliationRequest;
}>;

export const runSyncMeasured = async (
  repoRoot: string,
  options: RunSyncOptions = {},
): Promise<Readonly<{ result: SyncResult; metrics: SyncPerformanceMetrics }>> => {
  const plan = await prepareSync(repoRoot, {
    ...(options.providerObservationIntent === undefined
      ? {}
      : { providerObservationIntent: options.providerObservationIntent }),
    ...(options.nativeScopeDiscoveryIntent === undefined
      ? {}
      : { nativeScopeDiscoveryIntent: options.nativeScopeDiscoveryIntent }),
    ...(options.nativeReconciliationRequest === undefined
      ? {}
      : {
          nativeScopeInspectionIntent: {
            kind: "reconcile" as const,
            request: options.nativeReconciliationRequest,
          },
        }),
  });
  const transaction = buildSyncTransactionTargets(plan, {
    packageName: packageMetadata.name,
    packageVersion: options.packageVersion ?? packageMetadata.version,
    completedAt: options.completedAt ?? new Date().toISOString(),
  });
  await applyInstallPlans(plan.root, transaction.targets);
  return {
    result: {
      ...syncProjectionResultFromPlan(plan),
      providerObservationOperation: plan.providerObservationOperation,
      nativeScopeDiscoveryOperation: plan.nativeScopeDiscoveryOperation,
      nativeScopeInspectionOperation: plan.nativeScopeInspectionOperation,
      receipt: transaction.receipt,
      receiptPath: transaction.receiptPath,
    },
    metrics: plan.metrics,
  };
};

export const runSync = async (
  repoRoot: string,
  options: RunSyncOptions = {},
): Promise<SyncResult> => (await runSyncMeasured(repoRoot, options)).result;
