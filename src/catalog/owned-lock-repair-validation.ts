import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CatalogLockRepairError } from "./errors";
import { inspectLockOwner, ownerProcessState, sameMovedOwnerArtifact } from "./lock-owner";
import {
  type DirectoryGeneration,
  inspectDirectoryPath,
  RECOVERY_CLAIM,
  type RecoveryClaim,
  sameDirectoryGeneration,
} from "./lock-recovery";
import { isRecoveryClaimArtifactName } from "./lock-repair-claim";
import {
  inspectRecoveryClaimDebris,
  type RecoveryClaimDebris,
  sameRecoveryClaimDebris,
} from "./lock-repair-claim-plan";
import { assertOwnedRecoveryClaim } from "./owned-lock-repair-claim";
import type { ReadyOwnedLockRepairPlan } from "./owned-lock-repair-plan";
import {
  assertRepairableTarget,
  captureRepairTarget,
  sameRepairTarget,
} from "./owned-lock-repair-target";

type RepairLeaseView = Readonly<{
  plan: ReadyOwnedLockRepairPlan;
  claim: RecoveryClaim;
  recovery: DirectoryGeneration;
  originalClaim?: RecoveryClaimDebris;
  stagedOwnerName?: string;
}>;
export type ValidatedRepairLease = Readonly<{
  lease: RepairLeaseView;
  lockEntries: readonly string[];
  recoveryEntries: readonly string[];
  claimsToDrain: readonly RecoveryClaimDebris[];
}>;

const changed = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("lock-changed", cause === undefined ? undefined : { cause });
const exact = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const readEntries = async (path: string): Promise<readonly string[]> =>
  readdir(path)
    .then((entries) => entries.sort())
    .catch((error) => {
      throw changed(error);
    });

const validateTargets = async (plan: ReadyOwnedLockRepairPlan): Promise<void> => {
  for (const expected of plan.targets) {
    const observed = await captureRepairTarget(expected.path);
    if (observed === undefined || !sameRepairTarget(expected, observed)) throw changed();
    await assertRepairableTarget(observed);
  }
};

const validateOriginalClaim = async (lease: RepairLeaseView): Promise<void> => {
  const original = lease.plan.claims.find((claim) => claim.name === RECOVERY_CLAIM);
  if ((original === undefined) !== (lease.originalClaim === undefined)) throw changed();
  if (
    original !== undefined &&
    (lease.originalClaim === undefined || !sameRecoveryClaimDebris(original, lease.originalClaim))
  ) {
    throw changed();
  }
  if (original === undefined) return;
  if (!sameDirectoryGeneration(original.directory, lease.claim.directory)) throw changed();
  if ((original.owner === undefined) !== (lease.stagedOwnerName === undefined)) throw changed();
  if (original.owner === undefined || lease.stagedOwnerName === undefined) return;
  const staged = await inspectLockOwner(
    join(lease.plan.location.lockRecovery, lease.stagedOwnerName),
  );
  if (staged.state !== "regular" || !sameMovedOwnerArtifact(original.owner, staged))
    throw changed();
  if (original.owner.owner === undefined) return;
  const processState = ownerProcessState(original.owner.owner.pid);
  if (processState === "alive") throw changed();
  if (processState === "indeterminate") {
    throw new CatalogLockRepairError("indeterminate-owner");
  }
};

const validateClaims = async (
  lease: RepairLeaseView,
  recoveryEntries: readonly string[],
): Promise<readonly RecoveryClaimDebris[]> => {
  await assertOwnedRecoveryClaim(lease.plan.location, lease.claim, lease.recovery).catch(
    (error) => {
      throw changed(error);
    },
  );
  await validateOriginalClaim(lease);
  const originalOthers = lease.plan.claims.filter((claim) => claim.name !== RECOVERY_CLAIM);
  for (const expected of originalOthers) {
    const observed = await inspectRecoveryClaimDebris(expected.path);
    if (!sameRecoveryClaimDebris(expected, observed)) throw changed();
  }
  const known = new Set([
    ...lease.plan.recoveryEntries,
    RECOVERY_CLAIM,
    ...(lease.stagedOwnerName === undefined ? [] : [lease.stagedOwnerName]),
  ]);
  const extras = recoveryEntries.filter((name) => !known.has(name));
  if (extras.some((name) => !isRecoveryClaimArtifactName(name) || name === RECOVERY_CLAIM)) {
    throw changed();
  }
  const late: RecoveryClaimDebris[] = [];
  for (const name of extras) {
    late.push(await inspectRecoveryClaimDebris(join(lease.plan.location.lockRecovery, name), true));
  }
  const required = [...known].sort();
  if (!required.every((name) => recoveryEntries.includes(name))) throw changed();
  return [...originalOthers, ...late];
};

export const validateRepairLease = async (
  lease: RepairLeaseView,
): Promise<ValidatedRepairLease> => {
  const { plan } = lease;
  const [parent, lock, recovery, lockEntries, recoveryEntries] = await Promise.all([
    inspectDirectoryPath(dirname(plan.location.lock)),
    inspectDirectoryPath(plan.location.lock),
    inspectDirectoryPath(plan.location.lockRecovery),
    readEntries(plan.location.lock),
    readEntries(plan.location.lockRecovery),
  ]);
  if (
    parent.state !== "directory" ||
    !sameDirectoryGeneration(plan.parent, parent.generation) ||
    lock.state !== "directory" ||
    !sameDirectoryGeneration(plan.directory, lock.generation) ||
    recovery.state !== "directory" ||
    !sameDirectoryGeneration(lease.recovery, recovery.generation)
  ) {
    throw changed();
  }
  const expectedLock = [
    ...plan.lockEntries,
    ...(plan.recovery === undefined ? [basename(plan.location.lockRecovery)] : []),
  ].sort();
  if (!exact(expectedLock, lockEntries)) throw changed();
  await validateTargets(plan);
  const claimsToDrain = await validateClaims(lease, recoveryEntries);
  return { lease, lockEntries, recoveryEntries, claimsToDrain };
};
