import { expect, test } from "bun:test";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCatalog } from "../src/catalog/probe";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { readProjectSnapshotCache } from "../src/project-snapshot/cache";
import { runSync } from "../src/sync";
import { copyPortalProjectFixture, readRepositorySourceBytes } from "./fixtures/repository-fixture";
import { makeTemporaryDirectory } from "./helpers";

const materializer = () =>
  createProjectMaterializer({
    packageVersion: "0.0.0-test",
    now: () => "2026-07-14T12:00:00.000Z",
  });

test("the fixed repository fixture materializes healthy semantics without changing source bytes", async () => {
  const root = await copyPortalProjectFixture();
  const before = await readRepositorySourceBytes(root);

  const result = await materializer().run(root, "force");

  expect(result).toMatchObject({ outcome: "applied", snapshotDisposition: "materialized" });
  expect(result.snapshot.summary.validity).toBe("available");
  expect(result.snapshot.audit).toEqual({ validity: "absent" });
  expect(result.snapshot.assets).toMatchObject({
    validity: "available",
    items: [{ id: "asset:fixture-uncited", citations: [], evidenceRoles: [] }],
  });
  expect(await readRepositorySourceBytes(root)).toEqual(before);
});

test("one invalid canonical member stays scoped beside trustworthy fixture semantics", async () => {
  const root = await copyPortalProjectFixture("partial-project");
  await writeFile(join(root, ".bearing/state/assets.md"), PARTIAL_ASSET_REGISTRY);

  const result = await materializer().run(root, "force");

  expect(result.snapshot.summary.validity).toBe("available");
  expect(result.snapshot.audit).toEqual({ validity: "absent" });
  expect(result.snapshot.assets).toMatchObject({
    validity: "partial",
    items: [{ id: "asset:fixture-uncited", citations: [], evidenceRoles: [] }],
    issues: [{ code: "invalid-asset-schema", target: ".bearing/state/assets.md#asset:broken" }],
  });
  expect(result.snapshot.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "invalid-asset-schema",
      target: ".bearing/state/assets.md#asset:broken",
    }),
  );
});

test("missing, malformed, unsupported, and behind Snapshot caches recover per repository", async () => {
  const missingRoot = await copyPortalProjectFixture("cache missing");
  const missingSync = await runSync(missingRoot);
  expect(await readProjectSnapshotCache(missingRoot, missingSync.fingerprint)).toEqual({
    kind: "missing",
  });
  const recoveredMissing = await materializer().run(missingRoot, "ensure-current");

  const malformedRoot = await copyPortalProjectFixture("cache malformed");
  const malformedSync = await runSync(malformedRoot);
  await writeFile(snapshotPath(malformedRoot), "{malformed\n");
  expect(await readProjectSnapshotCache(malformedRoot, malformedSync.fingerprint)).toEqual({
    kind: "malformed",
    reason: "invalid-json",
  });
  const recoveredMalformed = await materializer().run(malformedRoot, "ensure-current");

  const unsupportedRoot = await copyPortalProjectFixture("cache unsupported");
  const unsupportedSync = await runSync(unsupportedRoot);
  await writeFile(snapshotPath(unsupportedRoot), '{"schemaVersion":1,"legacy":true}\n');
  expect(await readProjectSnapshotCache(unsupportedRoot, unsupportedSync.fingerprint)).toEqual({
    kind: "unsupported",
    schemaVersion: 1,
  });
  const recoveredUnsupported = await materializer().run(unsupportedRoot, "ensure-current");

  const behindRoot = await copyPortalProjectFixture("cache behind");
  await runSync(behindRoot);
  await materializer().run(behindRoot, "ensure-current");
  await writeFile(join(behindRoot, "CONTEXT.md"), "# Fixed Portal Project\n\nChanged input.\n");
  const behindSync = await runSync(behindRoot);
  expect(await readProjectSnapshotCache(behindRoot, behindSync.fingerprint)).toMatchObject({
    kind: "behind",
  });
  const recoveredBehind = await materializer().run(behindRoot, "ensure-current");

  for (const [root, result] of [
    [missingRoot, recoveredMissing],
    [malformedRoot, recoveredMalformed],
    [unsupportedRoot, recoveredUnsupported],
    [behindRoot, recoveredBehind],
  ] as const) {
    expect(result).toMatchObject({ outcome: "materialized", snapshotDisposition: "materialized" });
    expect(await readProjectSnapshotCache(root)).toMatchObject({ kind: "available" });
  }
  expect(String(recoveredBehind.snapshot.basis.sitemapFingerprint)).toBe(behindSync.fingerprint);
});

