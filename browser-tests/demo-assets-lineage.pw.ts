import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { unexpectedStaticRequests } from "./demo-static-boundary";

test("Assets presents eighteen fixed rows and composes simple filters", async ({
  page,
}, testInfo) => {
  await page.goto("./#/assets");

  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
  await expect(page.locator(".asset-row")).toHaveCount(18);
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("assets-desktop.png"), fullPage: true });

  const routes = await page.locator(".asset-row-primary").evaluateAll((links) =>
    links.map((link) => ({
      href: link.getAttribute("href") ?? "",
      title: link.querySelector("strong")?.textContent ?? "",
      owner: link.querySelector(".asset-owner")?.textContent ?? "",
    })),
  );
  for (const route of routes) {
    await page.goto(route.href);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    if (route.href === "#/preview/unavailable") {
      await expect(heading).toHaveText("Preview unavailable");
    } else {
      await expect(heading).toHaveText(route.title);
      for (const detailHeading of [
        "Asset Identity",
        "Ownership and Purpose",
        "Lifecycle",
        "Source",
        "Planning Use",
      ]) {
        await expect(page.getByRole("heading", { name: detailHeading, level: 2 })).toBeVisible();
      }
      await expect(page.getByText(`Asset Owner: ${route.owner}.`, { exact: true })).toBeVisible();
    }
  }

  await page.goto("./#/assets");

  const disposition = page.getByRole("combobox", { name: "Asset disposition" });
  const evidence = page.getByRole("combobox", { name: "Evidence" });
  await disposition.selectOption("superseded");
  await expect(page.locator(".asset-row:not([hidden])")).toHaveCount(2);
  await disposition.selectOption("all");
  await evidence.selectOption("authority-baseline");
  await expect(page.locator(".asset-row:not([hidden])")).toHaveCount(6);
  await evidence.selectOption("cited");
  await expect(page.getByRole("link", { name: /Public Beta Readiness Review/iu })).toBeVisible();
  await evidence.selectOption("authority-baseline");
  await page.getByRole("searchbox", { name: "Search" }).fill("public beta readiness");
  await expect(page.locator(".asset-row:not([hidden])")).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveText("1 of 18 Assets");
  await expect(page.getByRole("link", { name: /Public Beta Readiness Review/iu })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("assets-filtered-desktop.png"),
    fullPage: true,
  });

  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill("no matching asset");
  await expect(page.getByRole("heading", { name: "No matching Assets", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(search).toBeFocused();
  await expect(page.locator(".asset-row:not([hidden])")).toHaveCount(16);
});

test("Gate to Effort to native evidence to Asset, Authority, Preview, and Lineage stays navigable", async ({
  page,
}, testInfo) => {
  await page.goto("./#/gates/release-candidate-ready");
  await page.getByRole("link", { name: "Release Packaging", exact: true }).press("Enter");
  await expect(page).toHaveURL(/#\/efforts\/release-packaging$/u);
  await expect(page.getByRole("heading", { name: "Release Packaging", level: 1 })).toBeFocused();
  await page.getByRole("link", { name: /Full work history/iu }).press("Enter");
  await expect(page).toHaveURL(/#\/native-work\/release-packaging$/u);
  await expect(
    page.getByRole("heading", { name: "Release Packaging native work", level: 1 }),
  ).toBeFocused();
  const asset = page.getByRole("link", { name: "Public Beta Readiness Review", exact: true });
  await asset.press("Enter");
  await expect(page).toHaveURL(/#\/assets\/public-beta-readiness-review$/u);
  await expect(
    page.getByRole("heading", { name: "Public Beta Readiness Review", level: 1 }),
  ).toBeFocused();
  for (const heading of ["Asset Identity", "Ownership and Purpose", "Lifecycle", "Planning Use"]) {
    await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
  }
  await expect(page.getByText("Kind: evidence", { exact: false })).toBeVisible();
  await expect(page.getByText("Disposition: available", { exact: true })).toBeVisible();
  await expect(page.getByText("Lifecycle Source: registry", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source", level: 2 })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Release candidate ready", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Release Packaging", exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("asset-detail-desktop.png"), fullPage: true });

  const authority = page.getByRole("link", { name: "Reliability & Operations", exact: true });
  await authority.focus();
  await authority.press("Enter");
  await expect(page).toHaveURL(/#\/authorities\/reliability-operations$/u);
  await expect(
    page.getByRole("heading", { name: "Reliability & Operations", level: 1 }),
  ).toBeFocused();
  const owners = page.getByRole("region", { name: "Owner boundaries" });
  for (const label of ["Canonical owner", "Tracker owner", "Evidence owner"]) {
    await expect(owners.getByText(label, { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("authority-desktop.png"), fullPage: true });

  await page.goBack();
  await expect(authority).toBeFocused();
  await page.getByRole("link", { name: "View Content", exact: true }).press("Enter");
  await expect(page).toHaveURL(/#\/preview\/public-beta-readiness-review$/u);
  await expect(
    page.getByRole("heading", { name: "Public Beta Readiness Review", level: 1 }),
  ).toBeFocused();
  await expect(page.getByText("Pre-rendered bundled sample", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Validation result", level: 2 })).toBeVisible();
  await expect(page.locator(".preview-document script")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("preview-desktop.png"), fullPage: true });

  const returnToAsset = page.getByRole("link", { name: "Return to Asset detail", exact: true });
  await returnToAsset.press("Enter");
  await expect(page).toHaveURL(/#\/assets\/public-beta-readiness-review$/u);
  await expect(
    page.getByRole("heading", { name: "Public Beta Readiness Review", level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(returnToAsset).toBeFocused();

  await page.getByRole("link", { name: "Open Planning Lineage", exact: true }).press("Enter");
  await expect(page).toHaveURL(/#\/lineage\/public-beta-readiness-review$/u);
  await expect(page.getByRole("heading", { name: "Planning Lineage", level: 1 })).toBeFocused();
  const relations = page.getByRole("region", { name: "Lineage Context" });
  for (const relation of [
    "Asset Owner",
    "Authority Adoption",
    "Planning Citation",
    "Produced For",
    "Passage Evidence",
  ]) {
    await expect(relations.getByRole("heading", { name: relation, level: 3 })).toBeVisible();
  }
  for (const related of [
    "Reliability & Operations",
    "Release candidate ready",
    "Release Packaging",
  ]) {
    await expect(
      relations.getByRole("link", { name: new RegExp(`^${related}`, "u") }),
    ).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("lineage-desktop.png"), fullPage: true });

  await page.goBack();
  await expect(
    page.getByRole("link", { name: "Open Planning Lineage", exact: true }),
  ).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Planning Lineage", level: 1 })).toBeFocused();
});

test("binary, directory, and live prototype previews stay honestly unavailable", async ({
  page,
}) => {
  const cases = [
    [
      "./#/assets/beta-operations-capture",
      "Beta Operations capture",
      "Binary content",
      "Unsupported",
    ],
    [
      "./#/assets/partner-handoff-bundle",
      "Partner handoff bundle",
      "Directory bundle",
      "Preview not offered",
    ],
    [
      "./#/assets/northstar-interaction-sample",
      "Northstar interaction sample",
      "Live prototype",
      "Preview not offered",
    ],
  ] as const;
  await page.goto("./#/assets");
  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
  for (const [route, assetName, heading, status] of cases) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: assetName, level: 1 })).toBeFocused();
    await page.getByRole("link", { name: "Preview unavailable", exact: true }).press("Enter");
    await expect(page).toHaveURL(/#\/preview\/unavailable$/u);
    await expect(
      page.getByRole("heading", { name: "Preview unavailable", level: 1 }),
    ).toBeFocused();
    const region = page.getByRole("region", { name: heading });
    await expect(region.getByText(status, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByText(/No file, directory member, script, or live resource was opened/iu),
  ).toBeVisible();
});

test("Assets journey is responsive, accessible, focused, and network-local", async ({
  page,
}, testInfo) => {
  const requests: { method: string; url: string }[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("./#/assets");
  await expect(page.locator(".asset-row")).toHaveCount(18);
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("assets-360.png"), fullPage: true });

  await page.goto("./#/assets/public-beta-readiness-review");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Public Beta Readiness Review", level: 1 }),
  ).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("asset-detail-360.png"), fullPage: true });

  await page.getByRole("link", { name: "View Content", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Public Beta Readiness Review", level: 1 }),
  ).toBeFocused();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("preview-360.png"), fullPage: true });

  for (const [route, heading, screenshot] of [
    ["./#/authorities/product-experience", "Product Experience", "authority-product-360.png"],
    ["./#/authorities/reliability-operations", "Reliability & Operations", "authority-360.png"],
    ["./#/authorities/data-security", "Data & Security", "authority-data-360.png"],
    ["./#/lineage/public-beta-readiness-review", "Planning Lineage", "lineage-360.png"],
    ["./#/preview/unavailable", "Preview unavailable", "preview-unavailable-360.png"],
  ] as const) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeFocused();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(screenshot), fullPage: true });
  }

  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./#/gates/release-candidate-ready");
    await page.getByRole("link", { name: "Release Packaging", exact: true }).press("Enter");
    await expect(page).toHaveURL(/#\/efforts\/release-packaging$/u);
    await expect(page.getByRole("heading", { name: "Release Packaging", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: /Full work history/iu }).press("Enter");
    await expect(page).toHaveURL(/#\/native-work\/release-packaging$/u);
    await expect(
      page.getByRole("heading", { name: "Release Packaging native work", level: 1 }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Public Beta Readiness Review", exact: true })
      .press("Enter");
    await expect(page).toHaveURL(/#\/assets\/public-beta-readiness-review$/u);
    await expect(
      page.getByRole("heading", { name: "Public Beta Readiness Review", level: 1 }),
    ).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`asset-detail-${width}.png`),
      fullPage: true,
    });
  }

  expect(unexpectedStaticRequests(requests, new URL(page.url()).origin)).toEqual([]);
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((items) => items.length),
    ),
  ).toBe(0);
  expect(consoleErrors).toEqual([]);
});
