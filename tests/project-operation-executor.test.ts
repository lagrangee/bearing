import { expect, test } from "bun:test";
import { realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCatalog } from "../src/catalog/probe";
import { upsertCatalogEntry, withCatalogEntryLease } from "../src/catalog/store";
import { commitProjectCache } from "../src/portal/project-cache-transaction";
import {
  createProjectMaterializer,
  type ProjectMaterializationResult,
} from "../src/portal/project-materializer";
import {
  createProjectService,
  type ProjectOperationExecutorFactory,
} from "../src/portal/project-service";
import { authorizeWritesDirectly } from "../src/portal/project-write-executor";
import { buildProjectSnapshot } from "../src/project-snapshot/projection";
import { runSync } from "../src/sync";
import { commitSyncPlan, prepareSync } from "../src/sync-plan";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

const signal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const catalogFor = (repoRoot: string) => async () => ({
  state: "ready" as const,
  entries: [
    {
      entryId: "entry-project",
      displayName: "Fixture",
      repoRoot,
      availability: "available" as const,
    },
  ],
});

const leasedExecutorFor =
  (
    homeDir: string,
    label: string,
    events: string[],
    attempted?: ReturnType<typeof signal>,
  ): ProjectOperationExecutorFactory =>
  (entry) =>
  async (operation) => {
    attempted?.resolve();
    return withCatalogEntryLease(homeDir, entry.entryId, entry.repoRoot, async () => {
      events.push(`${label}:start`);
      try {
        return await operation(authorizeWritesDirectly);
      } finally {
        events.push(`${label}:end`);
      }
    });
  };

const forcedResult = (baseline: ProjectMaterializationResult): ProjectMaterializationResult => ({
  mode: "force",
  outcome: "no-op",
  reconciliation: "no-op",
  snapshotDisposition: "reused",
  snapshot: baseline.snapshot,
  ...(baseline.receipt === undefined ? {} : { receipt: baseline.receipt }),
});

test("holds one operation executor from input preparation through cache commit", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  await runSync(repoRoot, { completedAt: "2026-07-14T00:00:00.000Z" });
  await writeFile(join(repoRoot, "CONTEXT.md"), "# Changed project context\n");
  const events: string[] = [];
  let insideOperation = false;
  const scoped = async <Result>(
    label: string,
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    expect(insideOperation).toBe(true);
    events.push(label);
    return operation();
  };
  const materializer = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: {
      prepare: (root) => scoped("prepare", () => prepareSync(root)),
      buildSnapshot: (input) => scoped("build", () => buildProjectSnapshot(input)),
      commit: (plan) => scoped("sync", () => commitSyncPlan(plan)),
      commitCache: (input) => scoped("cache", () => commitProjectCache(input)),
    },
  });
  const service = createProjectService({
    readCatalog: catalogFor(repoRoot),
    packageVersion: "0.0.0-test",
    materializer,
    operationExecutorFor: () => async (operation) => {
      events.push("operation:start");
      insideOperation = true;
      try {
        return await operation(authorizeWritesDirectly);
      } finally {
        insideOperation = false;
        events.push("operation:end");
      }
    },
  });

  expect(await service.sync("entry-project", "force")).toMatchObject({
    kind: "completed",
    mode: "force",
  });
  expect(events.at(0)).toBe("operation:start");
  expect(events.at(-1)).toBe("operation:end");
  expect(events.indexOf("prepare")).toBeGreaterThan(events.indexOf("operation:start"));
  expect(events.indexOf("build")).toBeGreaterThan(events.indexOf("prepare"));
  expect(events.indexOf("sync")).toBeGreaterThan(events.indexOf("build"));
  expect(events.indexOf("cache")).toBeGreaterThan(events.indexOf("sync"));
});

test("serializes independent services so each commits its captured generation in lease order", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await realpath(await createValidBearingRepo());
  await upsertCatalogEntry({
    homeDir,
    repoRoot,
    createEntryId: () => "entry-project",
  });
  await runSync(repoRoot, { completedAt: "2026-07-14T00:00:00.000Z" });
  await writeFile(join(repoRoot, "CONTEXT.md"), "# Older planned context\n");
  const olderPrepared = signal();
  const releaseOlder = signal();
  const newerAttempted = signal();
  const events: string[] = [];
  let firstPrepare = true;
  const olderMaterializer = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: {
      prepare: async (root) => {
        const plan = await prepareSync(root);
        if (firstPrepare) {
          firstPrepare = false;
          events.push("older:prepared");
          olderPrepared.resolve();
          await releaseOlder.promise;
        }
        return plan;
      },
    },
  });
  const readHomeCatalog = () => readCatalog({ homeDir });
  const olderService = createProjectService({
    readCatalog: readHomeCatalog,
    packageVersion: "0.0.0-test",
    materializer: olderMaterializer,
    operationExecutorFor: leasedExecutorFor(homeDir, "older", events),
  });
  const newerService = createProjectService({
    readCatalog: readHomeCatalog,
    packageVersion: "0.0.0-test",
    operationExecutorFor: leasedExecutorFor(homeDir, "newer", events, newerAttempted),
  });

  const older = olderService.sync("entry-project", "force");
  await olderPrepared.promise;
  const newer = newerService.sync("entry-project", "force");
  await newerAttempted.promise;
  await writeFile(join(repoRoot, "CONTEXT.md"), "# Newer current context\n");
  releaseOlder.resolve();
  const [olderResult, newerResult] = await Promise.all([older, newer]);

  expect(olderResult).toMatchObject({ kind: "completed", mode: "force" });
  expect(newerResult).toMatchObject({ kind: "completed", mode: "force" });
  expect(events.indexOf("older:end")).toBeLessThan(events.indexOf("newer:start"));
  expect((await prepareSync(repoRoot)).changed).toBe(false);
});

test("allows independent services for different entries to enter concurrently", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const firstRoot = await realpath(await createValidBearingRepo());
  const secondRoot = await realpath(await createValidBearingRepo());
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
  await runSync(firstRoot, { completedAt: "2026-07-14T00:00:00.000Z" });
  const baseline = await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(
    firstRoot,
    "ensure-current",
  );
  const bothEntered = signal();
  const events: string[] = [];
  let entered = 0;
  const materializerFor = (label: string) => ({
    run: async () => {
      events.push(`${label}:run`);
      entered += 1;
      if (entered === 2) bothEntered.resolve();
      await bothEntered.promise;
      return forcedResult(baseline);
    },
  });
  const readHomeCatalog = () => readCatalog({ homeDir });
  const firstService = createProjectService({
    readCatalog: readHomeCatalog,
    packageVersion: "0.0.0-test",
    materializer: materializerFor("first"),
    operationExecutorFor: leasedExecutorFor(homeDir, "first", events),
  });
  const secondService = createProjectService({
    readCatalog: readHomeCatalog,
    packageVersion: "0.0.0-test",
    materializer: materializerFor("second"),
    operationExecutorFor: leasedExecutorFor(homeDir, "second", events),
  });

  const [first, second] = await Promise.all([
    firstService.sync("entry-first", "force"),
    secondService.sync("entry-second", "force"),
  ]);

  expect(first).toMatchObject({ kind: "completed", mode: "force" });
  expect(second).toMatchObject({ kind: "completed", mode: "force" });
  expect(events).toContain("first:run");
  expect(events).toContain("second:run");
});
