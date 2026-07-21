import { expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import type { CatalogReadResult } from "../src/portal/contract";
import type { ProjectOperationMode } from "../src/portal/project-coordinator";
import {
  createProjectMaterializer,
  type ProjectMaterializationResult,
} from "../src/portal/project-materializer";
import { createProjectService } from "../src/portal/project-service";
import { runSync } from "../src/sync";
import { createValidBearingRepo } from "./helpers";

const deferred = <Value>() => {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value: Value): void => resolvePromise?.(value) };
};
const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const catalogFor = (repoRoot: string, displayName = "Fixture"): CatalogReadResult => ({
  state: "ready",
  entries: [
    {
      entryId: "project-1",
      displayName,
      repoRoot,
      availability: "available",
    },
  ],
});

const automaticResult = (baseline: ProjectMaterializationResult): ProjectMaterializationResult => ({
  mode: "ensure-current",
  outcome: "checked",
  snapshotDisposition: "reused",
  snapshot: baseline.snapshot,
  ...(baseline.receipt === undefined ? {} : { receipt: baseline.receipt }),
});

const forcedResult = (baseline: ProjectMaterializationResult): ProjectMaterializationResult => ({
  mode: "force",
  outcome: "no-op",
  reconciliation: "no-op",
  snapshotDisposition: "reused",
  snapshot: baseline.snapshot,
  ...(baseline.receipt === undefined ? {} : { receipt: baseline.receipt }),
});

const baselineFor = async (repoRoot: string): Promise<ProjectMaterializationResult> => {
  await runSync(repoRoot, { completedAt: "2026-07-13T12:00:00.000Z" });
  return createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(
    repoRoot,
    "ensure-current",
  );
};

const joinedRootChangeCases = [
  {
    name: "active ensure and joined ensure",
    activeMode: "ensure-current",
    joinedMode: "ensure-current",
    complete: automaticResult,
    activeKind: "completed",
  },
  {
    name: "active force and joined ensure",
    activeMode: "force",
    joinedMode: "ensure-current",
    complete: forcedResult,
    activeKind: "completed",
  },
  {
    name: "active force and joined force",
    activeMode: "force",
    joinedMode: "force",
    complete: forcedResult,
    activeKind: "completed",
  },
] as const;

for (const scenario of joinedRootChangeCases) {
  test(`handles ${scenario.name} after relink without returning an old-root view`, async () => {
    const originalRoot = await realpath(await createValidBearingRepo());
    const currentRoot = await realpath(await createValidBearingRepo());
    const baseline = await baselineFor(originalRoot);
    const pending = deferred<ProjectMaterializationResult>();
    const started = deferred<void>();
    let catalogRoot = originalRoot;
    const currentRead = deferred<void>();
    const materializations: Array<{
      repoRoot: string;
      mode: ProjectOperationMode;
    }> = [];
    const service = createProjectService({
      readCatalog: async () => {
        const observedRoot = catalogRoot;
        if (observedRoot === currentRoot) currentRead.resolve();
        return catalogFor(observedRoot);
      },
      packageVersion: "0.0.0-test",
      materializer: {
        run: async (repoRoot, mode) => {
          materializations.push({ repoRoot, mode });
          started.resolve();
          return materializations.length === 1 ? pending.promise : forcedResult(baseline);
        },
      },
    });

    const active = service.sync("project-1", scenario.activeMode);
    await started.promise;
    catalogRoot = currentRoot;
    const joined = service.sync("project-1", scenario.joinedMode);
    await currentRead.promise;
    await nextTurn();
    pending.resolve(scenario.complete(baseline));

    const [activeResult, joinedResult] = await Promise.all([active, joined]);
    expect(materializations).toEqual([
      { repoRoot: originalRoot, mode: scenario.activeMode },
      { repoRoot: currentRoot, mode: "force" },
    ]);
    expect(activeResult).toMatchObject({ kind: scenario.activeKind });
    expect(joinedResult).toMatchObject({
      kind: "completed",
      mode: scenario.joinedMode,
      view: { cache: { snapshot: { state: "available" }, retained: false } },
    });
  });
}

