import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { CatalogLockRecoveryError } from "./errors";
import { createLockToken, quarantineLockPath } from "./lock-artifact-name";
import { strictRemoveBoundEmptyDirectory, strictRemoveBoundOwnerFile } from "./lock-bound-owner";
import { waitForOwnedLockShape } from "./lock-generation-shape";
import { moveAndVerify } from "./lock-move";
import {
  inspectLockOwner,
  type LockOwner,
  type LockOwnerArtifact,
  sameMovedOwnerArtifact,
} from "./lock-owner";
import {
  type DirectoryGeneration,
  inspectDirectoryGeneration,
  quarantineLockGeneration,
  RECOVERY_CLAIM,
  type RecoveryClaim,
  releaseRecoveryClaim,
  sameDirectoryGeneration,
} from "./lock-recovery";
import { clearDetachedRecoveryClaimCandidates } from "./lock-repair-claim";

export type OwnedLockGenerationOwner = Extract<LockOwnerArtifact, { state: "regular" }> &
  Readonly<{ owner: LockOwner }>;
type Location = Readonly<{ lock: string; lockOwner: string; lockRecovery: string }>;

const assertHeldShape = async (location: Location): Promise<void> => {
  await waitForOwnedLockShape(
    location.lock,
    location.lockRecovery,
    [basename(location.lockOwner), basename(location.lockRecovery)],
    [RECOVERY_CLAIM],
  );
};

const stageOwner = async (
  location: Location,
  expected: OwnedLockGenerationOwner,
  recovery: DirectoryGeneration,
  beforeMove?: () => Promise<void>,
): Promise<string> => {
  const target = join(location.lockRecovery, `owner.${randomUUID()}.staged`);
  await moveAndVerify<Extract<LockOwnerArtifact, { state: "regular" }>>({
    source: location.lockOwner,
    destination: target,
    expected,
    inspect: async (path) => {
      const moved = await inspectLockOwner(path);
      return moved.state === "regular" ? moved : undefined;
    },
    matches: sameMovedOwnerArtifact,
    failure: (cause) => new CatalogLockRecoveryError(cause === undefined ? undefined : { cause }),
    beforeMove: async () => {
      await beforeMove?.();
      if (
        !sameDirectoryGeneration(recovery, await inspectDirectoryGeneration(location.lockRecovery))
      ) {
        throw new CatalogLockRecoveryError();
      }
    },
  });
  if (!sameDirectoryGeneration(recovery, await inspectDirectoryGeneration(location.lockRecovery))) {
    throw new CatalogLockRecoveryError();
  }
  return target;
};

const removeStagedOwner = async (
  recoveryPath: string,
  recovery: DirectoryGeneration,
  lock: DirectoryGeneration,
  name: string,
  expected: OwnedLockGenerationOwner,
): Promise<void> => {
  await strictRemoveBoundOwnerFile(recoveryPath, recovery, name, expected, lock);
};

export const retireOwnedLockGeneration = async (
  location: Location,
  directory: DirectoryGeneration,
  claim: RecoveryClaim,
  owner: OwnedLockGenerationOwner,
  beforeOwnerMove?: () => Promise<void>,
  beforeLockQuarantine?: () => Promise<void>,
): Promise<void> => {
  const lockParent = await inspectDirectoryGeneration(dirname(location.lock));
  if (lockParent === undefined) throw new CatalogLockRecoveryError();
  await assertHeldShape(location);
  const staged = await stageOwner(location, owner, claim.recovery, beforeOwnerMove);
  const stageName = basename(staged);
  await waitForOwnedLockShape(
    location.lock,
    location.lockRecovery,
    [basename(location.lockRecovery)],
    [RECOVERY_CLAIM, stageName],
  );
  const quarantined = await quarantineLockGeneration(
    location,
    directory,
    lockParent,
    [basename(location.lockRecovery)],
    beforeLockQuarantine,
  );
  await clearDetachedRecoveryClaimCandidates(quarantined).catch((error) => {
    throw new CatalogLockRecoveryError({ cause: error });
  });
  await waitForOwnedLockShape(
    quarantined.lock,
    quarantined.lockRecovery,
    [basename(quarantined.lockRecovery)],
    [RECOVERY_CLAIM, stageName],
  );
  await removeStagedOwner(quarantined.lockRecovery, claim.recovery, directory, stageName, owner);
  await releaseRecoveryClaim(quarantined, claim);
  await strictRemoveBoundEmptyDirectory(
    quarantined.lockRecovery,
    join(quarantined.lock, `${basename(quarantined.lockRecovery)}.${createLockToken()}.retired`),
    claim.recovery,
    directory,
  );
  await strictRemoveBoundEmptyDirectory(
    quarantined.lock,
    quarantineLockPath(location.lock, createLockToken()),
    directory,
    lockParent,
  );
};
