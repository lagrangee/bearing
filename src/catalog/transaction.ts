import { withCatalogEntryLeaseGuards } from "./entry-lease-guards";
import { catalogLocationFor, prepareCatalogLocation } from "./location";
import { withCatalogLock } from "./lock";
import type { CatalogDocument } from "./model";
import { parseCatalogDocument } from "./model";
import { readStrictCurrentCatalog, writeCatalogDocument } from "./persistence";

export type CatalogTransactionResult<Result> = Readonly<{
  result: Result;
  next?: CatalogDocument;
}>;

const changedOwnershipIds = (
  current: CatalogDocument,
  next: CatalogDocument,
): readonly string[] => {
  const currentRoots = new Map(current.entries.map((entry) => [entry.entryId, entry.repoRoot]));
  const nextRoots = new Map(next.entries.map((entry) => [entry.entryId, entry.repoRoot]));
  return [...new Set([...currentRoots.keys(), ...nextRoots.keys()])]
    .filter((entryId) => currentRoots.get(entryId) !== nextRoots.get(entryId))
    .sort();
};

export const runCatalogTransaction = async <Result>(options: {
  readonly homeDir: string;
  readonly lockTimeoutMs?: number;
  readonly mutate: (
    current: CatalogDocument,
  ) => Promise<CatalogTransactionResult<Result>> | CatalogTransactionResult<Result>;
}): Promise<Result> => {
  const location = catalogLocationFor(options.homeDir);
  await prepareCatalogLocation(options.homeDir, location);
  return withCatalogLock(location, options.lockTimeoutMs ?? 1_000, async () => {
    const current = parseCatalogDocument(structuredClone(await readStrictCurrentCatalog(location)));
    const mutatorInput = parseCatalogDocument(structuredClone(current));
    const transaction = await options.mutate(mutatorInput);
    if (transaction.next === undefined) return transaction.result;
    const next = parseCatalogDocument(transaction.next);
    await withCatalogEntryLeaseGuards(
      options.homeDir,
      changedOwnershipIds(current, next),
      0,
      async () => {
        await writeCatalogDocument(location.backup, current);
        await writeCatalogDocument(location.file, next);
      },
    );
    return transaction.result;
  });
};
