import { withExistingCatalogEntryLeaseGuards } from "./entry-lease-guards";
import { CatalogRecoveryRequiredError } from "./errors";
import { catalogLocationFor, prepareCatalogLocation, validateCatalogLocation } from "./location";
import { withCatalogLock } from "./lock";
import { type CatalogDocument, emptyCatalogDocument } from "./model";
import { type CatalogReadState, readCatalogStateAt, writeCatalogDocument } from "./persistence";

export const readCatalogState = async (options: {
  readonly homeDir: string;
}): Promise<CatalogReadState> => {
  const location = catalogLocationFor(options.homeDir);
  await validateCatalogLocation(options.homeDir, location);
  return readCatalogStateAt(location);
};

export const readCatalogDocument = async (options: {
  readonly homeDir: string;
}): Promise<CatalogDocument> => {
  const state = await readCatalogState(options);
  if (state.state !== "failed") return state.document;
  throw new CatalogRecoveryRequiredError(state.diagnostic.message);
};

export const repairCatalog = async (options: {
  readonly homeDir: string;
  readonly lockTimeoutMs?: number;
}): Promise<Readonly<{ outcome: "applied" | "no-op" }>> => {
  const location = catalogLocationFor(options.homeDir);
  await prepareCatalogLocation(options.homeDir, location);
  return withCatalogLock(location, options.lockTimeoutMs ?? 1_000, async () => {
    const state = await readCatalogStateAt(location);
    if (state.state === "ready") return { outcome: "no-op" };
    if (state.state === "failed") throw new CatalogRecoveryRequiredError();
    await withExistingCatalogEntryLeaseGuards(options.homeDir, () =>
      writeCatalogDocument(location.file, state.document),
    );
    return { outcome: "applied" };
  });
};

export const resetCatalog = async (options: {
  readonly homeDir: string;
  readonly confirmed: boolean;
  readonly lockTimeoutMs?: number;
}): Promise<Readonly<{ outcome: "applied" }>> => {
  if (!options.confirmed) {
    throw new CatalogRecoveryRequiredError("Catalog reset requires explicit confirmation.");
  }
  const location = catalogLocationFor(options.homeDir);
  await prepareCatalogLocation(options.homeDir, location);
  return withCatalogLock(location, options.lockTimeoutMs ?? 1_000, async () => {
    const state = await readCatalogStateAt(location);
    if (state.state !== "failed") {
      throw new CatalogRecoveryRequiredError(
        state.state === "degraded"
          ? "A trustworthy backup exists; repair it instead of resetting."
          : "A trustworthy Catalog exists; reset is not available.",
      );
    }
    const empty = emptyCatalogDocument();
    await withExistingCatalogEntryLeaseGuards(options.homeDir, async () => {
      await writeCatalogDocument(location.backup, empty);
      await writeCatalogDocument(location.file, empty);
    });
    return { outcome: "applied" };
  });
};
