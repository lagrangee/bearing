import { randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { CatalogLockRecoveryError } from "./errors";
import { createLockToken, quarantineLockPath } from "./lock-artifact-name";
import { strictQuarantineBoundDirectory } from "./lock-bound-directory";
import { BoundLockMutationError } from "./lock-bound-owner";
import { strictRetireBoundLockCandidate } from "./lock-bound-retire";
import { inspectCanonicalRecoveryClaim } from "./lock-claim-state";
import type { LockOwner } from "./lock-owner";
import {
  confirmRecoveryCandidateOwner,
  createRecoveryCandidate,
  publishRecoveryCandidate,
  publishRecoveryCandidateOwner,
  type RecoveryCandidateOwner,
  removeRecoveryCandidate,
} from "./lock-recovery-candidate";

type RecoveryLocation = Readonly<{ lock: string; lockRecovery: string }>;
type FullLockLocation = RecoveryLocation & Readonly<{ lockOwner: string }>;
type GenerationChangeMode = "error" | "transient";
export type DirectoryGeneration = Readonly<{ device: bigint; inode: bigint }>;
export type DirectoryPathState =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "unsafe" }>
  | Readonly<{ state: "directory"; generation: DirectoryGeneration }>;
export type RecoveryClaim = Readonly<{
  token: string;
  lock: DirectoryGeneration;
  recovery: DirectoryGeneration;
  directory: DirectoryGeneration;
  owner: RecoveryCandidateOwner;
}>;

export const RECOVERY_CLAIM = "claim";
export const RECOVERY_CLAIM_OWNER = "owner.json";
export const RECOVERY_OWNER_STAGE =
  /^owner\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.staged$/i;

const isSystemError = (error: unknown): error is Error & Readonly<{ code: string }> =>
  error instanceof Error && "code" in error && typeof error.code === "string";
const isCode = (error: unknown, ...codes: string[]): boolean =>
  isSystemError(error) && codes.includes(error.code);

export const inspectDirectoryPath = async (target: string): Promise<DirectoryPathState> => {
  try {
    const metadata = await lstat(target, { bigint: true });
    return metadata.isDirectory()
      ? { state: "directory", generation: { device: metadata.dev, inode: metadata.ino } }
      : { state: "unsafe" };
  } catch (error) {
    if (isCode(error, "ENOENT")) return { state: "missing" };
    if (isSystemError(error)) return { state: "unsafe" };
    throw error;
  }
};

export const inspectDirectoryGeneration = async (
  target: string,
): Promise<DirectoryGeneration | undefined> => {
  const observed = await inspectDirectoryPath(target);
  return observed.state === "directory" ? observed.generation : undefined;
};

export const sameDirectoryGeneration = (
  left: DirectoryGeneration,
  right: DirectoryGeneration | undefined,
): boolean => right !== undefined && left.device === right.device && left.inode === right.inode;

const ensureRecoveryContainer = async (
  location: RecoveryLocation,
  lock: DirectoryGeneration,
): Promise<DirectoryGeneration | undefined> => {
  try {
    await mkdir(location.lockRecovery, { mode: 0o700 });
  } catch (error) {
    if (isCode(error, "ENOENT")) return undefined;
    if (!isCode(error, "EEXIST")) throw error;
  }
  if (!sameDirectoryGeneration(lock, await inspectDirectoryGeneration(location.lock))) return;
  const recovery = await inspectDirectoryPath(location.lockRecovery);
  if (recovery.state === "directory") return recovery.generation;
  if (recovery.state === "unsafe") throw new CatalogLockRecoveryError();
  if (!sameDirectoryGeneration(lock, await inspectDirectoryGeneration(location.lock))) return;
  throw new CatalogLockRecoveryError();
};

