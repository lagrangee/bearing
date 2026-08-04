import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { CatalogBusyError, CatalogRecoveryRequiredError } from "./errors";
import { type CatalogDocument, emptyCatalogDocument, parseCatalogDocument } from "./model";

const SCHEMA_VERSION = 1;
const DEFAULT_BUSY_TIMEOUT_MS = 1_000;

const openDatabase = async (
  path: string,
  options?: ConstructorParameters<typeof DatabaseSync>[1],
): Promise<DatabaseSync> => {
  const { DatabaseSync: SqliteDatabase } = await import("node:sqlite");
  return options === undefined ? new SqliteDatabase(path) : new SqliteDatabase(path, options);
};

export const catalogDatabasePath = (homeDir: string): string =>
  join(homeDir, ".bearing", "catalog.sqlite");

const exists = async (path: string): Promise<boolean> => {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile())
      throw new CatalogRecoveryRequiredError("Project Catalog is unavailable.");
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const databaseError = (error: unknown): never => {
  const message = error instanceof Error ? error.message : "Unknown SQLite failure.";
  if (/busy|locked/i.test(message)) throw new CatalogBusyError({ cause: error });
  throw new CatalogRecoveryRequiredError("Project Catalog is unavailable.", { cause: error });
};

const configure = (database: DatabaseSync, timeoutMs: number): void => {
  database.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(timeoutMs))}`);
};

const initializeSchema = (database: DatabaseSync): void => {
  database.exec(`
    CREATE TABLE catalog_entries (
      entry_id TEXT PRIMARY KEY NOT NULL,
      repo_root TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0)
    ) STRICT;
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
};

const assertSchema = (database: DatabaseSync): void => {
  const version = database.prepare("PRAGMA user_version").get()?.["user_version"];
  if (version !== SCHEMA_VERSION)
    throw new Error("Project Catalog schema version is incompatible.");
  const table = database
    .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'catalog_entries'")
    .get();
  const normalizedSql =
    typeof table?.["sql"] === "string"
      ? table["sql"].replace(/\s+/gu, " ").trim().toLowerCase()
      : "";
  const expectedSql = `create table catalog_entries ( entry_id text primary key not null, repo_root text not null unique, display_name text not null check (length(trim(display_name)) > 0) ) strict`;
  if (normalizedSql !== expectedSql) {
    throw new Error("Project Catalog schema is incompatible.");
  }
  const columns = database.prepare("PRAGMA table_info(catalog_entries)").all();
  const signature = columns.map((column) => [
    column["name"],
    column["type"],
    column["notnull"],
    column["pk"],
  ]);
  const expected = [
    ["entry_id", "TEXT", 1, 1],
    ["repo_root", "TEXT", 1, 0],
    ["display_name", "TEXT", 1, 0],
  ];
  if (JSON.stringify(signature) !== JSON.stringify(expected)) {
    throw new Error("Project Catalog schema is incompatible.");
  }
};

const readDocument = (database: DatabaseSync): CatalogDocument =>
  parseCatalogDocument({
    version: 1,
    entries: database
      .prepare(
        "SELECT entry_id AS entryId, repo_root AS repoRoot, display_name AS displayName FROM catalog_entries ORDER BY entry_id",
      )
      .all()
      .map((row: Record<string, SQLOutputValue>) => ({
        entryId: row["entryId"],
        repoRoot: row["repoRoot"],
        displayName: row["displayName"],
      })),
  });

const replaceDocument = (database: DatabaseSync, document: CatalogDocument): void => {
  database.exec("DELETE FROM catalog_entries");
  const insert = database.prepare(
    "INSERT INTO catalog_entries(entry_id, repo_root, display_name) VALUES (?, ?, ?)",
  );
  for (const entry of parseCatalogDocument(document).entries) {
    insert.run(entry.entryId, entry.repoRoot, entry.displayName);
  }
};

export type CatalogReadState =
  | Readonly<{ state: "ready"; document: CatalogDocument }>
  | Readonly<{
      state: "degraded";
      document: CatalogDocument;
      diagnostic: Readonly<{ code: "catalog-current-invalid"; message: string }>;
    }>
  | Readonly<{
      state: "failed";
      diagnostic: Readonly<{ code: "catalog-unusable"; message: string }>;
    }>;

