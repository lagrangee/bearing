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
      "<!doctype html><html><head><title>G3 prototype</title></head><body><h1>Prototype</h1><p id='state'>Waiting</p><a href='https://example.com'>External destination</a><script src='app.js'></script></body></html>\n",
    ),
    writeFile(
      join(fixtureRoot, "prototypes/demo/app.js"),
      "globalThis.__bearingPrototypeResourceLoaded = true; document.querySelector('#state').textContent = 'Prototype static script loaded';\n",
    ),
    writeFile(
      join(fixtureRoot, "prototypes/demo/server.mjs"),
      "throw new Error('must not run');\n",
    ),
    writeFile(
      join(fixtureRoot, "docs/bundle/README.md"),
      "# G3 bundle README\n\nContained selection.\n\n[External destination](https://example.com)\n",
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
        `  - ID: asset:g3-prototype\n    Title: G3 Prototype\n    Kind: prototype\n    Location: prototypes/demo\n    Owner: effort:fixture\n    Producer:\n      Kind: agent\n      Name: fixture\n    Lifecycle source: registry\n    Disposition: available\n  - ID: asset:g3-bundle\n    Title: G3 Bundle\n    Kind: context\n    Location: docs/bundle\n    Owner: effort:fixture\n    Producer:\n      Kind: agent\n      Name: fixture\n    Lifecycle source: registry\n    Disposition: available\n  - ID: asset:g3-unsupported\n    Title: G3 Unsupported Content\n    Kind: binary\n    Location: docs/bundle/payload.bin\n    Owner: effort:fixture\n    Producer:\n      Kind: agent\n      Name: fixture\n    Lifecycle source: registry\n    Disposition: available\n`,
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

test("prototype stays semantic-only while an ordinary bundle keeps inert View Content", async ({
  context,
  page,
}) => {
  if (host === undefined) throw new Error("Ticket 22 real Host did not start.");
  await page.goto(host.url);
  await page
    .getByRole("list", { name: "Registered Bearing projects" })
    .getByRole("link", { name: /G3 Preview Project/u })
    .click();
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  await page.goto(`${host.url}/projects/g3-preview/assets`);
  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Quick Look/u })).toHaveCount(0);

  await page.getByRole("link", { name: /G3 Prototype/u }).press("Enter");
  await expect(page.getByRole("heading", { name: "G3 Prototype", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /View Content/u })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open Preview/u })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Asset Identity" })).toBeVisible();
  await expect(page.getByText("Kind: prototype.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ownership and Purpose" })).toBeVisible();
  await expect(page.getByText("Produced For: Not declared", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lifecycle" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence Roles" })).toBeVisible();
  await expect(
    page
      .getByLabel("Lineage Context")
      .getByRole("heading", { name: "Planning Citations", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open Technical Details" }).press("Enter");
  const technicalDetails = page.getByRole("complementary", { name: "Technical Details" });
  await expect(technicalDetails.getByText("Preview", { exact: true })).toBeVisible();
  await expect(
    technicalDetails.getByText("Not offered for prototype Assets", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const prototypeRoot = await page.request.get(
    `${host.url}/preview/projects/g3-preview/assets/asset%3Ag3-prototype`,
  );
  expect(prototypeRoot.status()).toBe(404);
  expect(prototypeRoot.headers()["x-bearing-preview-availability"]).toBe("not-offered");
  expect(await prototypeRoot.text()).not.toContain("Prototype static script loaded");
  const prototypeScript = await page.request.get(
    `${host.url}/preview/projects/g3-preview/assets/asset%3Ag3-prototype/resource/app.js`,
  );
  expect(prototypeScript.status()).toBe(404);
  expect(prototypeScript.headers()["x-bearing-preview-availability"]).toBe("not-offered");
  expect(await prototypeScript.text()).not.toContain("__bearingPrototypeResourceLoaded");

  await page.goto(`${host.url}/projects/g3-preview/assets`);
  await page.getByRole("link", { name: /G3 Bundle/u }).click();
  const bundleTab = context.waitForEvent("page");
  await page.getByRole("link", { name: /View Content/u }).click();
  const bundlePage = await bundleTab;
  await expect(bundlePage.getByRole("heading", { name: "G3 Bundle" })).toBeVisible();
  await bundlePage.getByRole("link", { name: "README.md" }).click();
  await expect(bundlePage.getByText("G3 bundle README", { exact: false })).toBeVisible();
  await expect(bundlePage.getByText("current-checkout content", { exact: false })).toBeVisible();
  await expect(bundlePage.getByRole("button", { name: "Return to Asset detail" })).toHaveAttribute(
    "data-bearing-return-href",
    "/projects/g3-preview/lineage/asset/asset%3Ag3-bundle",
  );
  await bundlePage.close();

  await page.goto(`${host.url}/projects/g3-preview/assets`);
  await page.getByRole("link", { name: /G3 Unsupported Content/u }).click();
  const unavailableTab = context.waitForEvent("page");
  await page.getByRole("link", { name: /View Content/u }).click();
  const unavailablePage = await unavailableTab;
  await expect(unavailablePage.getByRole("heading", { name: "Content unavailable" })).toBeVisible();
  await expect(unavailablePage.getByText(/^Impact:/u)).toBeVisible();
  await expect(unavailablePage.getByText(/^Recovery:/u)).toBeVisible();
  await expect(
    unavailablePage.getByRole("button", { name: "Return to Asset detail" }),
  ).toHaveAttribute(
    "data-bearing-return-href",
    "/projects/g3-preview/lineage/asset/asset%3Ag3-unsupported",
  );
  await unavailablePage.close();
});
