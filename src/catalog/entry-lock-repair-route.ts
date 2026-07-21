import { parseCatalogEntryId } from "./entry-id";
import { CatalogLockRecoveryError } from "./errors";

export const ENTRY_LEASE_NAMESPACE_INSPECTION =
  "manual inspection of the fixed Catalog entry-lease namespace (automatic repair is refused for unknown or unsafe artifacts)";

export const entryLockRepairCommand = (inputEntryId: unknown): string => {
  const entryId = parseCatalogEntryId(inputEntryId);
  return `bearing catalog repair-entry-lock --entry ${JSON.stringify(entryId)} --confirm-abandoned`;
};

export const toEntryLockRecoveryError = (error: unknown, inputEntryId: unknown): unknown =>
  error instanceof CatalogLockRecoveryError
    ? new CatalogLockRecoveryError({ cause: error }, entryLockRepairCommand(inputEntryId))
    : error;
