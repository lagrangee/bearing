import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { copyPortalProjectFixture } from "../tests/fixtures/repository-fixture";
import {
  type RunningTestPortal,
  runBuiltBearing,
  startBuiltPortal,
  stopBuiltPortal,
} from "./real-host-test-support";

let host: RunningTestPortal | undefined;
let homeRoot = "";
let fixtureRoot = "";

test.beforeAll(async () => {
  fixtureRoot = await realpath(await copyPortalProjectFixture("G3 Preview Project"));
  await mkdir(join(fixtureRoot, "prototypes/demo"), { recursive: true });
  await mkdir(join(fixtureRoot, "docs/bundle"), { recursive: true });
  await Promise.all([
    writeFile(
      join(fixtureRoot, "prototypes/demo/index.html"),
      "<!doctype html><html><head><title>G3 prototype</title></head><body><h1>Prototype</h1><p id='state'>Waiting</p><script src='app.js'></script></body></html>\n",
    ),
    writeFile(
      join(fixtureRoot, "prototypes/demo/app.js"),
      "document.querySelector('#state').textContent = 'Prototype static script loaded';\n",
    ),
    writeFile(
      join(fixtureRoot, "prototypes/demo/server.mjs"),
      "throw new Error('must not run');\n",
    ),
    writeFile(
      join(fixtureRoot, "docs/bundle/README.md"),
      "# G3 bundle README\n\nContained selection.\n",
    ),
    writeFile(join(fixtureRoot, "docs/bundle/payload.bin"), "opaque\n"),
  ]);
  const assetsPath = join(fixtureRoot, ".bearing/state/assets.md");
  const assets = await readFile(assetsPath, "utf8");
  await writeFile(
    assetsPath,
    assets.replace(
      "    Lifecycle source: native\n",
      "    Lifecycle source: native\n" +
        `  - ID: asset:g3-prototype\n    Title: G3 Prototype\n    Kind: prototype\n    Location: prototypes/demo\n    Preview entry: index.html\n    Owner: effort:fixture\n    Producer:\n      Kind: agent\n      Name: fixture\n    Lifecycle source: registry\n    Disposition: available\n  - ID: asset:g3-bundle\n    Title: G3 Bundle\n    Kind: context\n    Location: docs/bundle\n    Owner: effort:fixture\n    Producer:\n      Kind: agent\n      Name: fixture\n    Lifecycle source: registry\n    Disposition: available\n`,
    ),
  );
  await runBuiltBearing(["sync", "--repo", fixtureRoot, "--initialize-provider-observations"]);

  homeRoot = await mkdtemp(join(tmpdir(), "bearing-g3-preview-browser-home-"));
  await mkdir(join(homeRoot, ".bearing"), { recursive: true });
  const catalog = {
    version: 1,
    entries: [{ entryId: "g3-preview", repoRoot: fixtureRoot, displayName: "G3 Preview Project" }],
  };
  await Promise.all([
    writeFile(join(homeRoot, ".bearing/catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`),
    writeFile(
      join(homeRoot, ".bearing/catalog.backup.json"),
      `${JSON.stringify(catalog, null, 2)}\n`,
    ),
  ]);
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

test("one real-browser comprehension journey opens a prototype and selects an ordinary bundle file", async ({
  context,
  page,
}) => {
  if (host === undefined) throw new Error("Ticket 22 real Host did not start.");
  await page.goto(host.url);
  await page
    .getByRole("list", { name: "Registered Bearing projects" })
    .getByRole("button", { name: "G3 Preview Project" })
    .click();
  await page.getByRole("link", { name: "Open project" }).click();
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  await page.goto(`${host.url}/projects/g3-preview/assets`);
  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quick Look G3 Prototype" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quick Look G3 Bundle" })).toBeVisible();

  await page.getByRole("button", { name: "Quick Look G3 Prototype" }).click();
  const inspector = page.getByRole("complementary", { name: "Selected context" });
  const prototypeTab = context.waitForEvent("page");
  await inspector.getByRole("link", { name: "Open preview" }).click();
  const prototypePage = await prototypeTab;
  await expect(prototypePage.getByRole("heading", { name: "Prototype" })).toBeVisible();
  await expect(prototypePage.locator("#state")).toHaveText("Prototype static script loaded");
  await expect(prototypePage.locator("aside[data-bearing-preview-notice]")).toContainText(
    "current-checkout",
  );
  await prototypePage.close();

  await page.goto(`${host.url}/preview/projects/g3-preview/assets/asset%3Ag3-bundle`);
  await expect(page.getByRole("heading", { name: "G3 Bundle" })).toBeVisible();
  await page.getByRole("link", { name: "README.md" }).click();
  await expect(page.getByText("G3 bundle README", { exact: false })).toBeVisible();
  await expect(page.getByText("current-checkout content", { exact: false })).toBeVisible();
});
