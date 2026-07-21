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

export type RepositorySetupOptions = Readonly<{
  repoRoot: string;
  packageRoot: string;
  surfaces: readonly AgentSurface[];
  profiles: readonly string[];
}>;

export type RepositorySetupResult = Readonly<{
  outcome: "applied" | "no-op";
  manifestPath: string;
  changedTargets: readonly string[];
}>;
