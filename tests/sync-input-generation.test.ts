import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  captureSyncInputGeneration,
  createSyncOperationInstrumentation,
} from "../src/sync-input-generation";
import { makeTemporaryDirectory } from "./helpers";

test("derives one Sync plan from captured bytes even when a source changes afterward", async () => {
  const root = await makeTemporaryDirectory("bearing-sync-generation-");
  const locator = "CONTEXT.md";
  await mkdir(root, { recursive: true });
  await writeFile(join(root, locator), "# Captured\n");

  const generation = await captureSyncInputGeneration(root, [locator]);
  await writeFile(join(root, locator), "# Changed\n");

  expect(generation.records).toHaveLength(1);
  expect(generation.records[0]?.source).toBe("# Captured\n");
  expect(generation.records[0]?.bytes.toString("utf8")).toBe("# Captured\n");
});

test("counts content reads and repository revalidation at the operation seams", async () => {
  const root = await makeTemporaryDirectory("bearing-sync-instrumentation-");
  const locator = "input.md";
  await writeFile(join(root, locator), "captured\n");
  const instrumentation = createSyncOperationInstrumentation();

  await captureSyncInputGeneration(root, [locator], instrumentation);
  expect(instrumentation.snapshot()).toEqual({
    inputReadCount: 1,
    repositoryRevalidationCount: 0,
  });

  await instrumentation.runRepositoryRevalidation(async () => true);
  expect(instrumentation.snapshot()).toEqual({
    inputReadCount: 1,
    repositoryRevalidationCount: 1,
  });
});
