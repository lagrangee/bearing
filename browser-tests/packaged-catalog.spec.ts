import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { createValidBearingRepo } from "../tests/helpers";
import {
  runHarnessCommand,
  spawnHarnessProcess,
  stopHarnessProcess,
  waitForHarnessLine,
} from "./real-host-test-support";

const evidence = join(process.cwd(), "test-results/packed-portal-evidence");

const reservePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No browser test port.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
};

test("a freshly reconciled repository is selectable through the packed installed Portal", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), "bearing-packaged-browser-"));
  const packDirectory = join(root, "pack");
  const homeDirectory = join(root, "home");
  const repoRoot = await createValidBearingRepo();
  const retainedState = join(root, "retained-state");
  const retainedScratch = join(root, "retained-scratch");
  let portal: ChildProcessWithoutNullStreams | undefined;
  await mkdir(packDirectory);
  await mkdir(homeDirectory);
  const environment = {
    ...process.env,
    HOME: homeDirectory,
    npm_config_cache: join(root, "npm-cache"),
    npm_config_update_notifier: "false",
  };
  let testFailure: unknown;

  try {
    await rename(join(repoRoot, ".bearing/state"), retainedState);
    await rename(join(repoRoot, ".scratch"), retainedScratch);
    await rm(join(repoRoot, ".bearing"), { recursive: true });

    const packed = await runHarnessCommand("npm", ["pack", "--pack-destination", packDirectory], {
      environment,
      label: "npm pack",
      timeoutMs: 30_000,
    });
    expect(packed.exitCode, packed.stderr).toBe(0);
    const filename = packed.stdout.trim().split("\n").at(-1);
    if (filename === undefined || filename.length === 0)
      throw new Error("npm pack returned no file.");
    const tarball = join(packDirectory, filename);

    const installed = await runHarnessCommand(
      "npm",
      [
        "exec",
        "--yes",
        "--offline",
        `--package=${tarball}`,
        "--",
        "bearing",
        "install",
        "--surface",
        "agent-skills",
      ],
      { environment, label: "offline packaged install", timeoutMs: 30_000 },
    );
    expect(installed.exitCode, installed.stderr).toBe(0);

    const installedCli = join(homeDirectory, ".bearing/bin/bearing");
    const reconciled = await runHarnessCommand(
      installedCli,
      [
        "setup",
        "--repo",
        repoRoot,
        "--surface",
        "agent-skills",
        "--provider-contract",
        "docs/agents/issue-tracker.md",
      ],
      { environment, label: "packaged Bearing setup", timeoutMs: 30_000 },
    );
    expect(reconciled.exitCode, reconciled.stderr).toBe(0);
    expect(reconciled.stdout).toContain("Catalog: applied");
    await rename(retainedState, join(repoRoot, ".bearing/state"));
    await rename(retainedScratch, join(repoRoot, ".scratch"));

    const port = await reservePort();
    const runningPortal = spawnHarnessProcess(installedCli, ["portal", "--port", String(port)], {
      environment,
    });
    runningPortal.stdin.end();
    portal = runningPortal;
    await waitForHarnessLine(runningPortal, `Bearing Portal ready: http://127.0.0.1:${port}`, {
      label: "packaged Portal",
      timeoutMs: 15_000,
    });

    const origin = `http://127.0.0.1:${port}`;
    const health = await page.request.get(`${origin}/healthz`);
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({
      state: "ready",
      packageVersion: expect.any(String),
      readModelVersion: expect.any(Number),
    });

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    const catalogResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/v1/catalog",
    );
    await page.goto(`${origin}/`);
    const catalogResponse = await catalogResponsePromise;
    expect(catalogResponse.status()).toBe(200);
    expect(await catalogResponse.json()).toMatchObject({ state: "ready" });
    await expect(page).toHaveTitle("Bearing Portal");
    const fixedAssets = await page
      .locator('script[src], link[rel="stylesheet"][href]')
      .evaluateAll((elements) =>
        elements.map((element) =>
          element instanceof HTMLScriptElement ? element.src : (element as HTMLLinkElement).href,
        ),
      );
    expect(fixedAssets.length).toBeGreaterThan(0);
    for (const assetUrl of fixedAssets) {
      const asset = await page.request.get(assetUrl);
      expect(asset.status(), assetUrl).toBe(200);
      expect(asset.headers()["cache-control"], assetUrl).toContain("immutable");
    }

    const catalog = page.getByRole("list", { name: "Registered Bearing projects" });
    const entry = catalog.getByRole("link", {
      name: new RegExp(`^${basename(repoRoot)} .* Available$`),
    });
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute("href", /^\/projects\/[^/]+$/u);

    const snapshotResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /\/api\/v1\/projects\/[^/]+\/snapshot$/u.test(new URL(response.url()).pathname),
    );
    await entry.click();
    const snapshotResponse = await snapshotResponsePromise;
    expect(snapshotResponse.status()).toBe(200);
    expect(await snapshotResponse.json()).toMatchObject({ state: "ready" });
    await expect(page.getByRole("heading", { name: "Test Project", level: 1 })).toBeVisible();

    const projectNavigation = page.getByRole("navigation", { name: "Project navigation" });
    const destinations = [
      { label: "Roadmaps", heading: "Roadmaps", path: /\/roadmaps$/u },
      { label: "Assets", heading: "Assets", path: /\/assets$/u },
      { label: "Audit", heading: "Planning Audit", path: /\/audit$/u },
      { label: "Overview", heading: "Test Project", path: /\/projects\/[^/]+$/u },
    ] as const;
    for (const destination of destinations) {
      const link = projectNavigation.getByRole("link", {
        name: destination.label,
        exact: true,
      });
      await link.click();
      await expect(page).toHaveURL(destination.path);
      await expect(
        page.getByRole("heading", { name: destination.heading, level: 1 }),
      ).toBeVisible();
      await expect(link).toHaveAttribute("aria-current", "page");
    }

    await projectNavigation.getByRole("link", { name: "Roadmaps", exact: true }).click();
    await page.getByRole("link", { name: "Test Roadmap", exact: true }).click();
    await page.getByRole("link", { name: "Test Effort", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Test Effort", level: 1 })).toBeVisible();
    await expect(
      page.getByLabel("Effort governance status").getByText("Needs attention", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current Work", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh work details" })).toBeVisible();

    const sync = page.getByRole("button", { name: "Sync", exact: true });
    await expect(sync).toBeEnabled();
    const syncResponsePromise = page.waitForResponse((response) => {
      if (
        response.request().method() !== "POST" ||
        !/\/api\/v1\/projects\/[^/]+\/sync$/u.test(new URL(response.url()).pathname)
      ) {
        return false;
      }
      return response.request().postDataJSON()?.mode === "force";
    });
    await sync.click();
    const syncResponse = await syncResponsePromise;
    expect(syncResponse.status()).toBe(200);
    expect(await syncResponse.json()).toMatchObject({ state: "completed", mode: "force" });
    await expect(page.locator(".topbar-sync")).toContainText(/Sync|Updated/u);

    await page.screenshot({
      path: join(evidence, "installed-product-overview-1280.png"),
      fullPage: true,
    });
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);

    await stopHarnessProcess(runningPortal, { label: "packaged Portal" });
    expect(runningPortal.exitCode).toBe(0);
    portal = undefined;
  } catch (error) {
    testFailure = error;
  }
  const cleanupErrors: unknown[] = [];
  if (portal !== undefined) {
    try {
      await stopHarnessProcess(portal, { label: "packaged Portal" });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const target of [repoRoot, root]) {
    try {
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      testFailure === undefined ? cleanupErrors : [testFailure, ...cleanupErrors],
      "Packaged Portal test cleanup failed.",
    );
  }
  if (testFailure !== undefined) throw testFailure;
});
