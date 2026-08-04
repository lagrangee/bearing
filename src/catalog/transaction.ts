import type { CatalogDocument } from "./model";
import { runSqliteCatalogTransaction } from "./sqlite";

export type CatalogTransactionResult<Result> = Readonly<{
  result: Result;
  next?: CatalogDocument;
}>;

export const runCatalogTransaction = async <Result>(options: {
  readonly homeDir: string;
  readonly lockTimeoutMs?: number;
  readonly mutate: (
    current: CatalogDocument,
  ) => CatalogTransactionResult<Result> | Promise<CatalogTransactionResult<Result>>;
}): Promise<Result> =>
  runSqliteCatalogTransaction({
    homeDir: options.homeDir,
    ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
    mutate: (current) => {
      const transaction = options.mutate(current);
      if (transaction instanceof Promise) {
        throw new Error("Project Catalog transaction callbacks must be synchronous.");
      }
      return transaction;
    },
  });
