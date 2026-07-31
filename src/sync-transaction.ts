import { dirname, join } from "node:path";
import type { TargetPlan } from "./install-manifest";
import { assessNativeReconciliation } from "./native-reconciliation-assessment";
import type { SyncPlan } from "./sync-plan";
import { createSyncReceipt, type SyncReceipt } from "./sync-receipt";

export type SyncTransactionTargets = Readonly<{
  targets: readonly TargetPlan[];
  receipt: SyncReceipt;
  receiptPath: string;
}>;

export const buildSyncTransactionTargets = (
  plan: SyncPlan,
  producer: Readonly<{
    packageName: string;
    packageVersion: string;
    completedAt: string;
  }>,
): SyncTransactionTargets => {
  const inspectionIntent = plan.nativeScopeInspectionOperation.intent;
  const operation =
    inspectionIntent.kind === "reconcile"
      ? (() => {
          const assessment = assessNativeReconciliation({
            request: inspectionIntent.request,
            boundSelections: plan.providerObservationSelections,
            inspectionSelections: plan.nativeScopeInspectionSelections,
          });
          return {
            kind: "native-reconciliation" as const,
            requestFingerprint: assessment.requestFingerprint,
            outcome: assessment.outcome,
          };
        })()
      : ({ kind: "sync" } as const);
  const receipt = createSyncReceipt({
    producer: {
      packageName: producer.packageName,
      packageVersion: producer.packageVersion,
    },
    completedAt: producer.completedAt,
    sitemap: { version: 1, fingerprint: plan.fingerprint },
    reconciliation: plan.changed ? "applied" : "no-op",
    operation,
  });
  const receiptPath = join(dirname(plan.sitemapPath), "sync-receipt.json");
  const targets: TargetPlan[] = [
    {
      target: plan.reportPath,
      bytes: plan.report,
      executable: false,
    },
    {
      target: plan.sitemapPath,
      bytes: plan.sitemap,
      executable: false,
    },
    {
      target: receiptPath,
      bytes: Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
      executable: false,
    },
  ];
  if (plan.providerObservationStoreChanged) {
    targets.splice(2, 0, {
      target: plan.providerObservationStorePath,
      bytes: plan.providerObservationStoreBytes,
      executable: false,
    });
  }
  if (plan.nativeScopeDiscoveryStoreChanged) {
    targets.splice(2, 0, {
      target: plan.nativeScopeDiscoveryStorePath,
      bytes: plan.nativeScopeDiscoveryStoreBytes,
      executable: false,
    });
  }
  if (plan.nativeScopeInspectionStoreChanged) {
    targets.splice(2, 0, {
      target: plan.nativeScopeInspectionStorePath,
      bytes: plan.nativeScopeInspectionStoreBytes,
      executable: false,
    });
  }
  return {
    targets,
    receipt,
    receiptPath,
  };
};
