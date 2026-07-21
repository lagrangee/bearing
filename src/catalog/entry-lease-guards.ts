import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { inspectInstallPath } from "../install-boundary";
import { decodeCatalogEntryIdFilename } from "./entry-id-filename";
import {
  ENTRY_LEASE_NAMESPACE_INSPECTION,
  entryLockRepairCommand,
  toEntryLockRecoveryError,
} from "./entry-lock-repair-route";
import { CatalogLockRecoveryError } from "./errors";
import {
  catalogEntryLeaseLocationFor,
  catalogEntryLeaseNamespaceFor,
  prepareCatalogEntryLeaseLocation,
} from "./location";
import { acquireOwnedLock, type OwnedLockHandle } from "./lock";
import { canonicalLockBasenameFromDebris } from "./lock-artifact-name";

const entryLeaseNamespaceInspectionError = (options?: ErrorOptions): CatalogLockRecoveryError =>
  new CatalogLockRecoveryError(options, ENTRY_LEASE_NAMESPACE_INSPECTION);
const isSystemError = (error: unknown): error is Error & Readonly<{ code: string }> =>
  error instanceof Error && "code" in error && typeof error.code === "string";

const releaseEntryHandle = async (handle: OwnedLockHandle, entryId: string): Promise<void> => {
  try {
    await handle.release();
  } catch (error) {
    const translated = toEntryLockRecoveryError(error, entryId);
    if (translated instanceof Error) throw translated;
    throw error;
  }
};

export const withCatalogEntryLock = async <Result>(
  homeDir: string,
  entryId: string,
  timeoutMs: number,
  operation: () => Promise<Result>,
): Promise<Result> => {
  const location = catalogEntryLeaseLocationFor(homeDir, entryId);
  await prepareCatalogEntryLeaseLocation(homeDir, location);
  let handle: OwnedLockHandle;
  try {
    handle = await acquireOwnedLock(location, timeoutMs);
  } catch (error) {
    const translated = toEntryLockRecoveryError(error, entryId);
    if (translated instanceof Error) throw translated;
    throw error;
  }
  try {
    return await operation();
  } finally {
    await releaseEntryHandle(handle, entryId);
  }
};

export const withCatalogEntryLeaseGuards = async <Result>(
  homeDir: string,
  inputEntryIds: readonly string[],
  timeoutMs: number,
  operation: () => Promise<Result>,
): Promise<Result> => {
  const entryIds = [...new Set(inputEntryIds)].sort();
  const acquire = async (index: number): Promise<Result> => {
    const entryId = entryIds[index];
    if (entryId === undefined) return operation();
    return withCatalogEntryLock(homeDir, entryId, timeoutMs, () => acquire(index + 1));
  };
  return acquire(0);
};

export const inspectCatalogEntryLeaseIds = async (homeDir: string): Promise<readonly string[]> => {
  const namespace = catalogEntryLeaseNamespaceFor(homeDir);
  const state = await inspectInstallPath(namespace);
  if (state.kind === "missing") return [];
  if (state.kind !== "directory") throw entryLeaseNamespaceInspectionError();
  let entries: Dirent<string>[];
  try {
    entries = await readdir(namespace, { withFileTypes: true });
  } catch (error) {
    if (!isSystemError(error)) throw error;
    throw entryLeaseNamespaceInspectionError({ cause: error });
  }
  const ids: string[] = [];
  for (const entry of entries) {
    const debrisBase = canonicalLockBasenameFromDebris(entry.name);
    if (debrisBase?.endsWith(".lock") === true) {
      if (!entry.isDirectory()) throw entryLeaseNamespaceInspectionError();
      let entryId: string;
      try {
        entryId = decodeCatalogEntryIdFilename(debrisBase.slice(0, -".lock".length));
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        throw entryLeaseNamespaceInspectionError({ cause: error });
      }
      throw new CatalogLockRecoveryError(undefined, entryLockRepairCommand(entryId));
    }
    if (!entry.isDirectory() || !entry.name.endsWith(".lock")) {
      throw entryLeaseNamespaceInspectionError();
    }
    const candidate = entry.name.slice(0, -".lock".length);
    try {
      ids.push(decodeCatalogEntryIdFilename(candidate));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw entryLeaseNamespaceInspectionError({ cause: error });
    }
  }
  return ids.sort();
};

export const withExistingCatalogEntryLeaseGuards = async <Result>(
  homeDir: string,
  operation: () => Promise<Result>,
): Promise<Result> =>
  withCatalogEntryLeaseGuards(homeDir, await inspectCatalogEntryLeaseIds(homeDir), 0, operation);
