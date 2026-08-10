export const ARCHITECTURE_CONTRACTION_METHOD = Object.freeze({
  warmupCount: 20,
  sampleCount: 100,
  p95: "nearest-rank",
  changePattern: "alternate-project-summary-a-b",
} as const);

export const ARCHITECTURE_CONTRACTION_BUDGETS = Object.freeze({
  typedQueryP95Ms: 100,
  unchangedManagedBasisP95Ms: 500,
  semanticRematerializationP95Ms: 5000,
  semanticRematerializationPeakRssBytes: 512 * 1024 * 1024,
} as const);

export type ArchitectureContractionCandidateIdentity = Readonly<{
  sourceCommit: string;
  packageFile: string;
  packageSha256: string;
}>;

export type ArchitectureContractionCandidateEvidence = Readonly<{
  schemaVersion: 1;
  evidenceKind: "architecture-contraction-candidate";
  candidate: ArchitectureContractionCandidateIdentity;
  packageAttestation: Readonly<{
    regeneratedPackageSha256: string;
    exactSourcePackageMatch: boolean;
    installedPackageSha256: string;
    installMode: "offline";
    installedCliObserved: boolean;
  }>;
  fixture: Readonly<{
    baselineDigest: string;
    candidateDigest: string;
    managedInputCount: number;
    bearingRecordCount: number;
    providerScopeCount: number;
    baselineTotalBytes: number;
    candidateTotalBytes: number;
    comparability: string;
  }>;
  methodology: typeof ARCHITECTURE_CONTRACTION_METHOD;
  measurements: Readonly<{
    typedInspectQueryP95Ms: number;
    typedPortalQueryP95Ms: number;
    unchangedManagedBasisP95Ms: number;
    unchangedProviderAcquisitionCount: number;
    unchangedPublicationCount: number;
    unchangedReadModelMutationCount: number;
    semanticRematerializationP95Ms: number;
    semanticRematerializationPeakRssBytes: number;
    semanticTransactionCount: number;
    semanticPublicationCount: number;
    providerInitialAcquisitionCount: number;
    ordinaryRematerializationAcquisitionCount: number;
    retainedFootprint: Readonly<{
      fileCount: number;
      totalBytes: number;
      observationFileCount: number;
      observationBytes: number;
    }>;
    lastGoodPreservedAfterFailedCommit: boolean;
    mixedGenerationObserved: boolean;
    catalogBytesChanged: boolean;
  }>;
  lanes: readonly Readonly<{
    name: "sqlite-performance" | "packed-journey" | "fresh-agent" | "foreground-portal";
    candidate: ArchitectureContractionCandidateIdentity;
    outcome: "passed";
    details?: unknown;
  }>[];
  authority: Readonly<{
    concludesEffort: boolean;
    changesGateReadiness: boolean;
    passesGate: boolean;
    claimsReleaseProof: boolean;
  }>;
}>;

const sameCandidate = (
  left: ArchitectureContractionCandidateIdentity,
  right: ArchitectureContractionCandidateIdentity,
): boolean =>
  left.sourceCommit === right.sourceCommit &&
  left.packageFile === right.packageFile &&
  left.packageSha256 === right.packageSha256;

const fail = (message: string): never => {
  throw new Error(`Architecture Contraction candidate evidence ${message}.`);
};

export const assertArchitectureContractionCandidateEvidence = <
  Evidence extends ArchitectureContractionCandidateEvidence,
