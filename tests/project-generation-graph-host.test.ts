import { expect, test } from "bun:test";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { PlanningGraph } from "../src/planning-graph";
import {
  createProjectGenerationGraphHost,
  type ProjectGenerationGraphAccess,
  type ProjectGenerationGraphHost,
} from "../src/portal/project-generation-graph-host";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { createProjectService } from "../src/portal/project-service";
import { authorizeWritesDirectly } from "../src/portal/project-write-executor";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { buildProjectSnapshot } from "../src/project-snapshot/projection";
import { prepareSync, type SyncPlan } from "../src/sync-plan";
import { createValidBearingRepo, writeFixture } from "./helpers";

const catalogFor = (entries: readonly { entryId: string; repoRoot: string }[]) => async () => ({
  state: "ready" as const,
  entries: entries.map((entry) => ({
    ...entry,
    displayName: entry.entryId,
    availability: "available" as const,
  })),
});

const snapshotFrom = (
  result: Awaited<ReturnType<ReturnType<typeof createProjectService>["sync"]>>,
) => {
  if (result.kind !== "completed") throw new Error("Expected completed Portal operation.");
  const cache = result.view.cache.snapshot;
  if (cache.state !== "available") throw new Error("Expected available Portal Snapshot.");
  return cache.snapshot;
};

const directExecutor =
  () =>
  async <Result>(
    operation: (authorizeWrites: typeof authorizeWritesDirectly) => Promise<Result>,
  ): Promise<Result> =>
    operation(authorizeWritesDirectly);

type Trace = {
  previous: (PlanningGraph | undefined)[];
  plans: SyncPlan[];
  snapshotGraphs: PlanningGraph[];
  failSnapshot: boolean;
};

const tracedMaterializer = (trace: Trace) =>
  createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: {
      prepare: async (root, options) => {
        trace.previous.push(options?.planningGraph);
        const plan = await prepareSync(root, options);
        trace.plans.push(plan);
        return plan;
      },
      buildSnapshot: async (input) => {
        trace.snapshotGraphs.push(input.planningGraph);
        expect(input.planningGraph.fingerprint).toBe(input.sitemapFingerprint);
        if (trace.failSnapshot) throw new Error("injected Snapshot failure");
        return buildProjectSnapshot(input);
      },
    },
  });

const emptyTrace = (): Trace => ({
  previous: [],
  plans: [],
  snapshotGraphs: [],
  failSnapshot: false,
});

const deferred = <Value>() => {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value: Value): void => resolvePromise?.(value) };
};

const tracedGenerationGraphHost = () => {
  const retained = createProjectGenerationGraphHost();
  const accesses = new Map<string, ProjectGenerationGraphAccess>();
  const current: Array<{ entryId: string; graph: PlanningGraph | undefined }> = [];
  const published: Array<{ entryId: string; graph: PlanningGraph }> = [];
  const host: ProjectGenerationGraphHost = Object.freeze({
    forEntry(entryId) {
      const existing = accesses.get(entryId);
      if (existing !== undefined) return existing;
      const delegate = retained.forEntry(entryId);
      const access = Object.freeze({
        current: () => {
          const graph = delegate.current();
          current.push({ entryId, graph });
          return graph;
        },
        publish: (graph: PlanningGraph): void => {
          published.push({ entryId, graph });
          delegate.publish(graph);
        },
      });
      accesses.set(entryId, access);
      return access;
    },
  });
  return {
    host,
    retained,
    current,
    published,
    clearTrace: (): void => {
      current.length = 0;
      published.length = 0;
    },
  };
};

const expectPortalRelationsAgree = (snapshot: ProjectSnapshot, graph: PlanningGraph): void => {
  expect(String(snapshot.basis.sitemapFingerprint)).toBe(graph.fingerprint);
  const gate = graph.contextFor({ kind: "gate", id: "gate:test" });
  if (gate.state === "invalid" || snapshot.gates.validity === "invalid") {
    throw new Error("Expected trustworthy Gate relation fixture.");
  }
  const projected = snapshot.gates.items.find((item) => item.id === "gate:test");
  expect(projected?.effortIds).toEqual(
    gate.context.efforts.map((context) => context.effort.value.id),
  );
};

