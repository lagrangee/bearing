import { expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { readProjectSnapshotCache } from "../src/project-snapshot/cache";
import { runSync } from "../src/sync";
import { prepareSync } from "../src/sync-plan";
import { createValidBearingRepo, writeFixture } from "./helpers";

const snapshotPath = (root: string) => join(root, ".bearing/cache/project-snapshot.json");
const receiptPath = (root: string) => join(root, ".bearing/cache/sync-receipt.json");
const reportPath = (root: string) => join(root, ".bearing/cache/sync-report.md");
const sitemapPath = (root: string) => join(root, ".bearing/cache/project-sitemap.md");
const deferred = <Value>() => {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value: Value): void => resolvePromise?.(value) };
};

test("materializes a lagging Snapshot without fabricating a Sync Receipt", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const priorReceipt = await readFile(receiptPath(root));
  const materializer = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    now: () => "2026-07-13T12:01:00.000Z",
  });
  const result = await materializer.run(root, "ensure-current");
  expect(result).toMatchObject({
    mode: "ensure-current",
    outcome: "materialized",
    snapshotDisposition: "materialized",
  });
  expect(await readFile(receiptPath(root))).toEqual(priorReceipt);
  expect((await readProjectSnapshotCache(root)).kind).toBe("available");

  const priorSnapshot = await readFile(snapshotPath(root));
  const checked = await materializer.run(root, "ensure-current");
  expect(checked).toMatchObject({ outcome: "checked", snapshotDisposition: "reused" });
  expect(await readFile(snapshotPath(root))).toEqual(priorSnapshot);
  expect(await readFile(receiptPath(root))).toEqual(priorReceipt);
});

test("dirty ensure reconciles, materializes, and updates the Receipt", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const materializer = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    now: () => "2026-07-13T12:02:00.000Z",
  });
  await materializer.run(root, "ensure-current");
  await writeFixture(root, "CONTEXT.md", "# Changed context\n");
  const result = await materializer.run(root, "ensure-current");
  expect(result).toMatchObject({
    mode: "ensure-current",
    outcome: "synced",
    reconciliation: "applied",
    snapshotDisposition: "materialized",
    receipt: { completedAt: "2026-07-13T12:02:00.000Z" },
  });
  if (result.receipt === undefined) throw new Error("Expected Sync Receipt.");
  expect(result.receipt.sitemap.fingerprint).toBe(result.snapshot.basis.sitemapFingerprint);
});

test("force bypass semantics run a no-op Sync and can reuse current Snapshot", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const materializer = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    now: () => "2026-07-13T12:03:00.000Z",
  });
  await materializer.run(root, "ensure-current");
  const priorSnapshot = await readFile(snapshotPath(root));
  const result = await materializer.run(root, "force");
  expect(result).toMatchObject({
    mode: "force",
    outcome: "no-op",
    reconciliation: "no-op",
    snapshotDisposition: "reused",
    receipt: { completedAt: "2026-07-13T12:03:00.000Z" },
  });
  expect(await readFile(snapshotPath(root))).toEqual(priorSnapshot);
});

test("projection failure preserves prior Snapshot and Receipt", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const baseline = createProjectMaterializer({ packageVersion: "0.0.0-test" });
  await baseline.run(root, "ensure-current");
  const priorSnapshot = await readFile(snapshotPath(root));
  const priorReceipt = await readFile(receiptPath(root));
  await writeFixture(root, "CONTEXT.md", "# Dirty\n");
  const failing = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: {
      buildSnapshot: async () => Promise.reject(new Error("injected projection failure")),
    },
  });
  await expect(failing.run(root, "ensure-current")).rejects.toMatchObject({
    code: "snapshot-materialization-failed",
  });
  expect(await readFile(snapshotPath(root))).toEqual(priorSnapshot);
  expect(await readFile(receiptPath(root))).toEqual(priorReceipt);
});

test("write authorization denial prevents Snapshot-only cache materialization", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const priorReceipt = await readFile(receiptPath(root));
  let authorizations = 0;
  const materializer = createProjectMaterializer({ packageVersion: "0.0.0-test" });

  await expect(
    materializer.run(root, "ensure-current", async () => {
      authorizations += 1;
      throw new Error("entry authorization changed");
    }),
  ).rejects.toMatchObject({ code: "input-validation-failed" });

  expect(authorizations).toBe(1);
  await expect(access(snapshotPath(root))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(receiptPath(root))).toEqual(priorReceipt);
});

test("write authorization denial prevents dirty Sync outputs from changing", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const materializer = createProjectMaterializer({ packageVersion: "0.0.0-test" });
  await materializer.run(root, "ensure-current");
  const targets = [reportPath(root), sitemapPath(root), snapshotPath(root), receiptPath(root)];
  const prior = await Promise.all(targets.map((target) => readFile(target)));
  await writeFixture(root, "CONTEXT.md", "# Changed but not authorized\n");
  const phases: string[] = [];

  await expect(
    materializer.run(root, "ensure-current", (phase) => {
      phases.push(phase);
      throw new Error("entry authorization changed");
    }),
  ).rejects.toMatchObject({ code: "input-validation-failed" });

  expect(phases).toEqual(["sync"]);
  expect(await Promise.all(targets.map((target) => readFile(target)))).toEqual(prior);
});

