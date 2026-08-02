import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  copyPortalProjectFixture,
  readRepositorySourceBytes,
} from "../tests/fixtures/repository-fixture";
import {
  fixedCacheHashes,
  preserveFixedCache,
  type RunningTestPortal,
  runBuiltBearing,
  startBuiltPortal,
  stopBuiltPortal,
} from "./real-host-test-support";

let evidence = join(process.cwd(), "test-results/portal-isolation-evidence");
const catalogOrder = ["Alpha Project", "Bravo Unavailable", "Zulu Recovery"] as const;

type BuildAnchor = Readonly<{ packageVersion: string; buildId: string }>;

let host: RunningTestPortal | undefined;
let homeRoot = "";
let missingParent = "";
let missingRoot = "";
let alphaRoot = "";
let recoveryRoot = "";
let buildAnchor: BuildAnchor | undefined;
let alphaSources: Readonly<Record<string, string>> = {};
let recoverySources: Readonly<Record<string, string>> = {};
let receiptBody: unknown;
const fixtureParents: string[] = [];

const readBuildAnchor = async (): Promise<BuildAnchor> => {
  const manifest: unknown = JSON.parse(
    await readFile(join(process.cwd(), "dist/portal/asset-manifest.json"), "utf8"),
  );
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    !("schemaVersion" in manifest) ||
    manifest.schemaVersion !== 1 ||
    !("packageVersion" in manifest) ||
    typeof manifest.packageVersion !== "string" ||
    manifest.packageVersion.length === 0 ||
    !("buildId" in manifest) ||
    typeof manifest.buildId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(manifest.buildId)
  ) {
    throw new Error("The packaged Portal manifest cannot anchor real-host evidence.");
  }
  return { packageVersion: manifest.packageVersion, buildId: manifest.buildId };
};