test("Portal reuses one same-fingerprint graph and atomically replaces a changed generation", async () => {
  const root = await realpath(await createValidBearingRepo());
  const trace = emptyTrace();
  const generationGraphs = createProjectGenerationGraphHost();
  const service = createProjectService({
    readCatalog: catalogFor([{ entryId: "one", repoRoot: root }]),
    packageVersion: "0.0.0-test",
    materializer: tracedMaterializer(trace),
    generationGraphs,
    operationExecutorFor: directExecutor,
  });

  const first = await service.sync("one", "force");
  const firstGraph = generationGraphs.forEntry("one").current();
  if (firstGraph === undefined) throw new Error("Expected retained generation Graph.");
  expectPortalRelationsAgree(snapshotFrom(first), firstGraph);
  expect(trace.snapshotGraphs[0]).toBe(firstGraph);

  await service.sync("one", "force");
  expect(generationGraphs.forEntry("one").current()).toBe(firstGraph);
  expect(trace.plans[1]?.planningGraph).toBe(firstGraph);
  expect(trace.previous[1]).toBe(firstGraph);

  await writeFixture(root, "CONTEXT.md", "# Changed generation\n");
  const changed = await service.sync("one", "force");
  const changedGraph = generationGraphs.forEntry("one").current();
  if (changedGraph === undefined) throw new Error("Expected replacement generation Graph.");
  expect(changedGraph).not.toBe(firstGraph);
  expectPortalRelationsAgree(snapshotFrom(changed), changedGraph);
  expect(trace.snapshotGraphs.at(-1)).toBe(changedGraph);
});

test("failed materialization retains the prior graph until a coherent replacement succeeds", async () => {
  const root = await realpath(await createValidBearingRepo());
  const trace = emptyTrace();
  const generationGraphs = createProjectGenerationGraphHost();
  const service = createProjectService({
    readCatalog: catalogFor([{ entryId: "one", repoRoot: root }]),
    packageVersion: "0.0.0-test",
    materializer: tracedMaterializer(trace),
    generationGraphs,
    operationExecutorFor: directExecutor,
  });

  await service.sync("one", "force");
  const prior = generationGraphs.forEntry("one").current();
  if (prior === undefined) throw new Error("Expected prior generation Graph.");
  await writeFixture(root, "CONTEXT.md", "# Replacement candidate\n");
  trace.failSnapshot = true;

  expect(await service.sync("one", "force")).toMatchObject({ kind: "failed" });
  expect(generationGraphs.forEntry("one").current()).toBe(prior);
  expect(trace.previous.at(-1)).toBe(prior);

  trace.failSnapshot = false;
  await service.sync("one", "force");
  const replacement = generationGraphs.forEntry("one").current();
  expect(replacement).not.toBe(prior);
  expect(trace.previous.at(-1)).toBe(prior);
  await service.sync("one", "force");
  expect(trace.previous.at(-1)).toBe(replacement);
  expect(generationGraphs.forEntry("one").current()).toBe(replacement);
});

test("different Catalog entries never share or replace each other's graph", async () => {
  const firstRoot = await realpath(await createValidBearingRepo());
  const secondRoot = await realpath(await createValidBearingRepo());
  await writeFixture(secondRoot, "CONTEXT.md", "# Distinct second entry\n");
  const trace = emptyTrace();
  const generationGraphs = createProjectGenerationGraphHost();
  const service = createProjectService({
    readCatalog: catalogFor([
      { entryId: "one", repoRoot: firstRoot },
      { entryId: "two", repoRoot: secondRoot },
    ]),
    packageVersion: "0.0.0-test",
    materializer: tracedMaterializer(trace),
    generationGraphs,
    operationExecutorFor: directExecutor,
  });

  await Promise.all([service.sync("one", "force"), service.sync("two", "force")]);
  const first = generationGraphs.forEntry("one").current();
  const second = generationGraphs.forEntry("two").current();
  if (first === undefined || second === undefined) throw new Error("Expected isolated Graphs.");
  expect(first.fingerprint).not.toBe(second.fingerprint);
  expect(first).not.toBe(second);

  await writeFixture(firstRoot, "CONTEXT.md", "# First entry changed\n");
  await service.sync("one", "force");
  expect(generationGraphs.forEntry("one").current()).not.toBe(first);
  expect(generationGraphs.forEntry("two").current()).toBe(second);
});

