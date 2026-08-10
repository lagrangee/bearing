import { expect, test } from "bun:test";
import { realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogReadResult } from "../src/portal/contract";
import { resolveProjectEntry } from "../src/portal/project-entry";
import { createValidBearingRepo } from "./helpers";

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

test("resolves a trustworthy entry retained by a degraded Catalog observation", async () => {
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
        message: "Project Catalog is degraded; only previously trusted entries are shown.",
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
