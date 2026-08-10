import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import {
  copyPortalProjectFixture,
  readRepositorySourceBytes,
} from "../tests/fixtures/repository-fixture";
import { browserArtifactPath } from "./browser-artifact-output";
import {
  type RunningTestPortal,
  runBuiltBearing,
  startBuiltPortal,
  stopBuiltPortal,
  writeCatalogFixture,
} from "./real-host-test-support";

let host: RunningTestPortal | undefined;
let homeRoot = "";
let fixtureRoot = "";
let sourceBytes: Readonly<Record<string, string>> = {};
let catalogHash = "";

const sha256 = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

test.beforeAll(async () => {
  fixtureRoot = await realpath(await copyPortalProjectFixture("Ticket 12 Refresh Project"));
  await runBuiltBearing(["provider", "capture", "--repo", fixtureRoot, "--scope", ".scratch/work"]);
  sourceBytes = await readRepositorySourceBytes(fixtureRoot);

  homeRoot = await mkdtemp(join(tmpdir(), "bearing-ticket-12-browser-home-"));
  await writeCatalogFixture(homeRoot, [
    { entryId: "ticket-12-refresh", repoRoot: fixtureRoot, displayName: "Ticket 12 Refresh" },
  ]);
  catalogHash = await sha256(join(homeRoot, ".bearing/catalog.sqlite"));
  host = await startBuiltPortal(homeRoot);
});

test.afterAll(async () => {
  await stopBuiltPortal(host);
  await Promise.all(
    [homeRoot, fixtureRoot]
      .filter((root) => root.length > 0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("real Host performs only explicit contextual acquisitions without source or Catalog mutation", async ({
  page,
}, testInfo) => {
  if (host === undefined) throw new Error("Ticket 12 real Host did not start.");
  const providerPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/provider-observation")
    ) {
      providerPosts.push(request.postData() ?? "");
    }
  });

  await page.goto(`${host.url}/projects/ticket-12-refresh`);
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  expect(providerPosts).toEqual([]);

  const effortHref = planningLineageSubjectHref("ticket-12-refresh", {
    kind: "effort",
    id: "effort:fixture",
  });
  await page.goto(`${host.url}${effortHref}`);
  const sourceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/provider-observation"),
  );
  await page.getByRole("button", { name: "Refresh source" }).click();
  const sourceResult = await (await sourceResponse).json();
  expect(sourceResult).toMatchObject({
    state: "completed",
    action: "source-load",
    acquisitionCount: 1,
  });

  await page.goto(`${host.url}/projects/ticket-12-refresh`);
  await page.getByRole("button", { name: "Refresh all sources" }).click();
  const allResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/provider-observation"),
  );
  await page
    .getByRole("dialog", { name: "Refresh all sources" })
    .getByRole("button", { name: "Confirm refresh all sources" })
    .click();
  const allResult = await (await allResponse).json();
  expect(allResult).toMatchObject({
    state: "completed",
    action: "all-sources-refresh",
    acquisitionCount: 1,
  });

  const itemHref = planningLineageSubjectHref("ticket-12-refresh", {
    kind: "native-subject",
    id: ".scratch/work/issues/01-verify-isolation.md",
  });
  await page.goto(`${host.url}${itemHref}`);
  const inferredTimes = page.locator(
    '.source-event-time[title="Approximate time from current source metadata."]',
  );
  await expect(inferredTimes.first()).toBeVisible();
  await inferredTimes.first().hover();
  await inferredTimes.first().focus();
  await expect(inferredTimes.first()).toBeFocused();
  const inferredDescription = await inferredTimes.first().getAttribute("aria-describedby");
  expect(inferredDescription).not.toBeNull();
  await expect(page.locator(`#${inferredDescription}`)).toContainText(
    "Approximate time inferred from current source metadata",
  );
  await expect(page.getByText("Created", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tracker closed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Answer authored", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Updated", { exact: true }).first()).toBeVisible();
  const itemResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/provider-observation"),
  );
  await page.getByRole("button", { name: "Refresh source" }).click();
  const itemResult = await (await itemResponse).json();
  expect(itemResult).toMatchObject({
    state: "completed",
    action: "item-refresh",
    acquisitionCount: 1,
  });

  expect(providerPosts).toHaveLength(3);
  expect(await readRepositorySourceBytes(fixtureRoot)).toEqual(sourceBytes);
  expect(await sha256(join(homeRoot, ".bearing/catalog.sqlite"))).toBe(catalogHash);

  await page.screenshot({
    path: await browserArtifactPath(testInfo, "contextual-item-refresh.png"),
    fullPage: true,
  });
  await writeFile(
    await browserArtifactPath(testInfo, "provider-refresh-receipt.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        host: "foreground-loopback",
        initialProviderPosts: 0,
        finalProviderPosts: providerPosts.length,
        results: [sourceResult, allResult, itemResult].map(({ action, acquisitionCount }) => ({
          action,
          acquisitionCount,
        })),
        sourceBytesPreserved: true,
        catalogBytesPreserved: true,
      },
      null,
      2,
    )}\n`,
  );
});
