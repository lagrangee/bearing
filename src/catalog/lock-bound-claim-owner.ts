import { randomBytes } from "node:crypto";
import { CatalogLockRecoveryError } from "./errors";
import {
  type BoundOwnerArtifact,
  boundRequest,
  decodeBoundOwner,
  encodeBoundOwner,
  type OwnedOwner,
  runBoundChild,
} from "./lock-bound-owner-process";
import type { LockOwner } from "./lock-owner";
import type { DirectoryGeneration } from "./lock-recovery";

const tombstoneName = (): string => `.owner.${randomBytes(16).toString("base64url")}.tombstone`;

export const replaceBoundClaimOwner = async (
  claim: string,
  claimDirectory: DirectoryGeneration,
  recoveryDirectory: DirectoryGeneration,
  ownerName: string,
  expectedOwner: BoundOwnerArtifact | undefined,
  stageName: string,
  newOwner: LockOwner,
  newOwnerName = ownerName,
): Promise<OwnedOwner> => {
  const reply = await runBoundChild({
    ...boundRequest(
      "replace-owner",
      claim,
      claimDirectory,
      ownerName,
      expectedOwner,
      undefined,
      recoveryDirectory,
    ),
    newOwner,
    newOwnerName,
    stageName,
    tombstoneName: tombstoneName(),
  });
  if (reply.state !== "ok" || reply.owner === undefined) throw new CatalogLockRecoveryError();
  return decodeBoundOwner(reply.owner, newOwner);
};

export const restoreBoundClaimOwner = async (
  claim: string,
  claimDirectory: DirectoryGeneration,
  recoveryDirectory: DirectoryGeneration,
  ownerName: string,
  currentOwner: OwnedOwner,
  stageName: string,
  previousOwner: BoundOwnerArtifact | undefined,
  previousOwnerName = ownerName,
): Promise<void> => {
  const reply = await runBoundChild({
    ...boundRequest(
      "restore-owner",
      claim,
      claimDirectory,
      ownerName,
      currentOwner,
      undefined,
      recoveryDirectory,
    ),
    stageName,
    previousOwnerName,
    ...(previousOwner === undefined ? {} : { stagedOwner: encodeBoundOwner(previousOwner) }),
    tombstoneName: tombstoneName(),
  });
  if (reply.state !== "ok") throw new CatalogLockRecoveryError();
};
