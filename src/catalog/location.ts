import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ensureInstallDirectoryTargets, inspectInstallPath } from "../install-boundary";
import { parseCatalogEntryId } from "./entry-id";
import { encodeCatalogEntryIdFilename } from "./entry-id-filename";

const CATALOG_DIRECTORY = ".bearing";
const ENTRY_LEASE_DIRECTORY = "entry-leases";

export const catalogEntryLeaseNamespaceFor = (homeDir: string): string =>
  join(resolve(homeDir, CATALOG_DIRECTORY), ENTRY_LEASE_DIRECTORY);

export type CatalogLocation = Readonly<{
  root: string;
  file: string;
  backup: string;
  lock: string;
  lockOwner: string;
  lockRecovery: string;
}>;

export type CatalogEntryLeaseLocation = Readonly<{
  namespace: string;
  entryId: string;
  lock: string;
  lockOwner: string;
  lockRecovery: string;
}>;

export const catalogLocationFor = (homeDir: string): CatalogLocation => {
  const root = resolve(homeDir, CATALOG_DIRECTORY);
  const lock = join(root, "catalog.lock");
  return {
    root,
    file: join(root, "catalog.json"),
    backup: join(root, "catalog.backup.json"),
    lock,
    lockOwner: join(lock, "owner.json"),
    lockRecovery: join(lock, "recovery"),
  };
};

export const catalogEntryLeaseLocationFor = (
  homeDir: string,
  inputEntryId: unknown,
): CatalogEntryLeaseLocation => {
  const entryId = parseCatalogEntryId(inputEntryId);
  const namespace = catalogEntryLeaseNamespaceFor(homeDir);
  const lock = join(namespace, `${encodeCatalogEntryIdFilename(entryId)}.lock`);
  return {
    namespace,
    entryId,
    lock,
    lockOwner: join(lock, "owner.json"),
    lockRecovery: join(lock, "recovery"),
  };
};

export const validateCatalogLocation = async (
  homeDir: string,
  location: CatalogLocation,
): Promise<void> => {
  await ensureInstallDirectoryTargets(homeDir, [location.file, location.backup]);
};

export const prepareCatalogLocation = async (
  homeDir: string,
  location: CatalogLocation,
): Promise<void> => {
  await validateCatalogLocation(homeDir, location);
  await ensureInstallDirectoryTargets(homeDir, [location.lockOwner]);
  let state = await inspectInstallPath(location.root);
  if (state.kind === "missing") {
    try {
      await mkdir(location.root, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    state = await inspectInstallPath(location.root);
  }
  if (state.kind !== "directory") {
    throw new Error("Bearing user state root must be a safe directory.");
  }
};

export const validateCatalogEntryLeaseLocation = async (
  homeDir: string,
  location: CatalogEntryLeaseLocation,
): Promise<void> => {
  await ensureInstallDirectoryTargets(homeDir, [location.lockOwner]);
};

export const prepareCatalogEntryLeaseLocation = async (
  homeDir: string,
  location: CatalogEntryLeaseLocation,
): Promise<void> => {
  await prepareCatalogLocation(homeDir, catalogLocationFor(homeDir));
  await validateCatalogEntryLeaseLocation(homeDir, location);
  let state = await inspectInstallPath(location.namespace);
  if (state.kind === "missing") {
    try {
      await mkdir(location.namespace, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    state = await inspectInstallPath(location.namespace);
  }
  if (state.kind !== "directory") {
    throw new Error("Catalog entry lease namespace must be a safe directory.");
  }
  await validateCatalogEntryLeaseLocation(homeDir, location);
};