test("Catalog ordering stays stable with a whitespace path and an unavailable neighbor", async () => {
  const spacedRoot = await realpath(await copyPortalProjectFixture("Project With Spaces"));
  const zuluRoot = await realpath(await copyPortalProjectFixture("zulu-project"));
  const missingRoot = join(await realpath(await makeTemporaryDirectory("missing-parent-")), "gone");
  const homeDir = await makeTemporaryDirectory("catalog-home-");
  await mkdir(join(homeDir, ".bearing"), { recursive: true });
  await writeFile(
    join(homeDir, ".bearing/catalog.json"),
    `${JSON.stringify(
      {
        version: 1,
        entries: [
          { entryId: "zulu", repoRoot: zuluRoot, displayName: "Zulu Fixture" },
          { entryId: "missing", repoRoot: missingRoot, displayName: "Bravo Missing" },
          { entryId: "spaced", repoRoot: spacedRoot, displayName: "Alpha Fixture" },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const first = await readCatalog({ homeDir });
  const second = await readCatalog({ homeDir });

  expect(first.entries.map(({ entryId }) => entryId)).toEqual(["spaced", "missing", "zulu"]);
  expect(second.entries).toEqual(first.entries);
  expect(first.entries.map(({ availability }) => availability)).toEqual([
    "available",
    "missing",
    "available",
  ]);
  expect(first.entries[0]?.repoRoot).toContain("Project With Spaces");
});

test("one project Sync or cache failure cannot mutate a trustworthy neighbor", async () => {
  const changedRoot = await copyPortalProjectFixture("changed-project");
  const healthyRoot = await copyPortalProjectFixture("healthy-project");
  const failingRoot = await copyPortalProjectFixture("failing-project");
  const sharedMaterializer = materializer();
  await sharedMaterializer.run(changedRoot, "force");
  await sharedMaterializer.run(healthyRoot, "force");
  const healthyBefore = await readProjectCacheBytes(healthyRoot);

  await writeFile(join(changedRoot, "CONTEXT.md"), "# Changed Project\n\nDirty input.\n");
  const changed = await sharedMaterializer.run(changedRoot, "force");

  expect(changed).toMatchObject({ outcome: "applied", snapshotDisposition: "materialized" });
  expect(await readProjectCacheBytes(healthyRoot)).toEqual(healthyBefore);

  await runSync(failingRoot);
  await mkdir(snapshotPath(failingRoot));
  await expect(sharedMaterializer.run(failingRoot, "ensure-current")).rejects.toMatchObject({
    code: "snapshot-write-failed",
  });
  expect(await readProjectCacheBytes(healthyRoot)).toEqual(healthyBefore);

  const healthy = await sharedMaterializer.run(healthyRoot, "ensure-current");
  expect(healthy).toMatchObject({ outcome: "checked", snapshotDisposition: "reused" });
  expect(healthy.snapshot.summary).toMatchObject({
    validity: "available",
    value: { title: "Fixed Portal Project" },
  });
});

const PARTIAL_ASSET_REGISTRY = `---
Type: asset-registry
Assets:
  - ID: asset:fixture-uncited
    Title: Uncited Fixture Evidence
    Kind: verification-report
    Location: evidence/uncited.md
    Owner: effort:fixture
    Producer:
      Kind: executor-profile
      Name: generic-agent
    Lifecycle source: native
  - ID: asset:broken
    Title: Broken Fixture Asset
    Kind: verification-report
    Owner: effort:fixture
    Producer:
      Kind: executor-profile
      Name: generic-agent
    Lifecycle source: native
---

# Asset Registry
`;

const snapshotPath = (root: string): string => join(root, ".bearing/cache/project-snapshot.json");

const readProjectCacheBytes = async (root: string): Promise<readonly string[]> =>
  Promise.all(
    ["project-sitemap.md", "sync-report.md", "project-snapshot.json", "sync-receipt.json"].map(
      async (locator) => (await readFile(join(root, ".bearing/cache", locator))).toString("base64"),
    ),
  );
