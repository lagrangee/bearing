import { basename } from "node:path";
import { CatalogLockRecoveryError } from "./errors";
import { BoundLockReservationError, boundRequest, runBoundChild } from "./lock-bound-owner-process";
import type { DirectoryGeneration } from "./lock-recovery";

const decodeDirectory = (
  directory: Readonly<{ device: string; inode: string }> | undefined,
): DirectoryGeneration => {
  if (directory === undefined) throw new BoundLockReservationError(true);
  return { device: BigInt(directory.device), inode: BigInt(directory.inode) };
};

export const createBoundChildDirectory = async (
  parentPath: string,
  parent: DirectoryGeneration,
  childPath: string,
  grandparent: DirectoryGeneration,
): Promise<DirectoryGeneration> => {
  const reply = await runBoundChild(
    boundRequest("mkdir", parentPath, parent, "", undefined, childPath, grandparent),
    true,
  );
  if (reply.state !== "ok") throw new BoundLockReservationError(false);
  return decodeDirectory(reply.directory);
};

export const strictQuarantineBoundDirectory = async (
  directory: string,
  destination: string,
  expectedDirectory: DirectoryGeneration,
  parent: DirectoryGeneration,
  expectedEntries: readonly string[],
  beforeQuarantine?: () => Promise<void>,
): Promise<void> => {
  if (
    new Set(expectedEntries).size !== expectedEntries.length ||
    expectedEntries.some((entry) => basename(entry) !== entry || entry.length === 0)
  ) {
    throw new CatalogLockRecoveryError();
  }
  await beforeQuarantine?.();
  const reply = await runBoundChild({
    ...boundRequest(
      "quarantine-entries",
      directory,
      expectedDirectory,
      "",
      undefined,
      destination,
      parent,
    ),
    entries: expectedEntries,
  });
  if (reply.state !== "ok") throw new CatalogLockRecoveryError();
};
