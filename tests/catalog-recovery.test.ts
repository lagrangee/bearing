import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CatalogRecoveryRequiredError,
  readCatalogDocument,
  readCatalogState,
  renameCatalogEntry,
  repairCatalog,
  resetCatalog,
  upsertCatalogEntry,
} from "../src/catalog/store";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

test("falls back to the last-known-good document when the current Catalog is malformed", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const firstRoot = await createValidBearingRepo();
  const secondRoot = await createValidBearingRepo();
  await upsertCatalogEntry({
    homeDir,
    repoRoot: firstRoot,
    createEntryId: () => "entry-first",
  });
  await upsertCatalogEntry({
    homeDir,
    repoRoot: secondRoot,
    createEntryId: () => "entry-second",
  });
  const backupPath = join(homeDir, ".bearing/catalog.backup.json");
  const expected = JSON.parse(await readFile(backupPath, "utf8"));

  await writeFile(join(homeDir, ".bearing/catalog.json"), "{malformed\n");

  await expect(readCatalogState({ homeDir })).resolves.toEqual({
    state: "degraded",
    document: expected,
    diagnostic: {
      code: "catalog-current-invalid",
      message: "Project Catalog is using its last-known-good backup; run explicit repair.",
    },
  });
  await expect(readCatalogDocument({ homeDir })).resolves.toEqual(expected);
});

test("explicit repair restores a valid backup before mutations resume", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const firstRoot = await createValidBearingRepo();
  const secondRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot: firstRoot, createEntryId: () => "entry-first" });
  await upsertCatalogEntry({ homeDir, repoRoot: secondRoot, createEntryId: () => "entry-second" });
  const backup = JSON.parse(await readFile(join(homeDir, ".bearing/catalog.backup.json"), "utf8"));
  await writeFile(join(homeDir, ".bearing/catalog.json"), "{malformed\n");

  await expect(
    renameCatalogEntry({ homeDir, entryId: "entry-first", displayName: "Blocked rename" }),
  ).rejects.toBeInstanceOf(CatalogRecoveryRequiredError);
  await expect(resetCatalog({ homeDir, confirmed: true })).rejects.toThrow(
    "repair it instead of resetting",
  );
  await expect(repairCatalog({ homeDir })).resolves.toEqual({ outcome: "applied" });
  await expect(readCatalogState({ homeDir })).resolves.toEqual({
    state: "ready",
    document: backup,
  });
});

test("blocks ordinary mutations when neither current nor backup is trustworthy", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-first" });
  await writeFile(join(homeDir, ".bearing/catalog.json"), "{malformed\n");
  await writeFile(join(homeDir, ".bearing/catalog.backup.json"), "{also-malformed\n");

  await expect(readCatalogState({ homeDir })).resolves.toMatchObject({ state: "failed" });
  await expect(upsertCatalogEntry({ homeDir, repoRoot })).rejects.toBeInstanceOf(
    CatalogRecoveryRequiredError,
  );
  await expect(repairCatalog({ homeDir })).rejects.toBeInstanceOf(CatalogRecoveryRequiredError);
});

test("requires explicit confirmation before an unusable Catalog can reset empty", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-first" });
  const currentPath = join(homeDir, ".bearing/catalog.json");
  const backupPath = join(homeDir, ".bearing/catalog.backup.json");
  await writeFile(currentPath, "{malformed\n");
  await writeFile(backupPath, "{also-malformed\n");

  await expect(resetCatalog({ homeDir, confirmed: false })).rejects.toThrow(
    "explicit confirmation",
  );
  expect(await readFile(currentPath, "utf8")).toBe("{malformed\n");

  await expect(resetCatalog({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  await expect(readCatalogDocument({ homeDir })).resolves.toEqual({ version: 1, entries: [] });
  await expect(readCatalogState({ homeDir })).resolves.toMatchObject({ state: "ready" });
});