test("generation Graph reuse stays process-local and below Portal transport", async () => {
  const [host, materializer, service] = await Promise.all([
    readFile(join(process.cwd(), "src/portal/project-generation-graph-host.ts"), "utf8"),
    readFile(join(process.cwd(), "src/portal/project-materializer.ts"), "utf8"),
    readFile(join(process.cwd(), "src/portal/project-service.ts"), "utf8"),
  ]);

  expect(materializer).toContain("planningGraph: plan.planningGraph");
  expect(service).toContain("generationGraphs.forEntry(entry.entryId)");
  for (const forbidden of [
    "node:child_process",
    "execFile(",
    "spawn(",
    "JSON.stringify",
    "writeFile",
    "setInterval",
    "watch(",
    "WebSocket",
    "sqlite",
  ]) {
    expect(host).not.toContain(forbidden);
  }
});

test("same-entry joined ensure and queued force reuse the retained Graph through Service", async () => {
  const root = await realpath(await createValidBearingRepo());
  const graphs = tracedGenerationGraphHost();
  const trace = emptyTrace();
  const realMaterializer = tracedMaterializer(trace);
  const release = deferred<void>();
  const activeStarted = deferred<void>();
  let materializerCalls = 0;
  let clock = 0;
  const service = createProjectService({
    readCatalog: catalogFor([{ entryId: "one", repoRoot: root }]),
    packageVersion: "0.0.0-test",
    generationGraphs: graphs.host,
    operationExecutorFor: directExecutor,
    clock: () => clock,
    materializer: {
      run: async (...args) => {
        materializerCalls += 1;
        if (materializerCalls === 2) {
          activeStarted.resolve();
          await release.promise;
        }
        return realMaterializer.run(...args);
      },
    },
  });

  await service.sync("one", "force");
  const retained = graphs.retained.forEntry("one").current();
  if (retained === undefined) throw new Error("Expected retained generation Graph.");
  graphs.clearTrace();
  clock = 30_001;

  const checking = service.sync("one", "ensure-current");
  await activeStarted.promise;
  const joined = service.sync("one", "ensure-current");
  const forcing = service.sync("one", "force");
  release.resolve();

  expect(await checking).toMatchObject({ kind: "completed", mode: "ensure-current" });
  expect(await joined).toMatchObject({ kind: "completed", mode: "ensure-current" });
  expect(await forcing).toMatchObject({ kind: "completed", mode: "force" });
  expect(materializerCalls).toBe(3);
  expect(graphs.current.map((event) => event.graph)).toEqual([retained, retained]);
  expect(graphs.published.map((event) => event.graph)).toEqual([retained, retained]);
  expect(graphs.retained.forEntry("one").current()).toBe(retained);
});

