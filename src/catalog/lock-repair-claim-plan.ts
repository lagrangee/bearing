import { lstat, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { CatalogLockRepairError } from "./errors";
import { isBoundOwnerTombstoneName } from "./lock-bound-retire";
import {
  inspectLockOwner,
  type LockOwnerArtifact,
  ownerProcessState,
  sameMovedOwnerArtifact,
} from "./lock-owner";
import {
  type DirectoryGeneration,
  inspectDirectoryPath,
  RECOVERY_CLAIM_OWNER,
  sameDirectoryGeneration,
} from "./lock-recovery";
import { isRecoveryClaimArtifactName } from "./lock-repair-claim";

type BoundOwner = Extract<LockOwnerArtifact, { state: "regular" }>;
export type RecoveryClaimDebris = Readonly<{
  name: string;
  path: string;
  directory: DirectoryGeneration;
  ownerName?: string;
  owner?: BoundOwner;
}>;

const changed = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("lock-changed", cause === undefined ? undefined : { cause });

const assertRepairableOwner = (owner: BoundOwner | undefined, allowLive: boolean): void => {
  if (owner?.owner === undefined || allowLive) return;
  const state = ownerProcessState(owner.owner.pid);
  if (state === "alive") throw changed();
  if (state === "indeterminate") throw new CatalogLockRepairError("indeterminate-owner");
};

export const inspectRecoveryClaimDebris = async (
  path: string,
  allowLive = false,
): Promise<RecoveryClaimDebris> => {
  const metadata = await lstat(path, { bigint: true }).catch((error) => {
    throw changed(error);
  });
  if (!metadata.isDirectory()) throw new CatalogLockRepairError("unsafe-lock");
  const entries = await readdir(path).catch((error) => {
    throw changed(error);
  });
  if (
    entries.length > 1 ||
    (entries.length === 1 &&
      entries[0] !== RECOVERY_CLAIM_OWNER &&
      !isBoundOwnerTombstoneName(entries[0] ?? ""))
  ) {
    throw new CatalogLockRepairError("unsafe-lock");
  }
  const ownerName = entries[0];
  const owner = ownerName === undefined ? undefined : await inspectLockOwner(join(path, ownerName));
  if (owner !== undefined && owner.state !== "regular") {
    throw new CatalogLockRepairError("unsafe-lock");
  }
  assertRepairableOwner(owner, allowLive);
  return {
    name: basename(path),
    path,
    directory: { device: metadata.dev, inode: metadata.ino },
    ...(ownerName === undefined ? {} : { ownerName }),
    ...(owner === undefined ? {} : { owner }),
  };
};

export const sameRecoveryClaimDebris = (
  left: RecoveryClaimDebris,
  right: RecoveryClaimDebris,
): boolean =>
  left.name === right.name &&
  sameDirectoryGeneration(left.directory, right.directory) &&
  left.ownerName === right.ownerName &&
  (left.owner === undefined) === (right.owner === undefined) &&
  (left.owner === undefined ||
    (right.owner !== undefined && sameMovedOwnerArtifact(left.owner, right.owner)));

export const captureRecoveryClaimDebris = async (
  recoveryPath: string,
  expectedRecovery: DirectoryGeneration,
  allowLive = false,
): Promise<readonly RecoveryClaimDebris[]> => {
  const recovery = await inspectDirectoryPath(recoveryPath);
  if (
    recovery.state !== "directory" ||
    !sameDirectoryGeneration(expectedRecovery, recovery.generation)
  ) {
    throw changed();
  }
  const entries = await readdir(recoveryPath).catch((error) => {
    throw changed(error);
  });
  const claims: RecoveryClaimDebris[] = [];
  for (const name of entries.filter(isRecoveryClaimArtifactName).sort()) {
    claims.push(await inspectRecoveryClaimDebris(join(recoveryPath, name), allowLive));
  }
  const confirmed = await inspectDirectoryPath(recoveryPath);
  if (
    confirmed.state !== "directory" ||
    !sameDirectoryGeneration(expectedRecovery, confirmed.generation)
  ) {
    throw changed();
  }
  return claims;
};
