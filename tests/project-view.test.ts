import { expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import {
  ProjectViewConsistencyError,
  readProjectRepoView,
  readProjectView,
} from "../src/portal/project-view";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

const entry = (repoRoot: string) => ({
  entryId: "project-1",
  displayName: "Fixture",
  repoRoot,
});
const sitemapGeneration = (fingerprint: string) => ({
  kind: "available" as const,
  envelope: {
    type: "project-sitemap" as const,
    version: 1 as const,
    inputs: [],
    inputFingerprint: fingerprint,
    advisoryFreshness: {},
  },
});
const runInitialSync = (root: string, completedAt: string) =>
  runSync(root, {
    completedAt,
    providerObservationIntent: "initial-baseline",
  });

test("composes Catalog identity, Snapshot cache, and Receipt without exposing repo root", async () => {
  const root = await createValidBearingRepo();
  await runInitialSync(root, "2026-07-13T12:00:00.000Z");
  const missing = await readProjectView(entry(root));
  expect(missing.cache.snapshot).toEqual({ state: "missing" });
  expect(missing.cache.receipt?.completedAt).toBe("2026-07-13T12:00:00.000Z");

  const materializer = createProjectMaterializer({ packageVersion: "0.0.0-test" });
  await materializer.run(root, "ensure-current");
  const ready = await readProjectView(entry(root), false, "0.0.0-test");
  expect(ready.cache.snapshot.state).toBe("available");
  expect(ready.diagnosticCounts).toEqual({ blocking: 0, nonBlocking: 0, total: 0 });
  expect(JSON.stringify(ready)).not.toContain(root);
  expect(JSON.stringify(ready)).not.toContain("repoRoot");
});

test("keeps a trustworthy behind Snapshot and isolates a malformed Receipt", async () => {
  const root = await createValidBearingRepo();
  await runInitialSync(root, "2026-07-13T12:00:00.000Z");
  const materializer = createProjectMaterializer({ packageVersion: "0.0.0-test" });
  await materializer.run(root, "ensure-current");
  await writeFixture(root, "CONTEXT.md", "# Changed\n");
  await runSync(root, { completedAt: "2026-07-13T12:01:00.000Z" });
  await writeFile(join(root, ".bearing/cache/sync-receipt.json"), "not json\n");
  const view = await readProjectView(entry(root), true, "0.0.0-test");
  expect(view.cache.snapshot.state).toBe("behind");
  expect(view.cache.receipt).toBeNull();
  expect(view.cache.retained).toBe(true);
});

test("reports a producer package mismatch without trusting cached Snapshot content", async () => {
  const root = await createValidBearingRepo();
  await runInitialSync(root, "2026-07-13T12:00:00.000Z");
  await createProjectMaterializer({ packageVersion: "0.0.0-old" }).run(root, "ensure-current");

  const view = await readProjectView(entry(root), true, "0.0.0-current");

  expect(view.cache.snapshot).toEqual({
    state: "version-mismatch",
    diagnostic: {
      code: "snapshot-version-mismatch",
      message: "The cached Project Snapshot version is not supported by this Host.",
    },
  });
  expect(view.cache.retained).toBe(false);
  expect(view.diagnosticCounts).toBeNull();
});

test("marks failure cache as retained only when it contains a trustworthy Snapshot", async () => {
  const root = await createValidBearingRepo();
  const missing = await readProjectView(entry(root), true, "0.0.0-current");
  expect(missing.cache).toMatchObject({ snapshot: { state: "missing" }, retained: false });

  await runInitialSync(root, "2026-07-13T12:00:00.000Z");
  await writeFile(join(root, ".bearing/cache/project-snapshot.json"), "{broken\n", "utf8");
  const malformed = await readProjectView(entry(root), true, "0.0.0-current");

  expect(malformed.cache).toMatchObject({
    snapshot: { state: "malformed" },
    retained: false,
  });
});

test("keeps a trustworthy behind Snapshot while isolating a newer Sync Receipt", async () => {
  const root = await createValidBearingRepo();
  try {
    const first = await runInitialSync(root, "2026-07-13T12:00:00.000Z");
    await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(root, "ensure-current");
    await writeFixture(root, "CONTEXT.md", "# New generation\n");
    await runSync(root, { completedAt: "2026-07-13T12:01:00.000Z" });
    const view = await readProjectRepoView(root, false, "0.0.0-test");

    expect(view.cache.snapshot.state).toBe("behind");
    if (view.cache.snapshot.state !== "behind") throw new Error("Expected a behind Snapshot.");
    expect(String(view.cache.snapshot.snapshot.basis.sitemapFingerprint)).toBe(first.fingerprint);
    expect(view.cache.receipt).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retries one Sitemap generation change and returns only the revalidated view", async () => {
  const first = sitemapGeneration(`sha256:${"a".repeat(64)}`);
  const current = sitemapGeneration(`sha256:${"b".repeat(64)}`);
  const sequence = [first, current, current, current] as const;
  let sitemapReads = 0;
  let snapshotReads = 0;
  let receiptReads = 0;

  const view = await readProjectRepoView("/not-read", false, "0.0.0-test", {
    readSitemap: async () => sequence[sitemapReads++] ?? current,
    readSnapshot: async () => {
      snapshotReads += 1;
      return { kind: "missing" };
    },
    readReceipt: async () => {
      receiptReads += 1;
      return { kind: "missing" };
    },
  });

  expect(view.cache).toEqual({ snapshot: { state: "missing" }, receipt: null, retained: false });
  expect({ sitemapReads, snapshotReads, receiptReads }).toEqual({
    sitemapReads: 4,
    snapshotReads: 2,
    receiptReads: 2,
  });
});

test("fails after bounded retries when the Sitemap keeps changing", async () => {
  const first = sitemapGeneration(`sha256:${"a".repeat(64)}`);
  const second = sitemapGeneration(`sha256:${"b".repeat(64)}`);
  let sitemapReads = 0;
  const readers = {
    readSitemap: async () => (sitemapReads++ % 2 === 0 ? first : second),
    readSnapshot: async () => ({ kind: "missing" as const }),
    readReceipt: async () => ({ kind: "missing" as const }),
  };

  await expect(
    readProjectRepoView("/not-read", false, "0.0.0-test", readers),
  ).rejects.toBeInstanceOf(ProjectViewConsistencyError);
  expect(sitemapReads).toBe(4);
});
