export type DiagnosticImpact = "blocking" | "non-blocking";

export type StructuralDiagnostic = Readonly<{
  code: string;
  impact: DiagnosticImpact;
  target: string;
  message: string;
}>;

export type FingerprintResult = Readonly<{
  inputs: readonly string[];
  fingerprint: string;
}>;

export type SemanticFreshness = "current" | "stale" | "unknown";
export type AdvisoryId = "planning-audit:current" | "next-work-guidance:current";
export type AdvisoryFreshness = Readonly<Partial<Record<AdvisoryId, SemanticFreshness>>>;

import type { NativeScopeInspectionPlan } from "./native-scope-inspection";
import type { ProviderObservationOperation } from "./provider-observation-store";
import type { SyncReceipt } from "./sync-receipt";

export type SyncProjectionResult = FingerprintResult &
  Readonly<{
    changed: boolean;
    advisoryFreshness: AdvisoryFreshness;
    diagnostics: readonly StructuralDiagnostic[];
    reportPath: string;
    sitemapPath: string;
  }>;

export type SyncResult = SyncProjectionResult &
  Readonly<{
    providerObservationOperation: ProviderObservationOperation;
    nativeScopeInspectionOperation: NativeScopeInspectionPlan["operation"];
    receipt: SyncReceipt;
    receiptPath: string;
  }>;

export type AgentSurface = "agent-skills" | "claude";

export type InstallOptions = Readonly<{
  homeDir: string;
  packageRoot: string;
  surfaces: readonly AgentSurface[];
  confirmDowngrade?: boolean;
}>;

export type InstallResult = Readonly<{
  outcome: "applied" | "no-op";
  cliPath: string;
  changedTargets: readonly string[];
}>;

export type GlobalUninstallResult = Readonly<{
  outcome: "applied" | "no-op";
  removedTargets: readonly string[];
}>;

export type RepositorySetupOptions = Readonly<{
  repoRoot: string;
  packageRoot: string;
  surfaces: readonly AgentSurface[];
  profiles: readonly string[];
  registrations?: readonly ExecutorRegistration[];
  executorHomeDir?: string;
  confirmRepair?: boolean;
  confirmReactivate?: boolean;
  acceptUpgradeDirection?: boolean;
  confirmCutover?: boolean;
  cutoverAt?: string;
  cutoverPlanToken?: string;
  retainProfiles?: readonly string[];
  removeProfiles?: readonly string[];
  provider?: Readonly<{
    key: "matt-skills/v1";
    contractLocator: string;
  }>;
}>;

export type ExecutorRegistration = Readonly<{
  profileKey: string;
  displayName: string;
  surface: AgentSurface;
  capabilityLocator: string;
  nativeArtifacts: readonly string[];
  writebackBehavior: string;
  assessment: Readonly<{
    capabilityLocator: string;
    conclusion: "owns-end-to-end-execution-and-final-writeback";
    requiredReferences: readonly string[];
    executionOwnershipEvidence: string;
    finalWritebackEvidence: string;
    nativeArtifacts: readonly Readonly<{
      description: string;
      evidence: string;
    }>[];
    writebackBehavior: Readonly<{
      description: string;
      evidence: string;
    }>;
  }>;
  sourceContractSnapshot: string;
}>;

export type RepositorySetupResult = Readonly<{
  outcome: "applied" | "no-op";
  manifestPath: string;
  changedTargets: readonly string[];
  recoveryBundlePath?: string;
  cutover?: Readonly<{
    sourceSchema: string;
    targetSchema: string;
    recoveryBundleVerified: boolean;
    targetValidation: "zero-diagnostics";
  }>;
}>;