test("reauthorizes before cache commit and preserves prior Snapshot and Receipt on denial", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const materializer = createProjectMaterializer({ packageVersion: "0.0.0-test" });
  await materializer.run(root, "ensure-current");
  const priorSnapshot = await readFile(snapshotPath(root));
  const priorReceipt = await readFile(receiptPath(root));
  const priorSitemap = await readFile(sitemapPath(root));
  await writeFixture(root, "CONTEXT.md", "# Authorized Sync only\n");
  const phases: string[] = [];

  await expect(
    materializer.run(root, "ensure-current", async (phase, operation) => {
      phases.push(phase);
      if (phase === "cache") throw new Error("entry authorization changed");
      return operation();
    }),
  ).rejects.toMatchObject({ code: "input-validation-failed" });

  expect(phases).toEqual(["sync", "cache"]);
  expect(await readFile(sitemapPath(root))).not.toEqual(priorSitemap);
  expect(await readFile(snapshotPath(root))).toEqual(priorSnapshot);
  expect(await readFile(receiptPath(root))).toEqual(priorReceipt);
});

test("isolates a stale Receipt on the first successful cache-materialization retry", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const materializer = createProjectMaterializer({ packageVersion: "0.0.0-test" });
  await materializer.run(root, "ensure-current");
  const priorReceipt = await readFile(receiptPath(root));
  await writeFixture(root, "CONTEXT.md", "# Authorized Sync only\n");

  await expect(
    materializer.run(root, "ensure-current", async (phase, operation) => {
      if (phase === "cache") throw new Error("entry authorization changed");
      return operation();
    }),
  ).rejects.toMatchObject({ code: "input-validation-failed" });

  const retry = await materializer.run(root, "ensure-current");
  expect(retry).toMatchObject({ outcome: "materialized", snapshotDisposition: "materialized" });
  expect(retry.receipt).toBeUndefined();
  expect(await readFile(receiptPath(root))).toEqual(priorReceipt);
});

test("write executor wraps the physical Sync and cache commits", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const materializer = createProjectMaterializer({ packageVersion: "0.0.0-test" });
  await materializer.run(root, "ensure-current");
  await writeFixture(root, "CONTEXT.md", "# Executor-wrapped change\n");
  const events: string[] = [];

  await materializer.run(root, "ensure-current", async (phase, operation) => {
    events.push(`before-${phase}`);
    const result = await operation();
    events.push(`after-${phase}`);
    return result;
  });

  expect(events).toEqual(["before-sync", "after-sync", "before-cache", "after-cache"]);
});

test("write executor preserves commit and cache exception taxonomy", async () => {
  const syncRoot = await createValidBearingRepo();
  await runSync(syncRoot, { completedAt: "2026-07-13T12:00:00.000Z" });
  await writeFixture(syncRoot, "CONTEXT.md", "# Dirty sync\n");
  const failingSync = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: { commit: async () => Promise.reject(new Error("commit failed")) },
  });
  const execute = async (_phase: string, operation: () => Promise<unknown>) => operation();

  await expect(failingSync.run(syncRoot, "ensure-current", execute)).rejects.toMatchObject({
    code: "sync-failed",
  });

  const cacheRoot = await createValidBearingRepo();
  await runSync(cacheRoot, { completedAt: "2026-07-13T12:00:00.000Z" });
  const failingCache = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: { commitCache: async () => Promise.reject(new Error("cache failed")) },
  });
  await expect(failingCache.run(cacheRoot, "ensure-current", execute)).rejects.toMatchObject({
    code: "snapshot-write-failed",
  });
});

const cacheOutputs = (root: string): string[] => [
  reportPath(root),
  sitemapPath(root),
  snapshotPath(root),
  receiptPath(root),
];

test("commits an older coherent Sync generation and leaves later edits for the next Sync", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(root, "ensure-current");
  await writeFixture(root, "CONTEXT.md", "# Generation A\n");
  const leaseRequested = deferred<void>();
  const acquireLease = deferred<void>();
  const older = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    now: () => "2026-07-13T12:01:00.000Z",
  }).run(root, "ensure-current", async (phase, operation) => {
    if (phase === "sync") {
      leaseRequested.resolve();
      await acquireLease.promise;
    }
    return operation();
  });
  await leaseRequested.promise;

  await writeFixture(root, "CONTEXT.md", "# Generation B\n");
  await createProjectMaterializer({
    packageVersion: "0.0.0-test",
    now: () => "2026-07-13T12:02:00.000Z",
  }).run(root, "ensure-current", async (_phase, operation) => operation());
  const newerOutputs = await Promise.all(cacheOutputs(root).map((target) => readFile(target)));
  acquireLease.resolve();

  await expect(older).resolves.toMatchObject({ mode: "ensure-current", outcome: "synced" });
  expect(await Promise.all(cacheOutputs(root).map((target) => readFile(target)))).not.toEqual(
    newerOutputs,
  );
  expect((await prepareSync(root)).changed).toBe(true);
});

test("commits one captured Snapshot and Receipt pair while a later edit waits for the next Sync", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const leaseRequested = deferred<void>();
  const acquireLease = deferred<void>();
  const older = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    now: () => "2026-07-13T12:01:00.000Z",
  }).run(root, "ensure-current", async (phase, operation) => {
    if (phase === "cache") {
      leaseRequested.resolve();
      await acquireLease.promise;
    }
    return operation();
  });
  await leaseRequested.promise;

  await writeFixture(root, "CONTEXT.md", "# Newer generation\n");
  await createProjectMaterializer({
    packageVersion: "0.0.0-test",
    now: () => "2026-07-13T12:02:00.000Z",
  }).run(root, "ensure-current", async (_phase, operation) => operation());
  const newerOutputs = await Promise.all(cacheOutputs(root).map((target) => readFile(target)));
  acquireLease.resolve();

  await expect(older).resolves.toMatchObject({
    mode: "ensure-current",
    outcome: "materialized",
  });
  expect(await Promise.all(cacheOutputs(root).map((target) => readFile(target)))).not.toEqual(
    newerOutputs,
  );
  const current = await prepareSync(root);
  expect(current.changed).toBe(false);
  expect((await readProjectSnapshotCache(root, current.fingerprint)).kind).toBe("behind");
});
