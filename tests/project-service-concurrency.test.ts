import { expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import {
  createProjectMaterializer,
  type ProjectMaterializationResult,
} from "../src/portal/project-materializer";
import { createProjectService } from "../src/portal/project-service";
import { writeProjectSnapshotCache } from "../src/project-snapshot/cache";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { runSync } from "../src/sync";
import { createValidBearingRepo } from "./helpers";

const deferred = <Value>() => {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value: Value) => resolvePromise?.(value) };
};
const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const catalogFor = (repoRoot: string) => async () => ({
  state: "ready" as const,
  entries: [
    {
      entryId: "project-1",
      displayName: "Fixture",
      repoRoot,
      availability: "available" as const,
    },
  ],
});

const forcedResult = (
  baseline: ProjectMaterializationResult,
  snapshot = baseline.snapshot,
): ProjectMaterializationResult => ({
  mode: "force",
  outcome: "no-op",
  reconciliation: "no-op",
  snapshotDisposition: "reused",
  snapshot,
  ...(baseline.receipt === undefined ? {} : { receipt: baseline.receipt }),
});

test("maps an automatic caller joining active force back to automatic outcome taxonomy", async () => {
  const root = await realpath(await createValidBearingRepo());
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const baseline = await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(
    root,
    "ensure-current",
  );
  const pending = deferred<ProjectMaterializationResult>();
  const started = deferred<void>();
  let materializerCalls = 0;
  const available = () => ({
    kind: "available" as const,
    entry: { entryId: "project-1", displayName: "Fixture", repoRoot: root },
  });
  const service = createProjectService({
    readCatalog: catalogFor(root),
    packageVersion: "0.0.0-test",
    entryResolver: {
      resolve: async () => available(),
      resolveWithLocator: async () => ({ result: available(), locatorRevision: root }),
    },
    materializer: {
      run: async () => {
        materializerCalls += 1;
        started.resolve();
        return pending.promise;
      },
    },
  });

  const forced = service.sync("project-1", "force");
  await started.promise;
  const automatic = service.sync("project-1", "ensure-current");
  await nextTurn();
  pending.resolve(forcedResult(baseline));

  expect(await forced).toMatchObject({ kind: "completed", mode: "force", outcome: "no-op" });
  expect(await automatic).toMatchObject({
    kind: "completed",
    mode: "ensure-current",
    outcome: "synced",
    reconciliation: "no-op",
  });
  expect(materializerCalls).toBe(1);
});

const renamedSnapshot = (snapshot: ProjectSnapshot, title = "Later Snapshot"): ProjectSnapshot => {
  if (snapshot.summary.validity !== "available") throw new Error("Expected Summary fixture.");
  return projectSnapshotSchema.parse({
    ...snapshot,
    summary: {
      validity: "available",
      value: { ...snapshot.summary.value, title },
    },
  });
};

test("composes each response from its immutable operation result before releasing single-flight", async () => {
  const root = await realpath(await createValidBearingRepo());
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const baseline = await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(
    root,
    "ensure-current",
  );
  const later = renamedSnapshot(baseline.snapshot);
  const first = deferred<ProjectMaterializationResult>();
  const firstStarted = deferred<void>();
  const second = deferred<ProjectMaterializationResult>();
  const secondStarted = deferred<void>();
  let calls = 0;
  const service = createProjectService({
    readCatalog: catalogFor(root),
    packageVersion: "0.0.0-test",
    materializer: {
      run: async () => {
        calls += 1;
        if (calls === 1) {
          firstStarted.resolve();
          return first.promise;
        }
        await writeProjectSnapshotCache(root, later);
        secondStarted.resolve();
        return second.promise;
      },
    },
  });

  const checking = service.sync("project-1", "ensure-current");
  await firstStarted.promise;
  const forcing = service.sync("project-1", "force");
  first.resolve({
    mode: "ensure-current",
    outcome: "checked",
    snapshotDisposition: "reused",
    snapshot: baseline.snapshot,
    ...(baseline.receipt === undefined ? {} : { receipt: baseline.receipt }),
  });
  await secondStarted.promise;

  const checked = await checking;
  expect(checked).toMatchObject({
    kind: "completed",
    outcome: "checked",
    view: {
      cache: {
        snapshot: {
          state: "available",
          snapshot: { summary: { value: { title: "Test Project" } } },
        },
      },
    },
  });
  second.resolve(forcedResult(baseline, later));
  expect(await forcing).toMatchObject({
    kind: "completed",
    view: {
      cache: { snapshot: { snapshot: { summary: { value: { title: "Later Snapshot" } } } } },
    },
  });
});

test("fails an in-flight request after relink while a queued force starts on the new locator", async () => {
  const originalRoot = await realpath(await createValidBearingRepo());
  const queuedRoot = await realpath(await createValidBearingRepo());
  const currentRoot = await realpath(await createValidBearingRepo());
  await runSync(originalRoot, { completedAt: "2026-07-13T12:00:00.000Z" });
  const baseline = await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(
    originalRoot,
    "ensure-current",
  );
  const queuedSnapshot = renamedSnapshot(baseline.snapshot, "Queued Snapshot");
  const currentSnapshot = renamedSnapshot(baseline.snapshot, "Current Snapshot");
  const original = deferred<ProjectMaterializationResult>();
  const originalStarted = deferred<void>();
  let catalogRoot = originalRoot;
  const queuedRead = deferred<void>();
  const materializedRoots: string[] = [];
  const service = createProjectService({
    readCatalog: async () => {
      const observedRoot = catalogRoot;
      if (observedRoot === queuedRoot) queuedRead.resolve();
      return catalogFor(observedRoot)();
    },
    packageVersion: "0.0.0-test",
    materializer: {
      run: async (repoRoot) => {
        materializedRoots.push(repoRoot);
        if (repoRoot === originalRoot) {
          originalStarted.resolve();
          return original.promise;
        }
        if (repoRoot === currentRoot) {
          return forcedResult(baseline, currentSnapshot);
        }
        return forcedResult(baseline, queuedSnapshot);
      },
    },
  });

  const checking = service.sync("project-1", "ensure-current");
  await originalStarted.promise;
  catalogRoot = queuedRoot;
  const forcing = service.sync("project-1", "force");
  await queuedRead.promise;
  await nextTurn();

  expect(materializedRoots).toEqual([originalRoot]);
  catalogRoot = currentRoot;
  original.resolve({
    mode: "ensure-current",
    outcome: "checked",
    snapshotDisposition: "reused",
    snapshot: baseline.snapshot,
    ...(baseline.receipt === undefined ? {} : { receipt: baseline.receipt }),
  });
  const checked = await checking;
  const forced = await forcing;

  expect(checked).toMatchObject({
    kind: "failed",
    mode: "ensure-current",
    outcome: "failed",
    error: {
      code: "input-validation-failed",
      message:
        "The registered project location changed while this operation was in flight. Retry against the current repository.",
    },
  });
  expect(materializedRoots).toEqual([originalRoot, currentRoot]);
  expect(forced).toMatchObject({
    kind: "completed",
    mode: "force",
    view: {
      cache: { snapshot: { snapshot: { summary: { value: { title: "Current Snapshot" } } } } },
    },
  });
});
