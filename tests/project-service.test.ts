import { expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import type { CatalogReadResult } from "../src/portal/contract";
import {
  createProjectMaterializer,
  ProjectMaterializerError,
} from "../src/portal/project-materializer";
import {
  createProjectService,
  type ProjectOperationExecutorFactory,
} from "../src/portal/project-service";
import { runSync } from "../src/sync";
import { createValidBearingRepo } from "./helpers";

const catalogFor =
  (repoRoot: string, displayName = "Fixture"): (() => Promise<CatalogReadResult>) =>
  async () => ({
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
const allowTestWrites: ProjectOperationExecutorFactory = () => async (operation) =>
  operation((_phase, write) => write());

test("GET service is cache-only while ensure, cooldown, and force stay distinct", async () => {
  const root = await realpath(await createValidBearingRepo());
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  let clock = 1_000;
  const service = createProjectService({
    readCatalog: catalogFor(root),
    packageVersion: "0.0.0-test",
    clock: () => clock,
    now: () => "2026-07-13T12:01:00.000Z",
    operationExecutorFor: allowTestWrites,
  });
  const read = await service.read("project-1");
  expect(read).toMatchObject({
    kind: "ready",
    view: { cache: { snapshot: { state: "missing" } } },
    validation: { due: true, inFlight: false },
  });
  const ensured = await service.sync("project-1", "ensure-current");
  expect(ensured).toMatchObject({
    kind: "completed",
    outcome: "materialized",
    view: { cache: { snapshot: { state: "available" } } },
  });
  const cooldown = await service.sync("project-1", "ensure-current");
  expect(cooldown).toMatchObject({ kind: "cooldown", outcome: "cooldown" });
  const forced = await service.sync("project-1", "force");
  expect(forced).toMatchObject({ kind: "completed", outcome: "no-op" });
  clock += 30_000;
  expect((await service.read("project-1")).kind).toBe("ready");
});

test("a relinked entry is due even while its old repository remains in cooldown", async () => {
  const originalRoot = await realpath(await createValidBearingRepo());
  const currentRoot = await realpath(await createValidBearingRepo());
  await runSync(originalRoot, { completedAt: "2026-07-13T12:00:00.000Z" });
  await runSync(currentRoot, { completedAt: "2026-07-13T12:00:00.000Z" });
  let catalogRoot = originalRoot;
  const service = createProjectService({
    readCatalog: async () => catalogFor(catalogRoot)(),
    packageVersion: "0.0.0-test",
    operationExecutorFor: allowTestWrites,
  });

  await service.sync("project-1", "ensure-current");
  catalogRoot = currentRoot;

  expect(await service.read("project-1")).toMatchObject({
    kind: "ready",
    validation: { due: true, cooldownRemainingMs: 0, inFlight: false },
  });
  expect(await service.sync("project-1", "ensure-current")).toMatchObject({
    kind: "completed",
    mode: "ensure-current",
  });
});

test("service writes fail closed when no Catalog ownership executor is installed", async () => {
  const root = await realpath(await createValidBearingRepo());
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const service = createProjectService({
    readCatalog: catalogFor(root),
    packageVersion: "0.0.0-test",
  });

  expect(await service.sync("project-1", "ensure-current")).toMatchObject({
    kind: "failed",
    error: { code: "input-validation-failed" },
  });
});

test("service can confirm a no-write check without a Catalog ownership executor", async () => {
  const root = await realpath(await createValidBearingRepo());
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(root, "ensure-current");
  const service = createProjectService({
    readCatalog: catalogFor(root),
    packageVersion: "0.0.0-test",
  });

  expect(await service.sync("project-1", "ensure-current")).toMatchObject({
    kind: "completed",
    mode: "ensure-current",
    outcome: "checked",
  });
});

test("bypasses an old-root cooldown and revalidates the relinked repository", async () => {
  const originalRoot = await realpath(await createValidBearingRepo());
  const currentRoot = await realpath(await createValidBearingRepo());
  await runSync(originalRoot, { completedAt: "2026-07-13T12:00:00.000Z" });
  const baseline = await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(
    originalRoot,
    "ensure-current",
  );
  let catalogRoot = originalRoot;
  let relinkAfterRead = false;
  const materializations: Array<{ mode: string; repoRoot: string }> = [];
  const service = createProjectService({
    readCatalog: async () => {
      const catalog = await catalogFor(catalogRoot)();
      if (relinkAfterRead) {
        relinkAfterRead = false;
        queueMicrotask(() => {
          catalogRoot = currentRoot;
        });
      }
      return catalog;
    },
    packageVersion: "0.0.0-test",
    materializer: {
      run: async (repoRoot, mode) => {
        materializations.push({ mode, repoRoot });
        return mode === "force"
          ? {
              ...baseline,
              mode,
              outcome: "no-op",
              reconciliation: "no-op",
            }
          : baseline;
      },
    },
  });
  await service.sync("project-1", "ensure-current");

  relinkAfterRead = true;
  const recovered = await service.sync("project-1", "ensure-current");

  expect(recovered).toMatchObject({
    kind: "completed",
    mode: "ensure-current",
    outcome: "synced",
    view: { cache: { snapshot: { state: "available" }, retained: false } },
  });
  expect(materializations).toEqual([
    { repoRoot: originalRoot, mode: "ensure-current" },
    { repoRoot: currentRoot, mode: "force" },
  ]);
});

test("composes a cooldown response with the latest same-root alias", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  await runSync(repoRoot, { completedAt: "2026-07-13T12:00:00.000Z" });
  const baseline = await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(
    repoRoot,
    "ensure-current",
  );
  let displayName = "Original alias";
  let renameAfterRead = false;
  const service = createProjectService({
    readCatalog: async () => {
      const catalog = await catalogFor(repoRoot, displayName)();
      if (renameAfterRead) {
        renameAfterRead = false;
        queueMicrotask(() => {
          displayName = "Renamed alias";
        });
      }
      return catalog;
    },
    packageVersion: "0.0.0-test",
    materializer: { run: async () => baseline },
  });
  await service.sync("project-1", "ensure-current");

  renameAfterRead = true;
  const cooldown = await service.sync("project-1", "ensure-current");

  expect(cooldown).toMatchObject({
    kind: "cooldown",
    mode: "ensure-current",
    view: { project: { displayName: "Renamed alias" } },
  });
});

test("returns typed retained-cache failure and applies failure cooldown", async () => {
  const root = await realpath(await createValidBearingRepo());
  await runSync(root, { completedAt: "2026-07-13T12:00:00.000Z" });
  const seed = createProjectMaterializer({ packageVersion: "0.0.0-test" });
  await seed.run(root, "ensure-current");
  const service = createProjectService({
    readCatalog: catalogFor(root),
    packageVersion: "0.0.0-test",
    materializer: {
      run: async () =>
        Promise.reject(
          new ProjectMaterializerError(
            "snapshot-materialization-failed",
            "Project Snapshot materialization failed.",
            undefined,
          ),
        ),
    },
  });
  const failed = await service.sync("project-1", "ensure-current");
  expect(failed).toMatchObject({
    kind: "failed",
    error: { code: "snapshot-materialization-failed" },
    view: { cache: { retained: true, snapshot: { state: "available" } } },
  });
  expect(await service.sync("project-1", "ensure-current")).toMatchObject({
    kind: "cooldown",
  });
});

test("an automatic entry preflight failure enters the same cooldown", async () => {
  const root = await realpath(await createValidBearingRepo());
  let available = false;
  let materializerCalls = 0;
  const service = createProjectService({
    readCatalog: async () => ({
      state: "ready",
      entries: [
        {
          entryId: "project-1",
          displayName: "Fixture",
          repoRoot: root,
          availability: available ? "available" : "missing",
        },
      ],
    }),
    packageVersion: "0.0.0-test",
    materializer: {
      run: async () => {
        materializerCalls += 1;
        throw new Error("must remain in cooldown");
      },
    },
  });

  expect(await service.sync("project-1", "ensure-current")).toMatchObject({
    kind: "unavailable",
  });
  available = true;
  expect(await service.sync("project-1", "ensure-current")).toMatchObject({
    kind: "cooldown",
  });
  expect(materializerCalls).toBe(0);
});

test("an unavailable entry relink bypasses its old locator cooldown without exposing the locator", async () => {
  const unavailableRoot = await realpath(await createValidBearingRepo());
  const currentRoot = await realpath(await createValidBearingRepo());
  const baseline = await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(
    currentRoot,
    "ensure-current",
  );
  let repoRoot = unavailableRoot;
  let availability: "available" | "missing" = "missing";
  const materializations: Array<{ repoRoot: string; mode: string }> = [];
  const service = createProjectService({
    readCatalog: async () => ({
      state: "ready",
      entries: [
        {
          entryId: "project-1",
          displayName: "Fixture",
          repoRoot,
          availability,
        },
      ],
    }),
    packageVersion: "0.0.0-test",
    materializer: {
      run: async (root, mode) => {
        materializations.push({ repoRoot: root, mode });
        return {
          ...baseline,
          mode: "force",
          outcome: "no-op",
          reconciliation: "no-op",
        };
      },
    },
  });

  const unavailable = await service.sync("project-1", "ensure-current");
  expect(unavailable).toMatchObject({ kind: "unavailable" });
  expect(JSON.stringify(unavailable)).not.toContain(unavailableRoot);
  repoRoot = currentRoot;
  availability = "available";

  expect(await service.sync("project-1", "ensure-current")).toMatchObject({
    kind: "completed",
    mode: "ensure-current",
    outcome: "synced",
  });
  expect(materializations).toEqual([{ repoRoot: currentRoot, mode: "force" }]);
});

test("an unavailable entry stays in cooldown when the same locator recovers", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  let availability: "available" | "missing" = "missing";
  let materializerCalls = 0;
  const service = createProjectService({
    readCatalog: async () => ({
      state: "ready",
      entries: [
        {
          entryId: "project-1",
          displayName: "Fixture",
          repoRoot,
          availability,
        },
      ],
    }),
    packageVersion: "0.0.0-test",
    materializer: {
      run: async () => {
        materializerCalls += 1;
        throw new Error("must remain in cooldown");
      },
    },
  });

  expect(await service.sync("project-1", "ensure-current")).toMatchObject({
    kind: "unavailable",
  });
  availability = "available";

  expect(await service.sync("project-1", "ensure-current")).toMatchObject({ kind: "cooldown" });
  expect(materializerCalls).toBe(0);
});

test("keeps invalid and unknown entry identities outside repository work", async () => {
  const root = await realpath(await createValidBearingRepo());
  let materializerCalls = 0;
  const service = createProjectService({
    readCatalog: catalogFor(root),
    packageVersion: "0.0.0-test",
    materializer: {
      run: async () => {
        materializerCalls += 1;
        throw new Error("should not run");
      },
    },
  });
  expect((await service.read("../escape")).kind).toBe("invalid-id");
  expect((await service.sync("unknown", "force")).kind).toBe("not-found");
  expect(materializerCalls).toBe(0);
});