>(
  evidence: Evidence,
): Evidence => {
  if (!/^[0-9a-f]{40}$/u.test(evidence.candidate.sourceCommit)) {
    fail("requires one fixed source commit");
  }
  if (
    !evidence.candidate.packageFile.endsWith(".tgz") ||
    evidence.candidate.packageFile.includes("/") ||
    !/^[0-9a-f]{64}$/u.test(evidence.candidate.packageSha256)
  ) {
    fail("requires one exact packed package identity");
  }
  if (
    evidence.packageAttestation.regeneratedPackageSha256 !== evidence.candidate.packageSha256 ||
    !evidence.packageAttestation.exactSourcePackageMatch ||
    evidence.packageAttestation.installedPackageSha256 !== evidence.candidate.packageSha256 ||
    evidence.packageAttestation.installMode !== "offline" ||
    !evidence.packageAttestation.installedCliObserved
  ) {
    fail("requires an exact clean-source package attestation and offline install");
  }
  const expectedLanes = new Set([
    "sqlite-performance",
    "packed-journey",
    "fresh-agent",
    "foreground-portal",
  ]);
  if (
    evidence.lanes.length !== expectedLanes.size ||
    evidence.lanes.some(
      (lane) =>
        !expectedLanes.delete(lane.name) || !sameCandidate(evidence.candidate, lane.candidate),
    )
  ) {
    fail("requires every lane to use the same exact candidate");
  }
  const freshAgent = evidence.lanes.find((lane) => lane.name === "fresh-agent");
  const freshDetails = freshAgent?.details as
    | Readonly<{
        runtime?: Readonly<{
          codexCliVersion?: unknown;
          model?: unknown;
          reasoningEffort?: unknown;
          mode?: unknown;
          realInvocationStarted?: unknown;
          terminalBoundaryReached?: unknown;
        }>;
      }>
    | undefined;
  if (
    typeof freshDetails?.runtime?.codexCliVersion !== "string" ||
    freshDetails.runtime.codexCliVersion.trim().length === 0 ||
    freshDetails.runtime.model !== "gpt-5.6-luna" ||
    freshDetails.runtime.reasoningEffort !== "high" ||
    freshDetails.runtime.mode !== "codex-exec" ||
    freshDetails.runtime.realInvocationStarted !== true ||
    freshDetails.runtime.terminalBoundaryReached !== true
  ) {
    fail("requires Fresh Agent runtime, real launch, and terminal boundary evidence");
  }
  if (
    evidence.methodology.warmupCount !== ARCHITECTURE_CONTRACTION_METHOD.warmupCount ||
    evidence.methodology.sampleCount !== ARCHITECTURE_CONTRACTION_METHOD.sampleCount ||
    evidence.methodology.p95 !== ARCHITECTURE_CONTRACTION_METHOD.p95 ||
    evidence.methodology.changePattern !== ARCHITECTURE_CONTRACTION_METHOD.changePattern
  ) {
    fail("cannot weaken the accepted Ticket 04 methodology");
  }
  if (
    evidence.fixture.baselineDigest !==
      "sha256:c8f3d7e2dd616163a1dc38856ba15f94c09362440a6baa838e1b1f11827774c8" ||
    evidence.fixture.managedInputCount !== 36 ||
    evidence.fixture.bearingRecordCount !== 30 ||
    evidence.fixture.providerScopeCount !== 9 ||
    evidence.fixture.baselineTotalBytes !== 26_311 ||
    (evidence.fixture.candidateDigest !== evidence.fixture.baselineDigest &&
      evidence.fixture.comparability.trim().length === 0)
  ) {
    fail("does not preserve and explain the accepted Ticket 04 basis");
  }
  const measurements = evidence.measurements;
  if (
    measurements.typedInspectQueryP95Ms >= ARCHITECTURE_CONTRACTION_BUDGETS.typedQueryP95Ms ||
    measurements.typedPortalQueryP95Ms >= ARCHITECTURE_CONTRACTION_BUDGETS.typedQueryP95Ms
  ) {
    fail("exceeds the typed query p95 budget");
  }
  if (
    measurements.unchangedManagedBasisP95Ms >=
      ARCHITECTURE_CONTRACTION_BUDGETS.unchangedManagedBasisP95Ms ||
    measurements.unchangedProviderAcquisitionCount !== 0 ||
    measurements.unchangedPublicationCount !== 0 ||
    measurements.unchangedReadModelMutationCount !== 0
  ) {
    fail("does not prove an unchanged managed basis with zero hidden work");
  }
  if (
    measurements.semanticRematerializationP95Ms >=
    ARCHITECTURE_CONTRACTION_BUDGETS.semanticRematerializationP95Ms
  ) {
    fail("exceeds the semantic rematerialization p95 budget");
  }
  if (measurements.ordinaryRematerializationAcquisitionCount !== 0) {
    fail("does not prove semantic rematerialization with zero provider acquisition");
  }
  if (
    measurements.semanticRematerializationPeakRssBytes >=
    ARCHITECTURE_CONTRACTION_BUDGETS.semanticRematerializationPeakRssBytes
  ) {
    fail("exceeds the semantic rematerialization RSS budget");
  }
  if (
    measurements.semanticTransactionCount !== ARCHITECTURE_CONTRACTION_METHOD.sampleCount ||
    measurements.semanticPublicationCount > measurements.semanticTransactionCount ||
    !measurements.lastGoodPreservedAfterFailedCommit ||
    measurements.mixedGenerationObserved ||
    measurements.catalogBytesChanged
  ) {
    fail("does not prove atomic publication and owner-store isolation");
  }
  if (
    evidence.authority.concludesEffort ||
    evidence.authority.changesGateReadiness ||
    evidence.authority.passesGate ||
    evidence.authority.claimsReleaseProof
  ) {
    fail("cannot claim a human lifecycle or downstream release outcome");
  }
  return evidence;
};
