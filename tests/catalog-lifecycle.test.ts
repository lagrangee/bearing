import { expect, test } from "bun:test";
import { access, readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  CatalogDuplicateRepositoryError,
  CatalogMoveConfirmationRequiredError,
  forgetCatalogEntry,
  readCatalogDocument,
  relinkCatalogEntry,
  removeCatalogEntryByRepoRoot,
  renameCatalogEntry,
  upsertCatalogEntry,
} from "../src/catalog/store";
import { runCatalogTransaction } from "../src/catalog/transaction";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

test("renames only the user-local alias while preserving Catalog identity", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-project" });

  await expect(
    renameCatalogEntry({ homeDir, entryId: "entry-project", displayName: "Renamed project" }),
  ).resolves.toEqual({
    outcome: "applied",
    entry: {
      entryId: "entry-project",
      repoRoot: await realpath(repoRoot),
      displayName: "Renamed project",
    },
  });
  expect((await readCatalogDocument({ homeDir })).entries).toHaveLength(1);
});

test("validates the complete next document before a transaction changes either Catalog file", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const firstRoot = await createValidBearingRepo();
  const secondRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot: firstRoot, createEntryId: () => "entry-shared" });
  const currentPath = join(homeDir, ".bearing/catalog.json");
  const backupPath = join(homeDir, ".bearing/catalog.backup.json");
  const beforeCurrent = await readFile(currentPath);
  const beforeBackup = await readFile(backupPath);

  await expect(
    upsertCatalogEntry({ homeDir, repoRoot: secondRoot, createEntryId: () => "entry-shared" }),
  ).rejects.toThrow("identity must be unique");
  expect(await readFile(currentPath)).toEqual(beforeCurrent);
  expect(await readFile(backupPath)).toEqual(beforeBackup);
});

test("keeps backup bytes detached from in-place transaction mutation", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const firstRoot = await realpath(await createValidBearingRepo());
  const secondRoot = await realpath(await createValidBearingRepo());
  await upsertCatalogEntry({ homeDir, repoRoot: firstRoot, createEntryId: () => "entry-first" });

  await runCatalogTransaction({
    homeDir,
    mutate: (current) => {
      current.entries.push({
        entryId: "entry-second",
        repoRoot: secondRoot,
        displayName: "Second",
      });
      return { result: "applied", next: current };
    },
  });

  const backup = JSON.parse(await readFile(join(homeDir, ".bearing/catalog.backup.json"), "utf8"));
  const current = JSON.parse(await readFile(join(homeDir, ".bearing/catalog.json"), "utf8"));
  expect(backup.entries.map((entry: { entryId: string }) => entry.entryId)).toEqual([
    "entry-first",
  ]);
  expect(current.entries.map((entry: { entryId: string }) => entry.entryId)).toEqual([
    "entry-first",
    "entry-second",
  ]);
});

test("forget and lifecycle removal mutate only the Catalog and remain idempotent", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const forgottenRoot = await createValidBearingRepo();
  const removedRoot = await createValidBearingRepo();
  await upsertCatalogEntry({
    homeDir,
    repoRoot: forgottenRoot,
    createEntryId: () => "entry-forgotten",
  });
  await upsertCatalogEntry({
    homeDir,
    repoRoot: removedRoot,
    createEntryId: () => "entry-removed",
  });
  const canonicalRemovedRoot = await realpath(removedRoot);

  await expect(forgetCatalogEntry({ homeDir, entryId: "entry-forgotten" })).resolves.toMatchObject({
    outcome: "applied",
    removedEntry: { entryId: "entry-forgotten" },
  });
  await expect(forgetCatalogEntry({ homeDir, entryId: "entry-forgotten" })).resolves.toEqual({
    outcome: "no-op",
  });
  await expect(
    removeCatalogEntryByRepoRoot({ homeDir, repoRoot: canonicalRemovedRoot }),
  ).resolves.toMatchObject({ outcome: "applied", removedEntry: { entryId: "entry-removed" } });
  await expect(
    removeCatalogEntryByRepoRoot({ homeDir, repoRoot: canonicalRemovedRoot }),
  ).resolves.toEqual({ outcome: "no-op" });
  await access(join(forgottenRoot, ".bearing/manifest.json"));
  await access(join(removedRoot, ".bearing/manifest.json"));
  expect((await readCatalogDocument({ homeDir })).entries).toEqual([]);
});