export const readSqliteCatalogState = async (homeDir: string): Promise<CatalogReadState> => {
  const path = catalogDatabasePath(homeDir);
  try {
    if (!(await exists(path))) return { state: "ready", document: emptyCatalogDocument() };
  } catch {
    return {
      state: "failed",
      diagnostic: { code: "catalog-unusable", message: "Project Catalog is unavailable." },
    };
  }
  let database: DatabaseSync | undefined;
  try {
    database = await openDatabase(path, { readOnly: true });
    configure(database, DEFAULT_BUSY_TIMEOUT_MS);
    assertSchema(database);
    return { state: "ready", document: readDocument(database) };
  } catch {
    return {
      state: "failed",
      diagnostic: { code: "catalog-unusable", message: "Project Catalog is unavailable." },
    };
  } finally {
    database?.close();
  }
};

export const runSqliteCatalogTransaction = async <Result>(options: {
  readonly homeDir: string;
  readonly mutate: (
    current: CatalogDocument,
  ) => Readonly<{ result: Result; next?: CatalogDocument }>;
}): Promise<Result> => {
  const directory = join(options.homeDir, ".bearing");
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    return databaseError(error);
  }
  const path = catalogDatabasePath(options.homeDir);
  let databaseExisted: boolean;
  try {
    databaseExisted = await exists(path);
  } catch (error) {
    return databaseError(error);
  }
  let database: DatabaseSync | undefined;
  let began = false;
  let mutationFailed = false;
  try {
    database = await openDatabase(path, {
      timeout: DEFAULT_BUSY_TIMEOUT_MS,
    });
    configure(database, DEFAULT_BUSY_TIMEOUT_MS);
    database.exec("BEGIN IMMEDIATE");
    began = true;
    const version = database.prepare("PRAGMA user_version").get()?.["user_version"];
    if (version === 0 && !databaseExisted) initializeSchema(database);
    else assertSchema(database);
    let transaction: Readonly<{ result: Result; next?: CatalogDocument }>;
    try {
      transaction = options.mutate(readDocument(database));
    } catch (error) {
      mutationFailed = true;
      throw error;
    }
    if (transaction.next !== undefined) replaceDocument(database, transaction.next);
    database.exec("COMMIT");
    began = false;
    return transaction.result;
  } catch (error) {
    if (began) {
      try {
        database?.exec("ROLLBACK");
      } catch {
        // Preserve the originating failure.
      }
    }
    if (mutationFailed) throw error;
    return databaseError(error);
  } finally {
    database?.close();
  }
};

const replaceUnavailableCatalog = async (path: string): Promise<void> => {
  const temporaryPath = `${path}.reset-${randomUUID()}`;
  let database: DatabaseSync | undefined;
  let promoted = false;
  try {
    database = await openDatabase(temporaryPath);
    database.exec("BEGIN IMMEDIATE");
    initializeSchema(database);
    database.exec("COMMIT");
    database.close();
    database = undefined;
    database = await openDatabase(temporaryPath, { readOnly: true });
    assertSchema(database);
    readDocument(database);
    database.close();
    database = undefined;
    await rm(`${path}-journal`, { force: true });
    await rename(temporaryPath, path);
    promoted = true;
  } catch (error) {
    return databaseError(error);
  } finally {
    database?.close();
    if (!promoted) {
      await rm(temporaryPath, { force: true });
      await rm(`${temporaryPath}-journal`, { force: true });
    }
  }
};

export const resetSqliteCatalog = async (homeDir: string): Promise<void> => {
  const directory = join(homeDir, ".bearing");
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    return databaseError(error);
  }
  const path = catalogDatabasePath(homeDir);
  let present: boolean;
  try {
    present = await exists(path);
  } catch (error) {
    return databaseError(error);
  }
  if (present) {
    const state = await readSqliteCatalogState(homeDir);
    if (state.state === "ready") {
      await runSqliteCatalogTransaction({
        homeDir,
        mutate: () => ({ result: undefined, next: emptyCatalogDocument() }),
      });
      return;
    }
  }
  await replaceUnavailableCatalog(path);
};
