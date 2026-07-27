export type ReleaseSmokeLane = "node24" | "node26";

export type ReleaseSmokeOptions = Readonly<{
  lane: ReleaseSmokeLane;
  sourceCommit: string;
  candidateReceipt: string;
  tarball: string;
  sha256: string;
  version: string;
  evidence?: string;
}>;

export type ReleaseSmokeRoots = Readonly<{
  workRoot: string;
  home: string;
  cache: string;
  repository: string;
  install: string;
}>;

export const RELEASE_SMOKE_SEED: string;
export const parseReleaseSmokeArgs: (
  args: readonly string[],
) => ReleaseSmokeOptions | Readonly<{ help: true }>;
export const validateCandidateTarball: (
  tarball: string,
  expectedDigest: string,
) => Promise<Readonly<{ path: string; digest: string }>>;
export const validateCandidateReceiptIdentity: (
  receiptPath: string,
  expected: Readonly<{
    sourceCommit: string;
    packageVersion: string;
    candidate: Readonly<{ path: string; digest: string }>;
    repositoryRoot?: string;
  }>,
) => Promise<
  Readonly<{
    path: string;
    sha256: string;
    sourceCommit: string;
    packageVersion: string;
    artifact: Readonly<{ file: string; size: number; sha256: string }>;
    manifest: Readonly<{ file: string; sha256: string; files: number }>;
  }>
>;
export const verifyFrozenSourceInputs: (options: {
  projectRoot?: string;
  sourceCommit: string;
  harnessLocator?: string;
  seedLocator?: string;
}) => Promise<
  Readonly<{
    sourceCommit: string;
    harnessSha256: string;
    seedDigest: string;
    seedManifest: readonly Readonly<{ path: string; sha256: string; bytes: number }>[];
    seedFiles: readonly Readonly<{ path: string; bytes: Buffer }>[];
  }>
>;
export const checkPackagedDocumentation: (packageRoot: string) => Promise<void>;
export const assertLaneRuntime: (lane: ReleaseSmokeLane, nodeVersion?: string) => void;
export const assertIsolationRoots: (roots: ReleaseSmokeRoots) => void;
export const buildIsolatedEnvironment: (
  roots: ReleaseSmokeRoots,
) => Readonly<Record<string, string>>;
export const auditReleaseSmokeSeed: (seedRoot?: string) => Promise<readonly string[]>;
export const runReleaseSmoke: (options: ReleaseSmokeOptions) => Promise<Readonly<unknown>>;