test("removes a lifecycle entry after repository deactivation has removed its manifest", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-deactivated" });
  const canonicalRoot = await realpath(repoRoot);
  await rm(join(repoRoot, ".bearing/manifest.json"));

  await expect(
    removeCatalogEntryByRepoRoot({ homeDir, repoRoot: canonicalRoot }),
  ).resolves.toMatchObject({
    outcome: "applied",
    removedEntry: { entryId: "entry-deactivated" },
  });
  expect((await readCatalogDocument({ homeDir })).entries).toEqual([]);
});

test("removes a purged repository by its pre-mutation canonical path and retries without writes", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  const canonicalRoot = await realpath(repoRoot);
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-purged" });
  await rm(repoRoot, { recursive: true });

  await expect(
    removeCatalogEntryByRepoRoot({ homeDir, repoRoot: canonicalRoot }),
  ).resolves.toMatchObject({ outcome: "applied", removedEntry: { entryId: "entry-purged" } });
  expect(await readCatalogDocument({ homeDir })).toEqual({ version: 1, entries: [] });
  const backup = JSON.parse(await readFile(join(homeDir, ".bearing/catalog.backup.json"), "utf8"));
  expect(backup.entries).toEqual([
    expect.objectContaining({ entryId: "entry-purged", repoRoot: canonicalRoot }),
  ]);
  const afterRemoval = await Promise.all([
    readFile(join(homeDir, ".bearing/catalog.json")),
    readFile(join(homeDir, ".bearing/catalog.backup.json")),
  ]);

  await expect(removeCatalogEntryByRepoRoot({ homeDir, repoRoot: canonicalRoot })).resolves.toEqual(
    { outcome: "no-op" },
  );
  expect(
    await Promise.all([
      readFile(join(homeDir, ".bearing/catalog.json")),
      readFile(join(homeDir, ".bearing/catalog.backup.json")),
    ]),
  ).toEqual(afterRemoval);
});

test("lifecycle removal rejects relative and non-normalized repository locators", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await realpath(await createValidBearingRepo());
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-preserved" });
  const before = await Promise.all([
    readFile(join(homeDir, ".bearing/catalog.json")),
    readFile(join(homeDir, ".bearing/catalog.backup.json")),
  ]);
  const traversal = `${repoRoot}/../${basename(repoRoot)}`;
  expect(dirname(repoRoot)).not.toBe(repoRoot);

  await expect(
    removeCatalogEntryByRepoRoot({ homeDir, repoRoot: "relative/project" }),
  ).rejects.toThrow("normalized absolute path");
  await expect(removeCatalogEntryByRepoRoot({ homeDir, repoRoot: traversal })).rejects.toThrow(
    "normalized absolute path",
  );
  expect(
    await Promise.all([
      readFile(join(homeDir, ".bearing/catalog.json")),
      readFile(join(homeDir, ".bearing/catalog.backup.json")),
    ]),
  ).toEqual(before);
});

test("relinks an unavailable old locator directly while preserving identity and alias", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const oldRoot = await createValidBearingRepo();
  const newRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot: oldRoot, createEntryId: () => "entry-moving" });
  await renameCatalogEntry({ homeDir, entryId: "entry-moving", displayName: "Preserved alias" });
  await rm(oldRoot, { recursive: true });

  await expect(
    relinkCatalogEntry({ homeDir, entryId: "entry-moving", newRepoRoot: newRoot }),
  ).resolves.toEqual({
    outcome: "applied",
    entry: {
      entryId: "entry-moving",
      repoRoot: await realpath(newRoot),
      displayName: "Preserved alias",
    },
  });
});

test("requires copy confirmation and rejects a relink target owned by another entry", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const oldRoot = await createValidBearingRepo();
  const newRoot = await createValidBearingRepo();
  const ownedRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot: oldRoot, createEntryId: () => "entry-moving" });
  await upsertCatalogEntry({ homeDir, repoRoot: ownedRoot, createEntryId: () => "entry-owned" });

  await expect(
    relinkCatalogEntry({ homeDir, entryId: "entry-moving", newRepoRoot: newRoot }),
  ).rejects.toBeInstanceOf(CatalogMoveConfirmationRequiredError);
  await expect(
    relinkCatalogEntry({
      homeDir,
      entryId: "entry-moving",
      newRepoRoot: ownedRoot,
      confirmMove: true,
    }),
  ).rejects.toBeInstanceOf(CatalogDuplicateRepositoryError);

  await expect(
    relinkCatalogEntry({
      homeDir,
      entryId: "entry-moving",
      newRepoRoot: newRoot,
      confirmMove: true,
    }),
  ).resolves.toMatchObject({ outcome: "applied", entry: { entryId: "entry-moving" } });
  expect(await readFile(join(oldRoot, ".bearing/manifest.json"), "utf8")).toContain(
    '"schemaVersion": 1',
  );
});
