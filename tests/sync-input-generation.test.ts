import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeBearingRecordGeneration } from "../src/bearing-record-decoder";
import { deriveStructuralDiagnosticsFromGeneration } from "../src/diagnostics";
import { buildPlanningGraph } from "../src/planning-graph";
import { buildProjectSitemapFromGeneration } from "../src/sitemap";
import {
  captureSyncInputGeneration,
  createSyncOperationInstrumentation,
  type SyncInputRecord,
} from "../src/sync-input-generation";
import { makeTemporaryDirectory } from "./helpers";

test("derives one Sync plan from captured bytes even when a source changes afterward", async () => {
  const root = await makeTemporaryDirectory("bearing-sync-generation-");
  const locator = ".scratch/work/issues/01-example.md";
  await mkdir(join(root, ".scratch/work/issues"), { recursive: true });
  await writeFile(join(root, locator), "# Example\n\nStatus: open\n");

  const generation = await captureSyncInputGeneration(root, [locator]);
  await writeFile(join(root, locator), "# Example\n\nStatus: unsupported\n");

  const decoded = decodeBearingRecordGeneration(generation);
  const diagnostics = deriveStructuralDiagnosticsFromGeneration(decoded, generation.records, []);
  const planningGraph = await buildPlanningGraph({
    decoded,
    nativeRecords: generation.records,
    diagnostics,
    fingerprint: generation.fingerprint,
    assetContentObservations: [],
  });
  const sitemap = buildProjectSitemapFromGeneration(
    decoded,
    generation.records,
    generation.inputs,
    generation.fingerprint,
    diagnostics,
    {},
    planningGraph,
  );

  expect(diagnostics).not.toContainEqual(
    expect.objectContaining({ code: "unsupported-tracker-status" }),
  );
  expect(sitemap.toString("utf8")).toContain(`\`${locator}\` | Example | open |`);
  expect(sitemap.toString("utf8")).not.toContain("unsupported");
});

test("diagnostics and Sitemap consume the supplied typed native-work result", async () => {
  const locator = ".scratch/work/issues/01-example.md";
  const fingerprint = `sha256:${"a".repeat(64)}`;
  const record: SyncInputRecord = {
    locator,
    bytes: Buffer.from("# Example\n\nStatus: unsupported\n"),
    source: "# Example\n\nStatus: unsupported\n",
    native: {
      kind: "ticket",
      locator,
      scope: ".scratch/work",
      number: "01",
      status: "claimed",
      blockers: [],
    },
  };

  const generation = {
    root: "/fixture",
    records: [record],
    inputs: [locator],
    fingerprint,
    observations: [],
    instrumentation: createSyncOperationInstrumentation(),
  };
  const decoded = decodeBearingRecordGeneration(generation);
  const diagnostics = deriveStructuralDiagnosticsFromGeneration(decoded, [record], []);
  const planningGraph = await buildPlanningGraph({
    decoded,
    nativeRecords: [record],
    diagnostics,
    fingerprint,
    assetContentObservations: [],
  });
  const sitemap = buildProjectSitemapFromGeneration(
    decoded,
    [record],
    [locator],
    fingerprint,
    diagnostics,
    {},
    planningGraph,
  );

  expect(diagnostics).not.toContainEqual(
    expect.objectContaining({ code: "unsupported-tracker-status" }),
  );
  expect(sitemap.toString("utf8")).toContain(`\`${locator}\` | Example | claimed |`);
  expect(sitemap.toString("utf8")).not.toContain("| unsupported |");
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
