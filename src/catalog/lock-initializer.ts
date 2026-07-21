import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { CatalogLockRecoveryError } from "./errors";
import { createLockToken, initializingLockPath, quarantineLockPath } from "./lock-artifact-name";
import {
  BoundLockMutationError,
  BoundLockReservationError,
  confirmBoundLockOwner,
  reserveBoundLockDestination,
  retireBoundLockCandidate,
  strictRemoveBoundEmptyDirectory,
  writeBoundLockOwner,
} from "./lock-bound-owner";
import { reconcileBoundOwnerPublication } from "./lock-bound-publish";
import type { OwnedLockGenerationOwner } from "./lock-generation";
import { type DirectoryGeneration, inspectDirectoryGeneration } from "./lock-recovery";

type InitializerLocation = Readonly<{ lock: string; lockOwner: string }>;
export type InitializedLockGeneration = Readonly<{
  directory: DirectoryGeneration;
  owner: OwnedLockGenerationOwner;
}>;
export type OwnedLockInitializerHooks = Readonly<{
  afterLockDirectoryCreated?: () => Promise<void>;
  afterOwnerPublished?: () => Promise<void>;
  afterLockDestinationReserved?: () => Promise<void>;
  afterLockRenameCommitted?: () => Promise<void>;
  afterInitializerQuarantined?: (path: string) => Promise<void>;
  afterInitializerOwnerTombstoned?: (path: string, name: string) => Promise<void>;
}>;

const hasStagedInitializerHooks = (hooks: OwnedLockInitializerHooks): boolean =>
  hooks.afterLockDirectoryCreated !== undefined ||
  hooks.afterOwnerPublished !== undefined ||
  hooks.afterLockDestinationReserved !== undefined ||
  hooks.afterLockRenameCommitted !== undefined ||
  hooks.afterInitializerQuarantined !== undefined ||
  hooks.afterInitializerOwnerTombstoned !== undefined;

export const createInitializedLock = async (
  location: InitializerLocation,
  hooks: OwnedLockInitializerHooks,
): Promise<InitializedLockGeneration | undefined> => {
  const token = createLockToken();
  const candidate = initializingLockPath(location.lock, process.pid, token);
  const ownerName = basename(location.lockOwner);
  await mkdir(candidate, { mode: 0o700 });
  const directory = await inspectDirectoryGeneration(candidate);
  const parent = await inspectDirectoryGeneration(dirname(candidate));
  if (directory === undefined || parent === undefined) throw new CatalogLockRecoveryError();
  const staged = hasStagedInitializerHooks(hooks);
  let owner: OwnedLockGenerationOwner | undefined;
  let reservationCommitted = false;
  let published = false;
  try {
    if (staged) {
      await hooks.afterLockDirectoryCreated?.();
      owner = await writeBoundLockOwner(
        candidate,
        directory,
        ownerName,
        { pid: process.pid, token },
        parent,
      );
      await hooks.afterOwnerPublished?.();
    }
    const reserved = await reserveBoundLockDestination(
      candidate,
      location.lock,
      directory,
      ownerName,
      owner,
      parent,
    );
    if (reserved.state === "contended") return undefined;
    reservationCommitted = true;
    await hooks.afterLockDestinationReserved?.();
    const intendedOwner = { pid: process.pid, token };
    let canonicalOwner: OwnedLockGenerationOwner;
    try {
      canonicalOwner = await writeBoundLockOwner(
        location.lock,
        reserved.directory,
        ownerName,
        intendedOwner,
        parent,
      );
    } catch (error) {
      if (!(error instanceof BoundLockMutationError) || !error.mutationMayHaveCommitted) {
        throw error;
      }
      const reconciled = await reconcileBoundOwnerPublication(
        location.lock,
        reserved.directory,
        dirname(location.lock),
        parent,
        ownerName,
        intendedOwner,
      );
      if (reconciled.state === "adopted") canonicalOwner = reconciled.owner;
      else if (reconciled.state === "missing") {
        reservationCommitted = false;
        throw new CatalogLockRecoveryError({ cause: error });
      } else if (reconciled.state === "empty") {
        await strictRemoveBoundEmptyDirectory(
          location.lock,
          quarantineLockPath(location.lock, createLockToken()),
          reserved.directory,
          parent,
        );
        reservationCommitted = false;
        throw new CatalogLockRecoveryError({ cause: error });
      } else {
        throw new CatalogLockRecoveryError({ cause: error });
      }
    }
    published = true;
    let confirmed = canonicalOwner;
    if (hooks.afterLockRenameCommitted !== undefined) {
      await hooks.afterLockRenameCommitted();
      confirmed = await confirmBoundLockOwner(
        location.lock,
        reserved.directory,
        ownerName,
        canonicalOwner,
        parent,
      );
    }
    return { directory: reserved.directory, owner: confirmed };
  } catch (error) {
    if (error instanceof BoundLockReservationError && error.reservationMayHaveCommitted) {
      reservationCommitted = true;
    }
    throw error;
  } finally {
    if (!reservationCommitted || published) {
      await retireBoundLockCandidate(
        candidate,
        quarantineLockPath(location.lock, createLockToken()),
        directory,
        ownerName,
        owner,
        parent,
        hooks.afterInitializerQuarantined,
        hooks.afterInitializerOwnerTombstoned,
      );
    }
  }
};
