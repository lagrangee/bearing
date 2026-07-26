import packageMetadata from "../package.json";
import { applyInstallPlans } from "./installer";
import {
  prepareSync,
  type SyncPerformanceMetrics,
  syncProjectionResultFromPlan,
} from "./sync-plan";
import { buildSyncTransactionTargets } from "./sync-transaction";
import type { SyncResult } from "./types";

export const runSyncMeasured = async (
  repoRoot: string,
  options: Readonly<{ packageVersion?: string; completedAt?: string }> = {},
): Promise<Readonly<{ result: SyncResult; metrics: SyncPerformanceMetrics }>> => {
  const plan = await prepareSync(repoRoot);
  const transaction = buildSyncTransactionTargets(plan, {
    packageName: packageMetadata.name,
    packageVersion: options.packageVersion ?? packageMetadata.version,
    completedAt: options.completedAt ?? new Date().toISOString(),
  });
  await applyInstallPlans(plan.root, transaction.targets);
  return {
    result: {
      ...syncProjectionResultFromPlan(plan),
      receipt: transaction.receipt,
      receiptPath: transaction.receiptPath,
    },
    metrics: plan.metrics,
  };
};

export const runSync = async (
  repoRoot: string,
  options: Readonly<{ packageVersion?: string; completedAt?: string }> = {},
): Promise<SyncResult> => (await runSyncMeasured(repoRoot, options)).result;
