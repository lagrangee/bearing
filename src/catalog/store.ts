export {
  CatalogBusyError,
  CatalogDuplicateRepositoryError,
  CatalogEntryNotFoundError,
  CatalogLocatorReplacementConfirmationRequiredError,
  CatalogRecoveryRequiredError,
} from "./errors";
export {
  type CatalogEntryMutationResult,
  type CatalogUnregisterResult,
  type CatalogUpsertResult,
  relinkCatalogEntry,
  renameCatalogEntry,
  unregisterCatalogEntry,
  upsertCatalogEntry,
} from "./operations";
export {
  readCatalogDocument,
  readCatalogState,
  resetCatalog,
} from "./recovery";
export type { CatalogReadState } from "./sqlite";
