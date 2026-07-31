import { expect, test } from "bun:test";
import { link, lstat, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { readProjectSnapshotCache } from "../src/project-snapshot/cache";
import { copyPortalProjectFixture, readRepositorySourceBytes } from "./fixtures/repository-fixture";

const SUMMARY_LOCATOR = ".bearing/state/project-summary.md";
const CACHE_OUTPUTS = [
  "project-sitemap.md",
  "sync-report.md",
  "project-snapshot.json",
  "sync-receipt.json",
] as const;

const materializer = (packageVersion: string) =>
  createProjectMaterializer({
    packageVersion,
    now: () => "2026-07-14T12:00:00.000Z",
  });

const readCacheBytes = async (root: string): Promise<Readonly<Record<string, string>>> =>
  Object.fromEntries(
    await Promise.all(
      CACHE_OUTPUTS.map(async (locator) => [
        locator,
        (await readFile(join(root, ".bearing/cache", locator))).toString("base64"),
      ]),
    ),
  );

test("the fixed fixture remains valid through the production Local provider seam", async () => {
  const root = await copyPortalProjectFixture("current-local-provider-project");

  const result = await materializer("0.0.0-current").run(
    root,
    "force",
    undefined,
    undefined,
    "initial-baseline",
  );

  expect(result.snapshot.providerObservations).toMatchObject([
    {
      state: "available",
      freshness: { assessment: "current" },
      coverage: { assessment: "complete" },
      completion: "complete",
      diagnostics: [],
    },
  ]);
  expect(result.snapshot.diagnostics).toEqual([]);
});

test("the fixed fixture gives an independently invalid Summary its own validity", async () => {
  const root = await copyPortalProjectFixture("invalid-summary-project");
  await writeFile(join(root, SUMMARY_LOCATOR), INVALID_SUMMARY, "utf8");
  const sourceBefore = await readRepositorySourceBytes(root);

  const result = await materializer("0.0.0-current").run(root, "force");

  expect(result.snapshot.summary).toMatchObject({
    validity: "invalid",
    issues: [{ target: SUMMARY_LOCATOR }],
  });
  expect(result.snapshot.roadmaps).toMatchObject({
    validity: "available",
    items: [{ id: "roadmap:fixture" }],
  });
  expect(result.snapshot.assets).toMatchObject({
    validity: "available",
    items: [{ id: "asset:fixture-uncited", citations: [], evidenceRoles: [] }],
  });
  expect(await readRepositorySourceBytes(root)).toEqual(sourceBefore);
});

test("the fixed fixture safely rebuilds a producer-version-mismatched Snapshot", async () => {
  const root = await copyPortalProjectFixture("producer-mismatch-project");
  const sourceBefore = await readRepositorySourceBytes(root);
  const old = await materializer("0.0.0-old").run(root, "force");
  const receiptBefore = await readFile(join(root, ".bearing/cache/sync-receipt.json"));

  expect(old.snapshot.producer.packageVersion).toBe("0.0.0-old");

  const recovered = await materializer("0.0.0-current").run(root, "ensure-current");
  const cache = await readProjectSnapshotCache(root);

  expect(recovered).toMatchObject({
    mode: "ensure-current",
    outcome: "materialized",
    snapshotDisposition: "materialized",
    snapshot: { producer: { packageVersion: "0.0.0-current" } },
  });
  expect(cache).toMatchObject({
    kind: "available",
    snapshot: { producer: { packageVersion: "0.0.0-current" } },
  });
  expect(await readFile(join(root, ".bearing/cache/sync-receipt.json"))).toEqual(receiptBefore);
  expect(await readRepositorySourceBytes(root)).toEqual(sourceBefore);
});

test("a hard-linked fixed-fixture input is scoped without exposing or mutating its neighbor", async () => {
  const isolatedRoot = await copyPortalProjectFixture("hardlink-isolated-project");
  const healthyRoot = await copyPortalProjectFixture("healthy-neighbor-project");
  const healthySummaryPath = join(healthyRoot, SUMMARY_LOCATOR);
  const isolatedSummaryPath = join(isolatedRoot, SUMMARY_LOCATOR);
  const healthySummary = (await readFile(healthySummaryPath, "utf8")).replaceAll(
    "Fixed Portal Project",
    "Healthy Neighbor Project",
  );
  await writeFile(healthySummaryPath, healthySummary, "utf8");
  await materializer("0.0.0-current").run(healthyRoot, "force");
  const healthyCacheBefore = await readCacheBytes(healthyRoot);

  await unlink(isolatedSummaryPath);
  await link(healthySummaryPath, isolatedSummaryPath);
  expect((await lstat(isolatedSummaryPath)).nlink).toBe(2);
  const healthySourceBefore = await readRepositorySourceBytes(healthyRoot);
  const isolatedSourceBefore = await readRepositorySourceBytes(isolatedRoot);

  const isolated = await materializer("0.0.0-current").run(isolatedRoot, "force");

  expect(isolated.snapshot.summary).toEqual({ validity: "absent" });
  expect(isolated.snapshot.roadmaps).toMatchObject({
    validity: "available",
    items: [{ id: "roadmap:fixture" }],
  });
  expect(isolated.snapshot.diagnostics).toContainEqual(
    expect.objectContaining({ impact: "blocking", target: SUMMARY_LOCATOR }),
  );
  expect(JSON.stringify(isolated.snapshot)).not.toContain("Healthy Neighbor Project");
  expect(await readCacheBytes(healthyRoot)).toEqual(healthyCacheBefore);
  expect(await readRepositorySourceBytes(healthyRoot)).toEqual(healthySourceBefore);
  expect(await readRepositorySourceBytes(isolatedRoot)).toEqual(isolatedSourceBefore);
});

const INVALID_SUMMARY = `---
Type: project-summary
ID: project-summary:current
Title: Independently Invalid Summary
---

# Project Summary: Independently Invalid Summary

## Purpose

Keep this invalid source isolated without repairing it.
`;
