import { CatalogRecoveryRequiredError } from "./errors";
import type { CatalogDocument } from "./model";
import { type CatalogReadState, readSqliteCatalogState, resetSqliteCatalog } from "./sqlite";

export const readCatalogState = async (options: {
  readonly homeDir: string;
}): Promise<CatalogReadState> => {
  return readSqliteCatalogState(options.homeDir);
};

export const readCatalogDocument = async (options: {
  readonly homeDir: string;
}): Promise<CatalogDocument> => {
  const state = await readCatalogState(options);
  if (state.state !== "failed") return state.document;
  throw new CatalogRecoveryRequiredError(state.diagnostic.message);
};

export const resetCatalog = async (options: {
  readonly homeDir: string;
  readonly confirmed: boolean;
}): Promise<Readonly<{ outcome: "applied" }>> => {
  if (!options.confirmed) {
    throw new CatalogRecoveryRequiredError("Catalog reset requires explicit confirmation.");
  }
  await resetSqliteCatalog(options.homeDir);
  return { outcome: "applied" };
};
