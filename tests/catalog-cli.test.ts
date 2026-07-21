import { expect, test } from "bun:test";
import { access, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { catalogEntryLeaseLocationFor } from "../src/catalog/location";
import { readCatalogDocument, readCatalogState, upsertCatalogEntry } from "../src/catalog/store";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

type CommandResult = Readonly<{ exitCode: number; stdout: string; stderr: string }>;

const runCatalog = async (homeDir: string, args: readonly string[]): Promise<CommandResult> => {
  const child = Bun.spawn(["bun", "src/cli.ts", "catalog", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: homeDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

test("rename, forget, and lifecycle removal mutate only the temp Catalog", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-cli-home-");
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
  const forgottenManifest = await readFile(join(forgottenRoot, ".bearing/manifest.json"));
  const removedManifest = await readFile(join(removedRoot, ".bearing/manifest.json"));

  const renamed = await runCatalog(homeDir, [
    "rename",
    "--entry",
    "entry-forgotten",
    "--name",
    "Renamed fixture",
  ]);
  expect(renamed).toMatchObject({ exitCode: 0, stderr: "" });
  expect(renamed.stdout).toContain("Outcome: applied");
  expect(renamed.stdout).toContain("Display name: Renamed fixture");

  const forgotten = await runCatalog(homeDir, ["forget", "--entry", "entry-forgotten"]);
  expect(forgotten).toMatchObject({ exitCode: 0, stderr: "" });
  expect(forgotten.stdout).toContain("Removed entry: entry-forgotten");

  const removed = await runCatalog(homeDir, ["remove", "--repo", await realpath(removedRoot)]);
  expect(removed).toMatchObject({ exitCode: 0, stderr: "" });
  expect(removed.stdout).toContain("Removed entry: entry-removed");
  expect((await readCatalogDocument({ homeDir })).entries).toEqual([]);
  expect(await readFile(join(forgottenRoot, ".bearing/manifest.json"))).toEqual(forgottenManifest);
  expect(await readFile(join(removedRoot, ".bearing/manifest.json"))).toEqual(removedManifest);
});

test("relink requires explicit move confirmation while the old repository is available", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-cli-home-");
  const oldRoot = await createValidBearingRepo();
  const newFixture = await createValidBearingRepo();
  const newRoot = `${newFixture} with whitespace`;
  await rename(newFixture, newRoot);
  await upsertCatalogEntry({ homeDir, repoRoot: oldRoot, createEntryId: () => "entry-moving" });

  const blocked = await runCatalog(homeDir, [
    "relink",
    "--entry",
    "entry-moving",
    "--repo",
    newRoot,
  ]);
  expect(blocked.exitCode).toBe(1);
  expect(blocked.stderr).toContain("explicit move confirmation is required");
  expect((await readCatalogDocument({ homeDir })).entries[0]?.repoRoot).toBe(
    await realpath(oldRoot),
  );

  const moved = await runCatalog(homeDir, [
    "relink",
    "--entry",
    "entry-moving",
    "--repo",
    newRoot,
    "--confirm-move",
  ]);
  expect(moved).toMatchObject({ exitCode: 0, stderr: "" });
  expect(moved.stdout).toContain("Entry: entry-moving");
  expect((await readCatalogDocument({ homeDir })).entries[0]?.repoRoot).toBe(
    await realpath(newRoot),
  );
});

test("lifecycle remove accepts the canonical locator after the repository was purged", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-cli-home-");
  const repoRoot = await createValidBearingRepo();
  const canonicalRoot = await realpath(repoRoot);
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-purged" });
  await rm(repoRoot, { recursive: true });

  const removed = await runCatalog(homeDir, ["remove", "--repo", canonicalRoot]);
  expect(removed).toEqual({
    exitCode: 0,
    stdout: "Outcome: applied\nRemoved entry: entry-purged\n",
    stderr: "",
  });
  expect(await runCatalog(homeDir, ["remove", "--repo", canonicalRoot])).toEqual({
    exitCode: 0,
    stdout: "Outcome: no-op\n",
    stderr: "",
  });
});

test("repair uses a valid backup and reset requires explicit empty confirmation", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-cli-home-");
  const firstRoot = await createValidBearingRepo();
  const secondRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot: firstRoot, createEntryId: () => "entry-first" });
  await upsertCatalogEntry({ homeDir, repoRoot: secondRoot, createEntryId: () => "entry-second" });
  const currentPath = join(homeDir, ".bearing/catalog.json");
  const backupPath = join(homeDir, ".bearing/catalog.backup.json");
  await writeFile(currentPath, "{malformed\n");

  const repaired = await runCatalog(homeDir, ["repair"]);
  expect(repaired).toEqual({ exitCode: 0, stdout: "Outcome: applied\n", stderr: "" });
  expect((await readCatalogState({ homeDir })).state).toBe("ready");

  await writeFile(currentPath, "{malformed-again\n");
  await writeFile(backupPath, "{also-malformed\n");
  const before = await readFile(currentPath, "utf8");
  const unconfirmed = await runCatalog(homeDir, ["reset"]);
  expect(unconfirmed.exitCode).toBe(1);
  expect(unconfirmed.stderr).toContain("requires --confirm-empty");
  expect(await readFile(currentPath, "utf8")).toBe(before);

  const reset = await runCatalog(homeDir, ["reset", "--confirm-empty"]);
  expect(reset).toEqual({ exitCode: 0, stdout: "Outcome: applied\n", stderr: "" });
  expect(await readCatalogDocument({ homeDir })).toEqual({ version: 1, entries: [] });
});

test("repair-lock requires abandoned-lock confirmation and is distinct from backup repair", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-cli-home-");
  const lock = join(homeDir, ".bearing/catalog.lock");
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, "owner.json"), "malformed-owner\n");

  const unconfirmed = await runCatalog(homeDir, ["repair-lock"]);
  expect(unconfirmed.exitCode).toBe(1);
  expect(unconfirmed.stderr).toContain("requires --confirm-abandoned");
  await access(join(lock, "owner.json"));

  const repaired = await runCatalog(homeDir, ["repair-lock", "--confirm-abandoned"]);
  expect(repaired).toEqual({ exitCode: 0, stdout: "Outcome: applied\n", stderr: "" });
  await expect(access(lock)).rejects.toThrow();

  const noOp = await runCatalog(homeDir, ["repair-lock", "--confirm-abandoned"]);
  expect(noOp).toEqual({ exitCode: 0, stdout: "Outcome: no-op\n", stderr: "" });
});

test("repair-entry-lock targets one confirmed entry lease and never scans", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-cli-home-");
  const lock = catalogEntryLeaseLocationFor(homeDir, "entry-a").lock;
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, "owner.json"), "malformed-owner\n");

  const unconfirmed = await runCatalog(homeDir, ["repair-entry-lock", "--entry", "entry-a"]);
  expect(unconfirmed.exitCode).toBe(1);
  expect(unconfirmed.stderr).toContain("requires --confirm-abandoned");
  await access(join(lock, "owner.json"));

  const repaired = await runCatalog(homeDir, [
    "repair-entry-lock",
    "--entry",
    "entry-a",
    "--confirm-abandoned",
  ]);
  expect(repaired).toEqual({ exitCode: 0, stdout: "Outcome: applied\n", stderr: "" });
  await expect(access(lock)).rejects.toThrow();

  const invalid = await runCatalog(homeDir, [
    "repair-entry-lock",
    "--entry",
    "../escape",
    "--confirm-abandoned",
  ]);
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr).not.toBe("");
});
