import type { CatalogDocument } from "./model";
import { runSqliteCatalogTransaction } from "./sqlite";

export type CatalogTransactionResult<Result> = Readonly<{
  result: Result;
  next?: CatalogDocument;
}>;

export const runCatalogTransaction = async <Result>(options: {
  readonly homeDir: string;
  readonly mutate: (current: CatalogDocument) => CatalogTransactionResult<Result>;
}): Promise<Result> =>
  runSqliteCatalogTransaction({
    homeDir: options.homeDir,
    mutate: options.mutate,
  });
