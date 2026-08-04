export {
  CatalogBusyError,
  CatalogDuplicateRepositoryError,
  CatalogEntryNotFoundError,
  CatalogMoveConfirmationRequiredError,
  CatalogRecoveryRequiredError,
} from "./errors";
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
export {
  readCatalogDocument,
  readCatalogState,
  resetCatalog,
} from "./recovery";
export type { CatalogReadState } from "./sqlite";