test("returns the latest typed entry failure when a joined operation loses availability", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  const baseline = await baselineFor(repoRoot);
  const pending = deferred<ProjectMaterializationResult>();
  const started = deferred<void>();
  let catalog = catalogFor(repoRoot);
  let observeJoinedRead = false;
  const joinedRead = deferred<void>();
  const service = createProjectService({
    readCatalog: async () => {
      const observed = catalog;
      if (observeJoinedRead) {
        observeJoinedRead = false;
        joinedRead.resolve();
      }
      return observed;
    },
    packageVersion: "0.0.0-test",
    materializer: {
      run: async () => {
        started.resolve();
        return pending.promise;
      },
    },
  });

  const active = service.sync("project-1", "force");
  await started.promise;
  observeJoinedRead = true;
  const joined = service.sync("project-1", "ensure-current");
  await joinedRead.promise;
  await nextTurn();
  catalog = {
    state: "ready",
    entries: [
      {
        entryId: "project-1",
        displayName: "Fixture",
        repoRoot,
        availability: "missing",
      },
    ],
  };
  pending.resolve(forcedResult(baseline));

  const [, joinedResult] = await Promise.all([active, joined]);
  expect(joinedResult).toMatchObject({
    kind: "unavailable",
    project: { entryId: "project-1", availability: "missing" },
    diagnostic: { code: "project-unavailable" },
  });
  expect(joinedResult).not.toHaveProperty("view");
});

test("composes a joined response with the latest alias when the repository root is unchanged", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  const baseline = await baselineFor(repoRoot);
  const pending = deferred<ProjectMaterializationResult>();
  const started = deferred<void>();
  let displayName = "Original alias";
  let observeJoinedRead = false;
  const renamedRead = deferred<void>();
  let materializerCalls = 0;
  const available = () => ({
    kind: "available" as const,
    entry: { entryId: "project-1", displayName, repoRoot },
  });
  const service = createProjectService({
    readCatalog: async () => catalogFor(repoRoot, displayName),
    packageVersion: "0.0.0-test",
    entryResolver: {
      resolve: async () => {
        if (observeJoinedRead && displayName === "Renamed alias") {
          observeJoinedRead = false;
          renamedRead.resolve();
        }
        return available();
      },
      resolveWithLocator: async () => ({ result: available(), locatorRevision: repoRoot }),
    },
    materializer: {
      run: async () => {
        materializerCalls += 1;
        started.resolve();
        return pending.promise;
      },
    },
  });

  const active = service.sync("project-1", "force");
  await started.promise;
  displayName = "Renamed alias";
  observeJoinedRead = true;
  const joined = service.sync("project-1", "ensure-current");
  await renamedRead.promise;
  await nextTurn();
  pending.resolve(forcedResult(baseline));

  const [, joinedResult] = await Promise.all([active, joined]);
  expect(joinedResult).toMatchObject({
    kind: "completed",
    mode: "ensure-current",
    outcome: "synced",
    view: { project: { displayName: "Renamed alias" } },
  });
  expect(materializerCalls).toBe(1);
});

test("does not reuse an old force after a failed intermediate location", async () => {
  const originalRoot = await realpath(await createValidBearingRepo());
  const intermediateRoot = await realpath(await createValidBearingRepo());
  const baseline = await baselineFor(originalRoot);
  let catalogRoot = originalRoot;
  const materializations: Array<{ repoRoot: string; mode: ProjectOperationMode }> = [];
  const service = createProjectService({
    readCatalog: async () => catalogFor(catalogRoot),
    packageVersion: "0.0.0-test",
    materializer: {
      run: async (repoRoot, mode) => {
        materializations.push({ repoRoot, mode });
        if (repoRoot === intermediateRoot) throw new Error("Intermediate repository failed.");
        return forcedResult(baseline);
      },
    },
  });

  expect(await service.sync("project-1", "force")).toMatchObject({ kind: "completed" });
  catalogRoot = intermediateRoot;
  expect(await service.sync("project-1", "force")).toMatchObject({ kind: "failed" });
  catalogRoot = originalRoot;

  expect(await service.sync("project-1", "ensure-current")).toMatchObject({
    kind: "completed",
    mode: "ensure-current",
  });
  expect(materializations).toEqual([
    { repoRoot: originalRoot, mode: "force" },
    { repoRoot: intermediateRoot, mode: "force" },
    { repoRoot: originalRoot, mode: "force" },
  ]);
});

test("fails against the current root instead of replaying a transient recovery failure", async () => {
  const originalRoot = await realpath(await createValidBearingRepo());
  const intermediateRoot = await realpath(await createValidBearingRepo());
  const currentRoot = await realpath(await createValidBearingRepo());
  const baseline = await baselineFor(originalRoot);
  let reads = 0;
  const service = createProjectService({
    readCatalog: async () => {
      reads += 1;
      if (reads <= 2) return catalogFor(originalRoot);
      if (reads === 3) return catalogFor(intermediateRoot);
      if (reads === 4) return { state: "ready", entries: [] };
      return catalogFor(currentRoot, "Current fixture");
    },
    packageVersion: "0.0.0-test",
    materializer: { run: async () => automaticResult(baseline) },
  });

  const result = await service.sync("project-1", "ensure-current");

  expect(result).toMatchObject({
    kind: "failed",
    error: { code: "input-validation-failed" },
    view: { project: { displayName: "Current fixture" } },
  });
  expect(result).not.toMatchObject({ kind: "not-found" });
});