test.beforeAll(async ({ browserName }, testInfo) => {
  if (browserName !== "chromium") throw new Error("The real-host gate requires Chromium.");
  const configuredEvidence = testInfo.project.metadata["evidenceRoot"];
  if (configuredEvidence !== undefined) {
    if (typeof configuredEvidence !== "string" || configuredEvidence.length === 0) {
      throw new Error("The configured real-host evidence root is invalid.");
    }
    evidence = configuredEvidence;
  }
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "isolation-receipt.json"),
    `${JSON.stringify({ schemaVersion: 1, kind: "real-host-isolation", status: "incomplete" }, null, 2)}\n`,
  );
  buildAnchor = await readBuildAnchor();
  await writeFile(
    join(evidence, "isolation-receipt.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "real-host-isolation",
        status: "incomplete",
        build: buildAnchor,
      },
      null,
      2,
    )}\n`,
  );
  alphaRoot = await realpath(await copyPortalProjectFixture("Alpha Project With Spaces"));
  recoveryRoot = await realpath(await copyPortalProjectFixture("Zulu Recovery"));
  fixtureParents.push(dirname(alphaRoot), dirname(recoveryRoot));
  homeRoot = await mkdtemp(join(tmpdir(), "bearing-portal-isolation-home-"));
  missingParent = await mkdtemp(join(tmpdir(), "bearing-portal-isolation-missing-"));
  missingRoot = join(missingParent, "repository-is-gone");

  await runBuiltBearing(["sync", "--repo", alphaRoot, "--initialize-provider-observations"]);
  await runBuiltBearing(["sync", "--repo", recoveryRoot, "--initialize-provider-observations"]);
  await writeFile(join(recoveryRoot, ".bearing/cache/project-snapshot.json"), "{malformed\n");
  alphaSources = await readRepositorySourceBytes(alphaRoot);
  recoverySources = await readRepositorySourceBytes(recoveryRoot);

  await mkdir(join(homeRoot, ".bearing"), { recursive: true });
  const catalogDocument = `${JSON.stringify(
    {
      version: 1,
      entries: [
        { entryId: "zulu-recovery", repoRoot: recoveryRoot, displayName: "Zulu Recovery" },
        { entryId: "missing-neighbor", repoRoot: missingRoot, displayName: "Bravo Unavailable" },
        { entryId: "alpha-trustworthy", repoRoot: alphaRoot, displayName: "Alpha Project" },
      ],
    },
    null,
    2,
  )}\n`;
  await Promise.all([
    writeFile(join(homeRoot, ".bearing/catalog.json"), catalogDocument),
    writeFile(join(homeRoot, ".bearing/catalog.backup.json"), catalogDocument),
  ]);
  host = await startBuiltPortal(homeRoot);
});

test.afterAll(async () => {
  const cleanupFailures: unknown[] = [];
  try {
    await stopBuiltPortal(host);
  } catch (error) {
    cleanupFailures.push(error);
  }
  const cleanupResults = await Promise.allSettled(
    [homeRoot, missingParent, ...fixtureParents]
      .filter((root) => root.length > 0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
  cleanupFailures.push(
    ...cleanupResults
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason),
  );
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, "Real-host evidence cleanup failed.");
  }
  if (receiptBody !== undefined) {
    await writeFile(
      join(evidence, "isolation-receipt.json"),
      `${JSON.stringify(receiptBody, null, 2)}\n`,
    );
  }
});

test("a real Host recovers and synchronizes one project without disturbing its neighbors", async ({
  page,
}) => {
  if (host === undefined) throw new Error("Ticket 15 Host did not start.");
  expect(await readFile(join(recoveryRoot, ".bearing/cache/project-snapshot.json"), "utf8")).toBe(
    "{malformed\n",
  );
  const consoleErrors: string[] = [];
  const forceTargets: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/sync")) return;
    if (request.postData() !== JSON.stringify({ version: 1, mode: "force" })) return;
    forceTargets.push(decodeURIComponent(new URL(request.url()).pathname.split("/").at(-2) ?? ""));
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(host.url);
  const catalog = page.getByRole("list", { name: "Registered Bearing projects" });
  const orderedNames = async () => catalog.locator("strong").allTextContents();
  await expect(catalog.locator("li")).toHaveCount(3);
  expect(await orderedNames()).toEqual(catalogOrder);
  await page.screenshot({ path: join(evidence, "catalog-three-projects.png"), fullPage: true });

  const alphaCheck = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects/alpha-trustworthy/sync") &&
      response.request().postData() === JSON.stringify({ version: 1, mode: "ensure-current" }),
  );
  await catalog.getByRole("link", { name: /Alpha Project/u }).click();
  expect(await (await alphaCheck).json()).toMatchObject({
    state: "completed",
    outcome: "materialized",
  });
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  const alphaCacheBefore = await fixedCacheHashes(alphaRoot);

  await page.getByRole("link", { name: /Return to Project Catalog from Alpha Project/u }).click();
  await expect(catalog.locator("li")).toHaveCount(3);
  expect(await orderedNames()).toEqual(catalogOrder);
  await expect(catalog.getByRole("link", { name: /Bravo Unavailable/u })).toHaveCount(0);
  await expect(catalog.getByText("Bravo Unavailable", { exact: true })).toBeVisible();
  await expect(catalog.getByText("Repository missing", { exact: true })).toBeVisible();
  await page.screenshot({
    path: join(evidence, "catalog-unavailable-neighbor.png"),
    fullPage: true,
  });

  const recoveryCheck = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects/zulu-recovery/sync") &&
      response.request().postData() === JSON.stringify({ version: 1, mode: "ensure-current" }),
  );
  await catalog.getByRole("link", { name: /Zulu Recovery/u }).click();
  expect(await (await recoveryCheck).json()).toMatchObject({
    state: "completed",
    outcome: "materialized",
    snapshotDisposition: "materialized",
  });
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  const recoveredSnapshot: unknown = JSON.parse(
    await readFile(join(recoveryRoot, ".bearing/cache/project-snapshot.json"), "utf8"),
  );
  expect(recoveredSnapshot).toMatchObject({ producer: { packageVersion: expect.any(String) } });
  expect(await readRepositorySourceBytes(recoveryRoot)).toEqual(recoverySources);
  await page.screenshot({ path: join(evidence, "recovered-project.png"), fullPage: true });

  const changedContext = "# Fixed Portal Project\n\nExplicit browser Sync isolation input.\n";
  await writeFile(join(recoveryRoot, "CONTEXT.md"), changedContext);
  const forced = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects/zulu-recovery/sync") &&
      response.request().postData() === JSON.stringify({ version: 1, mode: "force" }),
  );
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  expect(await (await forced).json()).toMatchObject({
    state: "completed",
    mode: "force",
    outcome: "applied",
    reconciliation: "applied",
  });
  await expect(page.locator(".topbar-sync")).toHaveText("Updated");
  expect(forceTargets).toEqual(["zulu-recovery"]);
  expect(await fixedCacheHashes(alphaRoot)).toEqual(alphaCacheBefore);
  expect(await readRepositorySourceBytes(alphaRoot)).toEqual(alphaSources);
  expect(await readFile(join(recoveryRoot, "CONTEXT.md"), "utf8")).toBe(changedContext);
  await expect(readFile(join(missingRoot, ".bearing/manifest.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });

  await page.getByRole("link", { name: /Return to Project Catalog from Zulu Recovery/u }).click();
  await expect(catalog.locator("li")).toHaveCount(3);
  expect(await orderedNames()).toEqual(catalogOrder);
  await catalog.getByRole("link", { name: /Alpha Project/u }).click();
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  await page.screenshot({ path: join(evidence, "trustworthy-project-return.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);

  await page.getByRole("link", { name: /Return to Project Catalog from Alpha Project/u }).click();
  await writeFile(join(homeRoot, ".bearing/catalog.json"), "{malformed\n");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Using last-known-good projects" })).toBeVisible();
  const finalCatalogOrder = await orderedNames();
  expect(finalCatalogOrder).toEqual(catalogOrder);
  await page.screenshot({ path: join(evidence, "catalog-degraded-backup.png"), fullPage: true });

  await Promise.all([
    preserveFixedCache(alphaRoot, join(evidence, "fixture-output/alpha")),
    preserveFixedCache(recoveryRoot, join(evidence, "fixture-output/zulu-recovery")),
  ]);

  receiptBody = {
    schemaVersion: 1,
    kind: "real-host-isolation",
    status: "complete",
    build: buildAnchor,
    host: "real-loopback",
    browser: "headless",
    catalog: {
      order: catalogOrder,
      entries: ["available", "missing", "available"],
      whitespacePathCovered: true,
    },
    recovery: {
      entryId: "zulu-recovery",
      before: "malformed",
      after: "available",
      sourceBytesPreserved: true,
    },
    catalogRecovery: {
      current: "malformed",
      backup: "available",
      state: "degraded",
      entriesPreserved: true,
    },
    explicitSync: {
      entryId: "zulu-recovery",
      mode: "force",
      outcome: "applied",
      forceTargets,
      trustworthyNeighborCacheUnchanged: true,
      trustworthyNeighborSourcesUnchanged: true,
    },
    finalCatalogOrder,
    trustworthyProjectReturned: true,
  };
});
