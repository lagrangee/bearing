import { join } from "node:path";
import { CatalogLockRepairError } from "./errors";
import { inspectLockOwner, sameMovedOwnerArtifact } from "./lock-owner";
import {
  type DirectoryGeneration,
  inspectDirectoryGeneration,
  RECOVERY_CLAIM,
  RECOVERY_CLAIM_OWNER,
  type RecoveryClaim,
  sameDirectoryGeneration,
} from "./lock-recovery";
import { exactEntries } from "./owned-lock-repair-target";

type Location = Readonly<{ lock: string; lockRecovery: string }>;
const changed = (): CatalogLockRepairError => new CatalogLockRepairError("lock-changed");

export const assertOwnedRecoveryClaim = async (
  location: Location,
  claim: RecoveryClaim,
  recovery: DirectoryGeneration,
): Promise<void> => {
  const claimPath = join(location.lockRecovery, RECOVERY_CLAIM);
  if (
    !sameDirectoryGeneration(claim.lock, await inspectDirectoryGeneration(location.lock)) ||
    !sameDirectoryGeneration(recovery, await inspectDirectoryGeneration(location.lockRecovery)) ||
    !sameDirectoryGeneration(claim.directory, await inspectDirectoryGeneration(claimPath)) ||
    !(await exactEntries(claimPath, [RECOVERY_CLAIM_OWNER]))
  ) {
    throw changed();
  }
  const owner = await inspectLockOwner(join(claimPath, RECOVERY_CLAIM_OWNER));
  if (owner.state !== "regular" || !sameMovedOwnerArtifact(claim.owner, owner)) throw changed();
  if (
    !sameDirectoryGeneration(claim.lock, await inspectDirectoryGeneration(location.lock)) ||
    !sameDirectoryGeneration(recovery, await inspectDirectoryGeneration(location.lockRecovery)) ||
    !sameDirectoryGeneration(claim.directory, await inspectDirectoryGeneration(claimPath)) ||
    !(await exactEntries(claimPath, [RECOVERY_CLAIM_OWNER]))
  ) {
    throw changed();
  }
};