for (const recoveryFailure of [false, true]) {
  test(`relink during an in-flight materialization suppresses the obsolete publication ${
    recoveryFailure ? "even when the new root would fail" : "without rerunning the operation"
  }`, async () => {
    const originalRoot = await realpath(await createValidBearingRepo());
    const currentRoot = await realpath(await createValidBearingRepo());
    await writeFixture(currentRoot, "CONTEXT.md", "# Current root generation\n");
    const graphs = tracedGenerationGraphHost();
    const oldBuildStarted = deferred<void>();
    const releaseOldBuild = deferred<void>();
    let catalogRoot = originalRoot;
    let blockOldBuild = false;
    let failCurrentBuild = false;
    const snapshotGraphs: Array<{ repoRoot: string; graph: PlanningGraph }> = [];
    const materializer = createProjectMaterializer({
      packageVersion: "0.0.0-test",
      dependencies: {
        buildSnapshot: async (input) => {
          snapshotGraphs.push({ repoRoot: input.repoRoot, graph: input.planningGraph });
          if (blockOldBuild && input.repoRoot === originalRoot) {
            oldBuildStarted.resolve();
            await releaseOldBuild.promise;
          }
          if (failCurrentBuild && input.repoRoot === currentRoot) {
            throw new Error("injected recovery Snapshot failure");
          }
          return buildProjectSnapshot(input);
        },
      },
    });
    const service = createProjectService({
      readCatalog: async () => catalogFor([{ entryId: "one", repoRoot: catalogRoot }])(),
      packageVersion: "0.0.0-test",
      generationGraphs: graphs.host,
      materializer,
      operationExecutorFor: directExecutor,
    });

    await service.sync("one", "force");
    const prior = graphs.retained.forEntry("one").current();
    if (prior === undefined) throw new Error("Expected prior generation Graph.");
    await writeFixture(originalRoot, "CONTEXT.md", "# Obsolete in-flight generation\n");
    graphs.clearTrace();
    snapshotGraphs.length = 0;
    blockOldBuild = true;
    failCurrentBuild = recoveryFailure;

    const active = service.sync("one", "force");
    await oldBuildStarted.promise;
    catalogRoot = currentRoot;
    const joined = service.sync("one", "ensure-current");
    releaseOldBuild.resolve();

    const [activeResult, joinedResult] = await Promise.all([active, joined]);
    const obsolete = snapshotGraphs.find((event) => event.repoRoot === originalRoot)?.graph;
    if (obsolete === undefined) throw new Error("Expected obsolete in-flight Graph candidate.");
    expect(graphs.published.map((event) => event.graph)).not.toContain(obsolete);
    expect(activeResult).toMatchObject({ kind: "failed" });
    expect(snapshotGraphs.map((event) => event.repoRoot)).toEqual([originalRoot, currentRoot]);
    if (recoveryFailure) {
      expect(joinedResult).toMatchObject({ kind: "failed" });
      expect(graphs.published).toHaveLength(0);
      expect(graphs.retained.forEntry("one").current()).toBe(prior);
    } else {
      expect(joinedResult).toMatchObject({ kind: "completed" });
      const current = snapshotGraphs.find((event) => event.repoRoot === currentRoot)?.graph;
      if (current === undefined) throw new Error("Expected current-root Graph candidate.");
      expect(graphs.published.map((event) => event.graph)).toEqual([current]);
      expect(graphs.retained.forEntry("one").current()).toBe(current);
    }
  });
}

test("remove during an in-flight materialization suppresses its publication and affects only future operations", async () => {
  const root = await realpath(await createValidBearingRepo());
  const graphs = tracedGenerationGraphHost();
  const buildStarted = deferred<void>();
  const releaseBuild = deferred<void>();
  let present = true;
  let blockBuild = false;
  let materializerCalls = 0;
  const materializer = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: {
      buildSnapshot: async (input) => {
        materializerCalls += 1;
        if (blockBuild) {
          buildStarted.resolve();
          await releaseBuild.promise;
        }
        return buildProjectSnapshot(input);
      },
    },
  });
  const service = createProjectService({
    readCatalog: async () => catalogFor(present ? [{ entryId: "one", repoRoot: root }] : [])(),
    packageVersion: "0.0.0-test",
    generationGraphs: graphs.host,
    materializer,
    operationExecutorFor: directExecutor,
  });

  await service.sync("one", "force");
  const prior = graphs.retained.forEntry("one").current();
  if (prior === undefined) throw new Error("Expected prior generation Graph.");
  await writeFixture(root, "CONTEXT.md", "# Obsolete after removal\n");
  graphs.clearTrace();
  blockBuild = true;

  const active = service.sync("one", "force");
  await buildStarted.promise;
  present = false;
  releaseBuild.resolve();

  expect(await active).not.toMatchObject({ kind: "completed" });
  expect(graphs.published).toHaveLength(0);
  expect(graphs.retained.forEntry("one").current()).toBe(prior);
  const callsAfterActive = materializerCalls;
  expect(await service.sync("one", "force")).not.toMatchObject({ kind: "completed" });
  expect(materializerCalls).toBe(callsAfterActive);
});

