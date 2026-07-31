import { setTimeout as wait } from "node:timers/promises";
import { entryLockRepairCommand, toEntryLockRecoveryError } from "./entry-lock-repair-route";
import { CatalogEntryOwnershipError, CatalogLockError, CatalogLockRecoveryError } from "./errors";
import {
  catalogEntryLeaseLocationFor,
  catalogLocationFor,
  prepareCatalogEntryLeaseLocation,
} from "./location";
import { acquireOwnedLock, type OwnedLockHandle, withCatalogLock } from "./lock";
import { readStrictCurrentCatalog } from "./persistence";

const RETRY_DELAY_MS = 20;

const releaseEntryHandle = async (handle: OwnedLockHandle, entryId: string): Promise<void> => {
  try {
    await handle.release();
  } catch (error) {
    const translated = toEntryLockRecoveryError(error, entryId);
    if (translated instanceof Error) throw translated;
    throw error;
  }
};

const acquireEntryDuringCatalogAdmission = async (
  catalog: ReturnType<typeof catalogLocationFor>,
  lease: ReturnType<typeof catalogEntryLeaseLocationFor>,
  repoRoot: string,
  timeoutMs: number,
): Promise<OwnedLockHandle | undefined> => {
  let handle: OwnedLockHandle | undefined;
  try {
    const admitted = await withCatalogLock(catalog, timeoutMs, async () => {
      try {
        handle = await acquireOwnedLock(lease, 0);
      } catch (error) {
        if (error instanceof CatalogLockError) return false;
        if (error instanceof CatalogLockRecoveryError) {
          throw new CatalogLockRecoveryError(
            { cause: error },
            entryLockRepairCommand(lease.entryId),
          );
        }
        throw error;
      }
      const current = await readStrictCurrentCatalog(catalog);
      const owner = current.entries.find((entry) => entry.entryId === lease.entryId);
      if (owner?.repoRoot !== repoRoot) throw new CatalogEntryOwnershipError();
      return true;
    });
    if (!admitted) return undefined;
    if (handle === undefined) throw new Error("Catalog entry admission lost its lock handle.");
    return handle;
  } catch (error) {
    if (handle !== undefined) await releaseEntryHandle(handle, lease.entryId);
    throw error;
  }
};

export type CatalogEntryLeaseStatus = Readonly<{ contended: boolean }>;

export const withCatalogEntryLeaseStatus = async <Result>(
  homeDir: string,
  entryId: string,
  repoRoot: string,
  operation: (status: CatalogEntryLeaseStatus) => Promise<Result>,
  lockTimeoutMs = 1_000,
): Promise<Result> => {
  const catalog = catalogLocationFor(homeDir);
  const lease = catalogEntryLeaseLocationFor(homeDir, entryId);
  await prepareCatalogEntryLeaseLocation(homeDir, lease);
  const deadline = Date.now() + Math.max(0, lockTimeoutMs);
  let handle: OwnedLockHandle | undefined;
  let contended = false;
  while (handle === undefined) {
    const remainingMs = Math.max(0, deadline - Date.now());
    handle = await acquireEntryDuringCatalogAdmission(catalog, lease, repoRoot, remainingMs);
    if (handle !== undefined) break;
    contended = true;
    if (Date.now() >= deadline) throw new CatalogLockError();
    await wait(Math.min(RETRY_DELAY_MS, Math.max(1, deadline - Date.now())));
  }
  try {
    return await operation({ contended });
  } finally {
    await releaseEntryHandle(handle, lease.entryId);
  }
};

export const withCatalogEntryLease = async <Result>(
  homeDir: string,
  entryId: string,
  repoRoot: string,
  operation: () => Promise<Result>,
  lockTimeoutMs = 1_000,
): Promise<Result> =>
  withCatalogEntryLeaseStatus(homeDir, entryId, repoRoot, operation, lockTimeoutMs);
