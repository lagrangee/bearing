import { createHash } from "node:crypto";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import { buildPortalAssetManifest, writePortalAssetManifest } from "../src/portal/assets";
import { PORTAL_BUILD_IDENTITY_HEADER } from "../src/portal-build-identity-wire";
import type { RuntimeReceipt } from "../src/runtime-context";
import {
  copyPortalProjectFixture,
  readRepositorySourceBytes,
} from "../tests/fixtures/repository-fixture";
import { browserArtifactPath } from "./browser-artifact-output";
import {
  type RunningTestPortal,
  runBuiltBearing,
  runHarnessCommand,
  spawnHarnessProcess,
  stopBuiltPortal,
  waitForHarnessLine,
  writeCatalogFixture,
} from "./real-host-test-support";

let host: RunningTestPortal | undefined;
let homeRoot = "";
let fixtureRoot = "";
let firstBuildRoot = "";
let secondBuildRoot = "";
let firstBuildIdentity = "";
let secondBuildIdentity = "";
let packageVersion = "";
let controlRoot = "";
let developmentChildLocator = "";
let initialRuntimeReceipt: RuntimeReceipt | undefined;
let sourceBytes: Readonly<Record<string, string>> = {};
let catalogHash = "";

const sha256 = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const createBuildRoot = async (
  changed: boolean,
): Promise<Readonly<{ root: string; id: string }>> => {
  const root = await mkdtemp(join(tmpdir(), "bearing-ticket-08-build-"));
  const portalRoot = join(root, "dist/portal");
  await cp(join(process.cwd(), "dist"), join(root, "dist"), { recursive: true });
  await mkdir(join(root, "skills"));
  if (changed)
    await appendFile(join(portalRoot, "index.html"), "\n<!-- Ticket 08 next build -->\n");
  const manifest = await buildPortalAssetManifest(portalRoot, packageVersion);
  await writePortalAssetManifest(portalRoot, manifest);
  return { root, id: manifest.buildId };
};

const reservePort = async (): Promise<number> => {
  const reservation = createNetServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (address === null || typeof address === "string") throw new Error("No test port available.");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
};

