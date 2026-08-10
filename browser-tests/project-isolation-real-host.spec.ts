import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  copyPortalProjectFixture,
  readRepositorySourceBytes,
} from "../tests/fixtures/repository-fixture";
import {
  preserveProjectReadModel,
  projectReadModelHashes,
  type RunningTestPortal,
  runBuiltBearing,
  startBuiltPortal,
  stopBuiltPortal,
  writeCatalogFixture,
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

  await runBuiltBearing(["cache", "rebuild", "--repo", alphaRoot]);
  await runBuiltBearing(["cache", "rebuild", "--repo", recoveryRoot]);
  alphaSources = await readRepositorySourceBytes(alphaRoot);

  await writeCatalogFixture(homeRoot, [
    { entryId: "zulu-recovery", repoRoot: recoveryRoot, displayName: "Zulu Recovery" },
    { entryId: "missing-neighbor", repoRoot: missingRoot, displayName: "Bravo Unavailable" },
    { entryId: "alpha-trustworthy", repoRoot: alphaRoot, displayName: "Alpha Project" },
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

test("a real Host rebuilds and reads one project without disturbing its neighbors", async ({
  page,
}) => {
  if (host === undefined) throw new Error("Ticket 15 Host did not start.");
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(host.url);
  const catalog = page.getByRole("list", { name: "Registered Bearing projects" });
  const orderedNames = async () => catalog.locator("strong").allTextContents();
  await expect(catalog.locator("li")).toHaveCount(3);
  expect(await orderedNames()).toEqual(catalogOrder);
  await page.screenshot({ path: join(evidence, "catalog-three-projects.png"), fullPage: true });

  const alphaRead = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/api/v1/projects/alpha-trustworthy/read-model"),
  );
  await catalog.getByRole("link", { name: /Alpha Project/u }).click();
  expect(await (await alphaRead).json()).toMatchObject({ state: "ready" });
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  const alphaReadModelBefore = await projectReadModelHashes(alphaRoot);

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

  const recoveryRead = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/api/v1/projects/zulu-recovery/read-model"),
  );
  await catalog.getByRole("link", { name: /Zulu Recovery/u }).click();
  expect(await (await recoveryRead).json()).toMatchObject({ state: "ready" });
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();

  const changedContext = "# Fixed Portal Project\n\nExplicit typed read-model isolation input.\n";
  await writeFile(join(recoveryRoot, "CONTEXT.md"), changedContext);
  await runBuiltBearing(["cache", "rebuild", "--repo", recoveryRoot]);
  const rebuiltRead = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/api/v1/projects/zulu-recovery/read-model"),
  );
  await page.reload();
  expect(await (await rebuiltRead).json()).toMatchObject({ state: "ready" });
  expect(await projectReadModelHashes(alphaRoot)).toEqual(alphaReadModelBefore);
  expect(await readRepositorySourceBytes(alphaRoot)).toEqual(alphaSources);
  expect(await readFile(join(recoveryRoot, "CONTEXT.md"), "utf8")).toBe(changedContext);
  await expect(readFile(join(missingRoot, ".bearing/manifest.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await page.screenshot({ path: join(evidence, "rebuilt-project.png"), fullPage: true });

  await page.getByRole("link", { name: /Return to Project Catalog from Zulu Recovery/u }).click();
  await catalog.getByRole("link", { name: /Alpha Project/u }).click();
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  await page.screenshot({ path: join(evidence, "trustworthy-project-return.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);

  await page.getByRole("link", { name: /Return to Project Catalog from Alpha Project/u }).click();
  await writeFile(join(homeRoot, ".bearing/catalog.sqlite"), "{malformed\n");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Catalog is unavailable" })).toBeVisible();
  const finalCatalogOrder = await orderedNames();
  expect(finalCatalogOrder).toEqual([]);
  await page.screenshot({ path: join(evidence, "catalog-unavailable.png"), fullPage: true });

  await Promise.all([
    preserveProjectReadModel(alphaRoot, join(evidence, "fixture-output/alpha")),
    preserveProjectReadModel(recoveryRoot, join(evidence, "fixture-output/zulu-recovery")),
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
    explicitReadModelRebuild: {
      entryId: "zulu-recovery",
      outcome: "ready",
      trustworthyNeighborReadModelUnchanged: true,
      trustworthyNeighborSourcesUnchanged: true,
    },
    finalCatalogOrder,
    trustworthyProjectReturned: true,
  };
});
