import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { unexpectedStaticRequests } from "./demo-static-boundary";

test("root shows the standalone Northstar Overview", async ({ page }) => {
  await page.goto("./");

  await expect(page).toHaveURL(/\/bearing\/$/u);
  await expect(page.getByRole("heading", { name: "Northstar", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Project Brief", level: 2 })).toBeVisible();
});

test("Overview presents the fixed Northstar governance reading", async ({ page }) => {
  await page.goto("./");

  await expect(page.getByRole("heading", { name: "Current Position", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Established Baseline", level: 3 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Attention" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Active Roadmaps" })).toBeVisible();
  await expect(page.getByText("Public Beta Readiness", { exact: true })).toBeVisible();
  await expect(page.getByText("Customer Trust", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Interactive sample · Mock data · Runs entirely in your browser", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Sample data as of 8 August 2026", { exact: true })).toBeVisible();
  await expect(page.getByText(/Next work/iu)).toHaveCount(0);
});

test("hash navigation, history, reload, modified link, and skip link work statically", async ({
  context,
  page,
}) => {
  await page.goto("./");
  const overviewLink = page.getByRole("link", { name: "Overview", exact: true });

  await overviewLink.click();
  await expect(page).toHaveURL(/\/bearing\/#\/overview$/u);
  await expect(page.getByRole("heading", { name: "Northstar", level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/bearing\/$/u);
  await page.goForward();
  await expect(page).toHaveURL(/#\/overview$/u);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Northstar", level: 1 })).toBeVisible();

  const [modifiedPage] = await Promise.all([
    context.waitForEvent("page"),
    overviewLink.click({ modifiers: ["Meta"] }),
  ]);
  await modifiedPage.waitForLoadState();
  await expect(modifiedPage).toHaveURL(/\/bearing\/#\/overview$/u);
  await expect(modifiedPage.getByRole("heading", { name: "Northstar", level: 1 })).toBeVisible();
  await modifiedPage.close();

  await page.goto("./");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await skipLink.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("Overview keeps the Portal shell readable at desktop and 360px", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./#/overview");

  const desktopNavigation = await page
    .getByRole("navigation", { name: "Project navigation" })
    .boundingBox();
  const desktopMain = await page.locator("#main-content").boundingBox();
  expect(desktopNavigation).not.toBeNull();
  expect(desktopNavigation?.width).toBeGreaterThanOrEqual(200);
  expect(desktopMain?.x).toBeGreaterThanOrEqual(230);
  await page.screenshot({ path: testInfo.outputPath("overview-desktop.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByRole("heading", { name: "Northstar", level: 1 })).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  const mobileMain = await page.locator("#main-content").boundingBox();
  expect(mobileMain?.x).toBe(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Close navigation" }).first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Overview", exact: true })).toHaveCSS(
    "outline-style",
    "solid",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  await expect
    .poll(
      async () =>
        (
          await page
            .getByRole("navigation", { name: "Project navigation", includeHidden: true })
            .boundingBox()
        )?.x,
    )
    .toBeLessThan(-200);
  await page.screenshot({ path: testInfo.outputPath("overview-360.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Overview has no API, external, persistence, telemetry, or console side effects", async ({
  page,
}) => {
  const requests: { method: string; url: string }[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("./#/overview");
  await page.reload();

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
