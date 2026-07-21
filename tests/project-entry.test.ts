import { expect, test } from "bun:test";
import { link, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogReadResult } from "../src/portal/contract";
import { resolveProjectEntry } from "../src/portal/project-entry";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

const readyCatalog = (repoRoot: string): CatalogReadResult => ({
  state: "ready",
  entries: [
    {
      entryId: "entry-project",
      displayName: "Project alias",
      repoRoot,
      availability: "available",
    },
  ],
});

test("resolves only a fresh, available Catalog entry to an internal repository root", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());

  const result = await resolveProjectEntry({
    entryId: "entry-project",
    readCatalog: async () => readyCatalog(repoRoot),
  });

  expect(result).toEqual({
    kind: "available",
    entry: { entryId: "entry-project", displayName: "Project alias", repoRoot },
  });
});

test("resolves a trustworthy entry retained by degraded Catalog recovery", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  const ready = readyCatalog(repoRoot);
  if (ready.state !== "ready") throw new Error("Expected a ready Catalog fixture.");

  const result = await resolveProjectEntry({
    entryId: "entry-project",
    readCatalog: async () => ({
      state: "degraded",
      entries: ready.entries,
      diagnostic: {
        code: "catalog-current-invalid",
        message: "Project Catalog is using its last-known-good backup; run explicit repair.",
      },
    }),
  });

  expect(result).toEqual({
    kind: "available",
    entry: { entryId: "entry-project", displayName: "Project alias", repoRoot },
  });
});

test("rejects invalid route identity before reading the Catalog", async () => {
  let reads = 0;
  const result = await resolveProjectEntry({
    entryId: "nested/project",
    readCatalog: async () => {
      reads += 1;
      return { state: "ready", entries: [] };
    },
  });

  expect(result).toEqual({ kind: "invalid-id" });
  expect(reads).toBe(0);
});

test("keeps unknown and known-unavailable entries distinct", async () => {
  const unavailable: CatalogReadResult = {
    state: "ready",
    entries: [
      {
        entryId: "entry-project",
        displayName: "Project alias",
        repoRoot: "/missing/project",
        availability: "missing",
      },
    ],
  };

  expect(
    await resolveProjectEntry({ entryId: "unknown", readCatalog: async () => unavailable }),
  ).toEqual({ kind: "not-found" });
  expect(
    await resolveProjectEntry({ entryId: "entry-project", readCatalog: async () => unavailable }),
  ).toMatchObject({
    kind: "unavailable",
    project: { entryId: "entry-project", displayName: "Project alias", availability: "missing" },
  });
});

test("revalidates the repository manifest after Catalog lookup", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  await writeFile(join(repoRoot, ".bearing/manifest.json"), "{broken\n");

  const result = await resolveProjectEntry({
    entryId: "entry-project",
    readCatalog: async () => readyCatalog(repoRoot),
  });

  expect(result).toMatchObject({
    kind: "unavailable",
    project: { availability: "invalid-manifest" },
    diagnostic: { code: "project-unavailable" },
  });
});

test("rejects unsafe fixed cache targets without reading their contents", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  const cache = join(repoRoot, ".bearing/cache");
  const outside = await makeTemporaryDirectory("bearing-project-entry-");
  await mkdir(cache, { recursive: true });
  await writeFile(join(outside, "outside.json"), "{}\n");
  await symlink(join(outside, "outside.json"), join(cache, "project-snapshot.json"));

  const result = await resolveProjectEntry({
    entryId: "entry-project",
    readCatalog: async () => readyCatalog(repoRoot),
  });

  expect(result).toMatchObject({
    kind: "unavailable",
    diagnostic: { code: "unsafe-project-cache" },
  });
});

test("rejects hard-linked fixed cache targets", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  const cache = join(repoRoot, ".bearing/cache");
  const outside = await makeTemporaryDirectory("bearing-project-entry-hardlink-");
  const outsideFile = join(outside, "outside.json");
  await mkdir(cache, { recursive: true });
  await writeFile(outsideFile, "{}\n");
  await link(outsideFile, join(cache, "sync-receipt.json"));

  const result = await resolveProjectEntry({
    entryId: "entry-project",
    readCatalog: async () => readyCatalog(repoRoot),
  });

  expect(result).toMatchObject({
    kind: "unavailable",
    diagnostic: { code: "unsafe-project-cache" },
  });
});
