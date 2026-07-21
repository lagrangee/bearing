import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { CatalogLockRecoveryError } from "./errors";
import {
  BoundLockMutationError,
  BoundLockReservationError,
  type BoundOwnerArtifact,
  boundRequest,
  decodeBoundOwner,
  type OwnedOwner,
  runBoundChild,
} from "./lock-bound-owner-process";
import type { LockOwner } from "./lock-owner";
import type { DirectoryGeneration } from "./lock-recovery";

export { replaceBoundClaimOwner, restoreBoundClaimOwner } from "./lock-bound-claim-owner";
export { createBoundChildDirectory, strictQuarantineBoundDirectory } from "./lock-bound-directory";
export { strictRetireBoundEntry } from "./lock-bound-entry";
export {
  retireBoundLockCandidate,
  strictMoveBoundLockCandidate,
  strictRetireBoundLockCandidate,
} from "./lock-bound-retire";
export { BoundLockMutationError, BoundLockReservationError };

const removedOwnerName = (): string => `.owner.${randomBytes(16).toString("base64url")}.retired`;

export const writeBoundLockOwner = (
  directory: string,
  expected: DirectoryGeneration,
  name: string,
  owner: LockOwner,
  parent?: DirectoryGeneration,
): Promise<OwnedOwner> => {
  return runBoundChild({
    ...boundRequest("write", directory, expected, name, undefined, undefined, parent),
    newOwner: owner,
  }).then((reply) => {
    if (reply.state !== "ok" || reply.owner === undefined) throw new CatalogLockRecoveryError();
    return decodeBoundOwner(reply.owner, owner);
  });
};

export const confirmBoundLockOwner = (
  directory: string,
  expectedDirectory: DirectoryGeneration,
  name: string,
  expectedOwner: OwnedOwner,
  parent?: DirectoryGeneration,
): Promise<OwnedOwner> => {
  return runBoundChild(
    boundRequest("confirm", directory, expectedDirectory, name, expectedOwner, undefined, parent),
  ).then((reply) => {
    if (reply.state !== "ok" || reply.owner === undefined) throw new CatalogLockRecoveryError();
    return decodeBoundOwner(reply.owner, expectedOwner.owner);
  });
};

export const strictRemoveBoundOwnerFile = async (
  directory: string,
  expectedDirectory: DirectoryGeneration,
  name: string,
  expectedOwner: BoundOwnerArtifact,
  parent?: DirectoryGeneration,
  afterTombstone?: (path: string) => Promise<void>,
): Promise<void> => {
  const remove = async (operation: "quarantine-file" | "remove-file", source: string) => {
    const tombstone = removedOwnerName();
    const reply = await runBoundChild({
      ...boundRequest(
        operation,
        directory,
        expectedDirectory,
        source,
        expectedOwner,
        undefined,
        parent,
      ),
      tombstoneName: tombstone,
    });
    if (reply.state !== "ok") throw new CatalogLockRecoveryError();
    return tombstone;
  };
  if (afterTombstone === undefined) {
    await remove("remove-file", name);
    return;
  }
  const tombstone = await remove("quarantine-file", name);
  await afterTombstone(join(directory, tombstone));
  await remove("remove-file", tombstone);
};

export const strictRemoveBoundEmptyDirectory = async (
  directory: string,
  quarantine: string,
  expectedDirectory: DirectoryGeneration,
  parent: DirectoryGeneration,
  afterQuarantine?: (path: string) => Promise<void>,
): Promise<void> => {
  if (afterQuarantine !== undefined) {
    const moved = await runBoundChild(
      boundRequest("quarantine", directory, expectedDirectory, "", undefined, quarantine, parent),
    );
    if (moved.state !== "ok") throw new CatalogLockRecoveryError();
    await afterQuarantine(quarantine);
    const removed = await runBoundChild(
      boundRequest("remove", quarantine, expectedDirectory, "", undefined, undefined, parent),
    );
    if (removed.state !== "ok") throw new CatalogLockRecoveryError();
    return;
  }
  const reply = await runBoundChild({
    ...boundRequest("retire", directory, expectedDirectory, "", undefined, quarantine, parent),
  });
  if (reply.state !== "ok") throw new CatalogLockRecoveryError();
};

export const reserveBoundLockDestination = (
  directory: string,
  destination: string,
  expectedDirectory: DirectoryGeneration,
  ownerName: string,
  expectedOwner: OwnedOwner | undefined,
  parent: DirectoryGeneration,
): Promise<
  Readonly<{ state: "contended" }> | Readonly<{ state: "reserved"; directory: DirectoryGeneration }>
> => {
  return runBoundChild(
    boundRequest(
      "reserve",
      directory,
      expectedDirectory,
      ownerName,
      expectedOwner,
      destination,
      parent,
    ),
    true,
  ).then((reply) => {
    if (reply.state === "contended") return reply;
    if (reply.directory === undefined) throw new BoundLockReservationError(true);
    return {
      state: "reserved" as const,
      directory: {
        device: BigInt(reply.directory.device),
        inode: BigInt(reply.directory.inode),
      },
    };
  });
};
