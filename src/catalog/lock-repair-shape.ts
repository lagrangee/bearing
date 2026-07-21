import { readdir } from "node:fs/promises";
import { basename } from "node:path";
import { CatalogLockRepairError } from "./errors";
import type { OwnedLockLocation } from "./lock";
import {
  type DirectoryGeneration,
  inspectDirectoryGeneration,
  inspectDirectoryPath,
  RECOVERY_OWNER_STAGE,
  sameDirectoryGeneration,
} from "./lock-recovery";
import { isRecoveryClaimArtifactName } from "./lock-repair-claim";
import { isBoundRetiredTargetName, isRecoveryRetiredName } from "./lock-repair-residue";

export const OWNER_TEMP =
  /^owner\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i;

export const inspectRepairShape = async (
  location: OwnedLockLocation,
  directory: DirectoryGeneration,
): Promise<DirectoryGeneration | undefined> => {
  const recoveryName = basename(location.lockRecovery);
  const lockEntries = await readdir(location.lock).catch(() => undefined);
  if (
    lockEntries === undefined ||
    !lockEntries.every(
      (name) =>
        name === recoveryName ||
        name === basename(location.lockOwner) ||
        OWNER_TEMP.test(name) ||
        isBoundRetiredTargetName(name) ||
        isRecoveryRetiredName(name, recoveryName),
    )
  ) {
    throw new CatalogLockRepairError("unsafe-lock");
  }
  const recovery = await inspectDirectoryPath(location.lockRecovery);
  if (recovery.state === "unsafe") throw new CatalogLockRepairError("unsafe-lock");
  if (recovery.state === "directory") {
    const entries = await readdir(location.lockRecovery).catch(() => undefined);
    if (
      entries === undefined ||
      !entries.every(
        (name) =>
          isRecoveryClaimArtifactName(name) ||
          RECOVERY_OWNER_STAGE.test(name) ||
          isBoundRetiredTargetName(name),
      )
    ) {
      throw new CatalogLockRepairError("unsafe-lock");
    }
  }
  if (!sameDirectoryGeneration(directory, await inspectDirectoryGeneration(location.lock))) {
    throw new CatalogLockRepairError("lock-changed");
  }
  return recovery.state === "directory" ? recovery.generation : undefined;
};