test("cache authorization failure publishes nothing and retry publishes the coherent Graph", async () => {
  const root = await realpath(await createValidBearingRepo());
  const graphs = tracedGenerationGraphHost();
  let denyCache = true;
  const service = createProjectService({
    readCatalog: catalogFor([{ entryId: "one", repoRoot: root }]),
    packageVersion: "0.0.0-test",
    generationGraphs: graphs.host,
    operationExecutorFor: () => async (operation) =>
      operation(async (phase, write) => {
        if (phase === "cache" && denyCache) throw new Error("injected cache authorization denial");
        return write();
      }),
  });

  expect(await service.sync("one", "force")).toMatchObject({ kind: "failed" });
  expect(graphs.published).toHaveLength(0);
  expect(graphs.retained.forEntry("one").current()).toBeUndefined();

  denyCache = false;
  expect(await service.sync("one", "force")).toMatchObject({ kind: "completed" });
  expect(graphs.published).toHaveLength(1);
  expect(graphs.retained.forEntry("one").current()).toBe(graphs.published[0]?.graph);
});

test("one entry's materialization failure cannot publish or replace another entry's Graph", async () => {
  const firstRoot = await realpath(await createValidBearingRepo());
  const secondRoot = await realpath(await createValidBearingRepo());
  const graphs = tracedGenerationGraphHost();
  let failFirst = false;
  const materializer = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: {
      buildSnapshot: async (input) => {
        if (failFirst && input.repoRoot === firstRoot) {
          throw new Error("injected first-entry Snapshot failure");
        }
        return buildProjectSnapshot(input);
      },
    },
  });
  const service = createProjectService({
    readCatalog: catalogFor([
      { entryId: "one", repoRoot: firstRoot },
      { entryId: "two", repoRoot: secondRoot },
    ]),
    packageVersion: "0.0.0-test",
    generationGraphs: graphs.host,
    materializer,
    operationExecutorFor: directExecutor,
  });

  await Promise.all([service.sync("one", "force"), service.sync("two", "force")]);
  const firstPrior = graphs.retained.forEntry("one").current();
  const secondPrior = graphs.retained.forEntry("two").current();
  if (firstPrior === undefined || secondPrior === undefined) {
    throw new Error("Expected both retained Graphs.");
  }
  await Promise.all([
    writeFixture(firstRoot, "CONTEXT.md", "# First replacement\n"),
    writeFixture(secondRoot, "CONTEXT.md", "# Second replacement\n"),
  ]);
  graphs.clearTrace();
  failFirst = true;

  const [firstFailed, secondCompleted] = await Promise.all([
    service.sync("one", "force"),
    service.sync("two", "force"),
  ]);
  expect(firstFailed).toMatchObject({ kind: "failed" });
  expect(secondCompleted).toMatchObject({ kind: "completed" });
  expect(graphs.retained.forEntry("one").current()).toBe(firstPrior);
  const secondReplacement = graphs.retained.forEntry("two").current();
  expect(secondReplacement).not.toBe(secondPrior);
  expect(graphs.published.map((event) => event.entryId)).toEqual(["two"]);

  failFirst = false;
  expect(await service.sync("one", "force")).toMatchObject({ kind: "completed" });
  expect(graphs.retained.forEntry("one").current()).not.toBe(firstPrior);
  expect(graphs.retained.forEntry("two").current()).toBe(secondReplacement);
});
