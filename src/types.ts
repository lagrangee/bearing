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
export type AdvisoryId = "planning-audit:current";
export type AdvisoryFreshness = Readonly<Partial<Record<AdvisoryId, SemanticFreshness>>>;

export type AgentSurface = "agent-skills" | "claude";
export type RuntimeChannel = "stable" | "development";

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

export type RepositoryConfigurationApplyOptions = Readonly<{
  repoRoot: string;
  packageRoot: string;
  surfaces: readonly AgentSurface[];
  profiles: readonly string[];
  runtime?: RuntimeChannel;
  registrations?: readonly ExecutorRegistration[];
  executorHomeDir?: string;
  confirmRepair?: boolean;
  confirmReactivate?: boolean;
  retainProfiles?: readonly string[];
  removeProfiles?: readonly string[];
  initializeReadModel?: boolean;
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

export type RepositoryConfigurationApplyResult = Readonly<{
  outcome: "applied" | "no-op";
  manifestPath: string;
  changedTargets: readonly string[];
  readModel?: Readonly<{
    acquisitionCount: 0;
    missingEvidenceScopes: readonly string[];
  }>;
}>;
