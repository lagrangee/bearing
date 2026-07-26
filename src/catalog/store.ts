export { withCatalogEntryLease } from "./entry-lease";
export {
  type CatalogEntryLockRepairResult,
  repairCatalogEntryLock,
} from "./entry-lease-repair";
export {
  CatalogDuplicateRepositoryError,
  CatalogEntryNotFoundError,
  CatalogEntryOwnershipError,
  CatalogLockError,
  CatalogLockRecoveryError,
  CatalogLockRepairError,
  CatalogMoveConfirmationRequiredError,
  CatalogRecoveryRequiredError,
} from "./errors";
export { type CatalogLockRepairResult, repairCatalogLock } from "./lock-repair";
export {
  type CatalogEntryMutationResult,
  type CatalogRemovalResult,
  type CatalogUpsertResult,
  forgetCatalogEntry,
  relinkCatalogEntry,
  removeCatalogEntryByExactIdentity,
  removeCatalogEntryByRepoRoot,
  renameCatalogEntry,
  upsertCatalogEntry,
} from "./operations";
export type { CatalogReadState } from "./persistence";
export {
  readCatalogDocument,
  readCatalogState,
  repairCatalog,
  resetCatalog,
} from "./recovery";
