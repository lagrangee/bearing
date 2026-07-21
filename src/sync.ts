import { dirname, join } from "node:path";
import packageMetadata from "../package.json";
import { commitSyncPlan, prepareSync, type SyncPerformanceMetrics } from "./sync-plan";
import { createSyncReceipt, writeSyncReceipt } from "./sync-receipt";
import type { SyncResult } from "./types";

export const runSyncMeasured = async (
  repoRoot: string,
  options: Readonly<{ packageVersion?: string; completedAt?: string }> = {},
): Promise<Readonly<{ result: SyncResult; metrics: SyncPerformanceMetrics }>> => {
  const plan = await prepareSync(repoRoot);
  const result = await commitSyncPlan(plan);
  const receipt = createSyncReceipt({
    producer: {
      packageName: packageMetadata.name,
      packageVersion: options.packageVersion ?? packageMetadata.version,
    },
    completedAt: options.completedAt ?? new Date().toISOString(),
    sitemap: { version: 1, fingerprint: result.fingerprint },
    reconciliation: result.changed ? "applied" : "no-op",
  });
  const receiptPath = join(dirname(result.sitemapPath), "sync-receipt.json");
  await writeSyncReceipt(receiptPath, receipt);
  return { result: { ...result, receipt, receiptPath }, metrics: plan.metrics };
};

export const runSync = async (
  repoRoot: string,
  options: Readonly<{ packageVersion?: string; completedAt?: string }> = {},
): Promise<SyncResult> => (await runSyncMeasured(repoRoot, options)).result;