test.beforeAll(async () => {
  packageVersion = (
    JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  fixtureRoot = await realpath(await copyPortalProjectFixture("Ticket 12 Refresh Project"));
  await runBuiltBearing(["provider", "capture", "--repo", fixtureRoot, "--scope", ".scratch/work"]);
  sourceBytes = await readRepositorySourceBytes(fixtureRoot);

  homeRoot = await mkdtemp(join(tmpdir(), "bearing-ticket-12-browser-home-"));
  await writeCatalogFixture(homeRoot, [
    { entryId: "ticket-12-refresh", repoRoot: fixtureRoot, displayName: "Ticket 12 Refresh" },
  ]);
  catalogHash = await sha256(join(homeRoot, ".bearing/catalog.sqlite"));
  const firstBuild = await createBuildRoot(false);
  const secondBuild = await createBuildRoot(true);
  firstBuildRoot = firstBuild.root;
  secondBuildRoot = secondBuild.root;
  firstBuildIdentity = firstBuild.id;
  secondBuildIdentity = secondBuild.id;
  initialRuntimeReceipt = {
    schemaVersion: 1,
    channel: "development",
    runtimeIdentity: `sha256:${"a".repeat(64)}`,
    stateRootIdentity: `sha256:${"7".repeat(64)}`,
    buildIdentity: `sha256:${"8".repeat(64)}`,
    portalBuildId: firstBuildIdentity,
  };
  controlRoot = await mkdtemp(join(tmpdir(), "bearing-ticket-10-browser-supervisor-"));
  developmentChildLocator = join(controlRoot, "development-portal-child.mjs");
  const childBuild = await runHarnessCommand(
    "bun",
    [
      "build",
      join(process.cwd(), "tests/fixtures/development-portal-child-harness.ts"),
      "--target=node",
      "--format=esm",
      `--outfile=${developmentChildLocator}`,
    ],
    {
      cwd: process.cwd(),
      environment: process.env,
      label: "Development Portal child harness build",
    },
  );
  if (childBuild.exitCode !== 0) {
    throw new Error(`Development Portal child harness build failed: ${childBuild.stderr}`);
  }
  await writeFile(join(controlRoot, "publication"), "0\n");
  await writeFile(
    join(controlRoot, "runtime.json"),
    `${JSON.stringify({
      outcome: "resolved",
      receipt: initialRuntimeReceipt,
      packageRoot: firstBuildRoot,
      packageVersion,
      homeDir: homeRoot,
    })}\n`,
  );
  const port = await reservePort();
  const child = spawnHarnessProcess(
    "bun",
    [
      join(process.cwd(), "tests/fixtures/development-portal-supervisor-harness.ts"),
      process.cwd(),
      String(port),
      "0",
      controlRoot,
    ],
    {
      cwd: process.cwd(),
      environment: {
        ...process.env,
        HOME: homeRoot,
        BEARING_TEST_DEVELOPMENT_CHILD_EXECUTABLE: process.execPath,
        BEARING_TEST_DEVELOPMENT_CHILD_LOCATOR: developmentChildLocator,
        BEARING_TEST_DEVELOPMENT_IDENTITY: join(controlRoot, "runtime.json"),
      },
    },
  );
  child.stdin.end();
  host = { child, url: `http://127.0.0.1:${port}` };
  const expectedIdentity = {
    schemaVersion: 1,
    channel: "development",
    runtimeIdentity: initialRuntimeReceipt.runtimeIdentity,
    stateRootIdentity: initialRuntimeReceipt.stateRootIdentity,
    portalBuildIdentity: firstBuildIdentity,
  };
  try {
    await waitForHarnessLine(
      child,
      `Bearing Development Portal current: ${JSON.stringify(expectedIdentity)}`,
      { label: "Development Portal supervisor", timeoutMs: 15_000 },
    );
  } catch (error) {
    await stopBuiltPortal(host);
    host = undefined;
    throw error;
  }
});

test.afterAll(async () => {
  await stopBuiltPortal(host);
  await Promise.all(
    [homeRoot, fixtureRoot, firstBuildRoot, secondBuildRoot, controlRoot]
      .filter((root) => root.length > 0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("real Host keeps Project Activation GET-only across browser lifecycle returns", async ({
  page,
}, testInfo) => {
  if (host === undefined) throw new Error("Ticket 07 real Host did not start.");
  let reads = 0;
  const readSections: string[] = [];
  const writes: string[] = [];
  const bootstrapIdentities: string[] = [];
  let documentRequests = 0;
  let interruptedProviderPosts = 0;
  await page.clock.install({ time: new Date("2026-08-21T12:00:00+08:00") });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === "document") documentRequests += 1;
    if (request.method() === "GET" && url.pathname.endsWith("/read-model")) {
      reads += 1;
      readSections.push(url.searchParams.get("section") ?? "missing");
    }
    if (request.method() !== "GET") writes.push(`${request.method()} ${url.pathname}`);
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/v1/bootstrap") {
      const identity = response.headers()[PORTAL_BUILD_IDENTITY_HEADER.toLowerCase()];
      if (identity !== undefined) bootstrapIdentities.push(identity);
    }
  });

  await page.goto(`${host.url}/projects/ticket-12-refresh`);
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  await expect.poll(() => reads).toBe(1);
  const firstSession = (await page.context().cookies(`${host.url}/api/`)).find(
    (cookie) => cookie.name === "bearing_session",
  )?.value;
  expect(firstSession).toBeDefined();

  await page.clock.fastForward(600_000);
  await page.waitForTimeout(50);
  expect(reads).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => reads).toBe(2);
  await page.locator("main").click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(50);
  expect(reads).toBe(2);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(1_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(50);
  expect(reads).toBe(2);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(300_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => reads).toBe(3);
  await page.locator("main").click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(50);
  expect(reads).toBe(3);

  await page.clock.fastForward(300_000);
  await page.locator("main").click({ position: { x: 4, y: 4 } });
  await expect.poll(() => reads).toBe(4);
  await page.locator("main").click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(50);

  expect(reads).toBe(4);
  expect(writes).toEqual([]);

  await page.route("**/api/v1/projects/ticket-12-refresh/provider-observation", async (route) => {
    interruptedProviderPosts += 1;
    await route.abort("connectionfailed");
  });
  await page.getByRole("button", { name: "Refresh all sources" }).click();
  await page
    .getByRole("dialog", { name: "Refresh all sources" })
    .getByRole("button", { name: "Confirm refresh all sources" })
    .click();
  await expect(page.getByText("Refresh all sources needs attention.")).toBeVisible();
  expect(interruptedProviderPosts).toBe(1);

  if (initialRuntimeReceipt === undefined) {
    throw new Error("Development Runtime receipt is unavailable.");
  }
  const nextRuntimeReceipt = {
    ...initialRuntimeReceipt,
    buildIdentity: `sha256:${"b".repeat(64)}`,
    runtimeIdentity: `sha256:${"c".repeat(64)}`,
    portalBuildId: secondBuildIdentity,
  };
  await writeFile(
    join(controlRoot, "runtime.json"),
    `${JSON.stringify({
      outcome: "resolved",
      receipt: nextRuntimeReceipt,
      packageRoot: secondBuildRoot,
      packageVersion,
      homeDir: homeRoot,
    })}\n`,
  );
  await writeFile(join(controlRoot, "publication"), "coherent-build\n");
  await expect
    .poll(async () => {
      try {
        const value = (await (await fetch(`${host?.url}/healthz`)).json()) as {
          development?: { portalBuildIdentity?: string };
        };
        return value.development?.portalBuildIdentity;
      } catch {
        return undefined;
      }
    })
    .toBe(secondBuildIdentity);
  await page.getByRole("link", { name: "Roadmaps", exact: true }).click();
  await expect.poll(() => bootstrapIdentities).toEqual([firstBuildIdentity, secondBuildIdentity]);
  await expect(page.getByRole("heading", { name: "Roadmaps", level: 1 })).toBeVisible();
  const secondSession = (await page.context().cookies(`${host.url}/api/`)).find(
    (cookie) => cookie.name === "bearing_session",
  )?.value;
  expect(secondSession).toBeDefined();
  expect(secondSession).not.toBe(firstSession);
  expect(documentRequests).toBe(2);
  expect(reads).toBe(6);

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => reads).toBe(7);
  await page.waitForTimeout(50);
  expect(bootstrapIdentities).toEqual([firstBuildIdentity, secondBuildIdentity]);
  expect(documentRequests).toBe(2);
  expect(interruptedProviderPosts).toBe(1);
  expect(writes).toEqual(["POST /api/v1/projects/ticket-12-refresh/provider-observation"]);
  expect(await readRepositorySourceBytes(fixtureRoot)).toEqual(sourceBytes);
  expect(await sha256(join(homeRoot, ".bearing/catalog.sqlite"))).toBe(catalogHash);
  await writeFile(
    await browserArtifactPath(testInfo, "project-activation-receipt.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        host: "foreground-loopback",
        typedReads: reads,
        readSections,
        nonGetRequests: writes.length,
        buildIdentities: bootstrapIdentities,
        documentRequests,
        interruptedProviderPosts,
        providerPostReplays: interruptedProviderPosts - 1,
        sessionReestablished: secondSession !== firstSession,
        sourceBytesPreserved: true,
        catalogBytesPreserved: true,
      },
      null,
      2,
    )}\n`,
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