export const tryClaimRecovery = async (
  location: RecoveryLocation,
  expectedLock?: DirectoryGeneration,
  afterContainerReady?: () => Promise<void>,
  generationChangeMode: GenerationChangeMode = "error",
  afterCandidateCreated?: (candidate: string) => Promise<void>,
  afterCandidateOwnerPublished?: (candidate: string) => Promise<void>,
  afterCandidateOwnerConfirmed?: (candidate: string) => Promise<void>,
): Promise<RecoveryClaim | undefined> => {
  const lock = expectedLock ?? (await inspectDirectoryGeneration(location.lock));
  if (lock === undefined) throw new CatalogLockRecoveryError();
  const recoveryDirectory = await ensureRecoveryContainer(location, lock);
  if (recoveryDirectory === undefined) {
    if (generationChangeMode === "transient") return undefined;
    throw new CatalogLockRecoveryError();
  }
  await afterContainerReady?.();
  const generationIsCurrent = async (): Promise<boolean> =>
    sameDirectoryGeneration(lock, await inspectDirectoryGeneration(location.lock)) &&
    sameDirectoryGeneration(
      recoveryDirectory,
      await inspectDirectoryGeneration(location.lockRecovery),
    );
  if (!(await generationIsCurrent())) {
    if (generationChangeMode === "transient") return undefined;
    throw new CatalogLockRecoveryError();
  }
  const claimed = join(location.lockRecovery, RECOVERY_CLAIM);
  if ((await inspectCanonicalRecoveryClaim(claimed)) === "active") return undefined;
  const token = randomUUID();
  const candidate = join(location.lockRecovery, `claim.${token}.tmp`);
  const owner: LockOwner = { pid: process.pid, token };
  let candidateDirectory: DirectoryGeneration | undefined;
  let candidateOwner: RecoveryCandidateOwner | undefined;
  try {
    candidateDirectory = await createRecoveryCandidate(
      location.lockRecovery,
      recoveryDirectory,
      candidate,
      lock,
    );
  } catch (error) {
    if (!(await generationIsCurrent())) {
      if (generationChangeMode === "transient") return undefined;
      throw new CatalogLockRecoveryError({ cause: error });
    }
    throw error;
  }
  try {
    const candidateBinding = [candidateDirectory, recoveryDirectory, RECOVERY_CLAIM_OWNER] as const;
    await afterCandidateCreated?.(candidate);
    if (!(await generationIsCurrent())) {
      if (generationChangeMode === "transient") return undefined;
      throw new CatalogLockRecoveryError();
    }
    if ((await inspectCanonicalRecoveryClaim(claimed)) === "active") return undefined;
    candidateOwner = await publishRecoveryCandidateOwner(candidate, ...candidateBinding, owner);
    await afterCandidateOwnerPublished?.(candidate);
    await confirmRecoveryCandidateOwner(candidate, ...candidateBinding, candidateOwner);
    await afterCandidateOwnerConfirmed?.(candidate);
    if ((await inspectCanonicalRecoveryClaim(claimed)) === "active") return undefined;
    const published = await publishRecoveryCandidate(
      candidate,
      claimed,
      ...candidateBinding,
      candidateOwner,
    );
    if (published.state === "contended" || published.state === "missing") return undefined;
    if (published.state === "indeterminate") {
      throw new CatalogLockRecoveryError(
        published.cause === undefined ? undefined : { cause: published.cause },
      );
    }
    const lockStillCurrent = sameDirectoryGeneration(
      lock,
      await inspectDirectoryGeneration(location.lock),
    );
    const publishedClaim = {
      token,
      lock,
      recovery: recoveryDirectory,
      directory: published.directory,
      owner: published.owner,
    };
    if (!lockStillCurrent) {
      await releaseRecoveryClaim(location, publishedClaim);
      if (generationChangeMode === "transient") return undefined;
      throw new CatalogLockRecoveryError();
    }
    return publishedClaim;
  } catch (error) {
    if (!sameDirectoryGeneration(lock, await inspectDirectoryGeneration(location.lock))) {
      if (generationChangeMode === "transient") return undefined;
      throw new CatalogLockRecoveryError({ cause: error });
    }
    throw error;
  } finally {
    if (candidateDirectory !== undefined) {
      await removeRecoveryCandidate(
        candidate,
        candidateDirectory,
        recoveryDirectory,
        RECOVERY_CLAIM_OWNER,
        candidateOwner,
      );
    }
  }
};

export async function releaseRecoveryClaim(
  location: RecoveryLocation,
  claim: RecoveryClaim,
  beforeMove?: () => Promise<void>,
): Promise<void> {
  const claimed = join(location.lockRecovery, RECOVERY_CLAIM);
  const moved = join(location.lockRecovery, `claim.${claim.token}.release`);
  try {
    await strictRetireBoundLockCandidate(
      claimed,
      moved,
      claim.directory,
      RECOVERY_CLAIM_OWNER,
      claim.owner,
      claim.recovery,
      beforeMove,
    );
  } catch (error) {
    const lockIsCurrent = sameDirectoryGeneration(
      claim.lock,
      await inspectDirectoryGeneration(location.lock),
    );
    if (!lockIsCurrent) {
      return;
    }
    if (error instanceof BoundLockMutationError && error.mutationMayHaveCommitted) {
      const recoveryIsCurrent = sameDirectoryGeneration(
        claim.recovery,
        await inspectDirectoryGeneration(location.lockRecovery),
      );
      if (!recoveryIsCurrent) throw new CatalogLockRecoveryError({ cause: error });
      const [claimState, movedState] = await Promise.all([
        inspectDirectoryPath(claimed),
        inspectDirectoryPath(moved),
      ]);
      if (claimState.state === "missing" && movedState.state === "missing") return;
      if (
        claimState.state === "directory" &&
        sameDirectoryGeneration(claim.directory, claimState.generation) &&
        movedState.state === "missing"
      ) {
        try {
          await strictRetireBoundLockCandidate(
            claimed,
            moved,
            claim.directory,
            RECOVERY_CLAIM_OWNER,
            claim.owner,
            claim.recovery,
          );
          return;
        } catch (retryFailure) {
          if (
            !sameDirectoryGeneration(claim.lock, await inspectDirectoryGeneration(location.lock))
          ) {
            return;
          }
          const [retriedClaim, retriedMoved] = await Promise.all([
            inspectDirectoryPath(claimed),
            inspectDirectoryPath(moved),
          ]);
          if (retriedClaim.state === "missing" && retriedMoved.state === "missing") return;
          throw new CatalogLockRecoveryError({
            cause: new AggregateError(
              [error, retryFailure],
              "Recovery-claim release remained indeterminate after one exact retry.",
            ),
          });
        }
      }
      throw new CatalogLockRecoveryError({ cause: error });
    }
    throw error;
  }
}

export const quarantineLockGeneration = async (
  location: FullLockLocation,
  expected: DirectoryGeneration,
  expectedParent: DirectoryGeneration,
  expectedEntries: readonly string[],
  beforeMove?: () => Promise<void>,
): Promise<FullLockLocation> => {
  const quarantinedLock = quarantineLockPath(location.lock, createLockToken());
  await strictQuarantineBoundDirectory(
    location.lock,
    quarantinedLock,
    expected,
    expectedParent,
    expectedEntries,
    beforeMove,
  );
  return {
    lock: quarantinedLock,
    lockOwner: join(quarantinedLock, basename(location.lockOwner)),
    lockRecovery: join(quarantinedLock, basename(location.lockRecovery)),
  };
};
