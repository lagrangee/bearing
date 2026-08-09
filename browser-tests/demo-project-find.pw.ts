import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Project Find opens from the production-consistent topbar trigger", async ({ page }) => {
  await page.goto("./#/overview");

  const trigger = page.getByRole("button", { name: "Find in project" });
  await trigger.focus();
  await trigger.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Find in project" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("searchbox", { name: "Search identity, title, or semantic phrase" }),
  ).toBeFocused();
});

test("fixed identities, titles, and semantic phrases recall only managed demo subjects", async ({
  page,
}) => {
  await page.goto("./#/overview");
  await page.getByRole("button", { name: "Find in project" }).click();
  const dialog = page.getByRole("dialog", { name: "Find in project" });
  const searchbox = dialog.getByRole("searchbox", {
    name: "Search identity, title, or semantic phrase",
  });

  for (const [query, type, title] of [
    ["pUbLiC bEtA rEaDiNeSs", "Roadmap", "Public Beta Readiness"],
    ["gate:release-candidate-ready", "Gate", "Release candidate ready"],
    ["clean-install release bundle", "Managed native work", "Verify clean-install release bundle"],
    ["release evidence scope", "Asset", "Public Beta Readiness Review"],
    ["dependable Public Beta operations", "Authority", "Reliability & Operations"],
    ["owner acceptance", "Planning Review", "Review the Public Beta release decision"],
    ["current review and accepted history", "Audit", "Planning Audit"],
  ] as const) {
    await searchbox.fill(query);
    const result = dialog
      .getByRole("option")
      .filter({ hasText: title })
      .filter({ hasText: type })
      .first();
    await expect(result).toBeVisible();
    await expect(result).toContainText(type);
  }

  for (const excluded of ["Standalone Release Triage", ".scratch/standalone"]) {
    await searchbox.fill(excluded);
    await expect(dialog.getByRole("option")).toHaveCount(0);
  }
  await expect(
    dialog.getByText("No matches in Bearing-managed scope.", { exact: false }),
  ).toBeVisible();

  await searchbox.fill("effort:release-packaging");
  await dialog.getByRole("option", { name: /Release Packaging/iu }).click();
  await expect(page).toHaveURL(/#\/efforts\/release-packaging$/u);
  await expect(page.getByRole("heading", { name: "Release Packaging", level: 1 })).toBeFocused();
});

test("keyboard, Escape, focus return, reload, back, and forward preserve the Find journey", async ({
  page,
}) => {
  await page.goto("./#/overview");
  const trigger = page.getByRole("button", { name: "Find in project" });
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Find in project" });
  const searchbox = dialog.getByRole("searchbox", {
    name: "Search identity, title, or semantic phrase",
  });
  await searchbox.fill("release");
  const firstActiveId = await searchbox.getAttribute("aria-activedescendant");
  await searchbox.press("ArrowDown");
  const secondActiveId = await searchbox.getAttribute("aria-activedescendant");
  expect(secondActiveId).not.toBe(firstActiveId);
  await expect(dialog.locator(`#${secondActiveId}`)).toHaveAttribute("aria-selected", "true");

  await searchbox.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Close Find" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("option").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close Find" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(searchbox).toHaveValue("release");

  await searchbox.fill("effort:release-packaging");
  await searchbox.press("Enter");
  await expect(page).toHaveURL(/#\/efforts\/release-packaging$/u);
  const heading = page.getByRole("heading", { name: "Release Packaging", level: 1 });
  await expect(heading).toBeFocused();
  await page.reload();
  await expect(heading).toBeVisible();

  await page.goBack();
  await expect(dialog).toBeVisible();
  await expect(searchbox).toBeFocused();
  await expect(searchbox).toHaveValue("effort:release-packaging");
  await page.goForward();
  await expect(dialog).toBeHidden();
  await expect(heading).toBeFocused();
});

test("Find is responsive, accessible, static, and free of persistence or console errors", async ({
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

  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./#/overview");
    await page.getByRole("button", { name: "Find in project" }).click();
    const dialog = page.getByRole("dialog", { name: "Find in project" });
    await dialog
      .getByRole("searchbox", { name: "Search identity, title, or semantic phrase" })
      .fill("release");
    await expect(dialog.getByRole("option")).not.toHaveCount(0);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? width) + (bounds?.width ?? width + 1)).toBeLessThanOrEqual(width);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`project-find-${width}.png`) });
    await page.keyboard.press("Escape");
  }

  const bundleRoot = join(
    import.meta.dirname,
    "../.scratch/bearing-portal-github-demo/evidence/ticket-05/pages-bundle",
  );
  const assetNames = readdirSync(join(bundleRoot, "assets"));
  const staticPaths = new Set([
    "/bearing/",
    ...assetNames.map((name) => `/bearing/assets/${name}`),
  ]);
  expect(
    requests.filter(({ method, url }) => {
      const requestUrl = new URL(url);
      return (
        method !== "GET" ||
        requestUrl.origin !== "http://127.0.0.1:4195" ||
        !staticPaths.has(requestUrl.pathname)
      );
    }),
  ).toEqual([]);
  expect(readdirSync(bundleRoot, { recursive: true }).length).toBeGreaterThanOrEqual(3);
  expect(readFileSync(join(bundleRoot, "index.html"), "utf8")).not.toContain("@vite/client");
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((registrations) => registrations.length),
    ),
  ).toBe(0);
  expect(consoleErrors).toEqual([]);
});
