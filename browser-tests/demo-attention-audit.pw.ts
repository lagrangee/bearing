import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Overview Attention opens its dedicated reading screen", async ({ page }) => {
  await page.goto("./#/overview");

  const attention = page.getByRole("region", { name: "Attention" });
  const review = attention.getByRole("link", {
    name: /Review the Public Beta release decision/iu,
  });
  await review.focus();
  await review.press("Enter");

  await expect(page).toHaveURL(/#\/attention$/u);
  await expect(page.getByRole("heading", { name: "Attention", level: 1 })).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "Project navigation" }).getByRole("link", {
      name: "Overview",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(review).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Attention", level: 1 })).toBeFocused();
});

test("Attention separates fixed reading states and opens one pending Planning Review", async ({
  page,
}, testInfo) => {
  await page.goto("./#/attention");

  const decision = page.getByRole("region", { name: "Needs a human decision" });
  const degraded = page.getByRole("region", { name: "Degraded evidence" });
  const information = page.getByRole("region", { name: "Informational" });
  await expect(decision.getByText("Planning Review", { exact: true })).toBeVisible();
  await expect(degraded.getByText("Can't verify", { exact: true })).toBeVisible();
  await expect(information.getByText("No blocking diagnostics", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("attention-desktop.png"), fullPage: true });

  const review = decision.getByRole("link", {
    name: /Review the Public Beta release decision/iu,
  });
  await review.focus();
  await review.press("Enter");
  await expect(page).toHaveURL(/#\/reviews\/public-beta-release-decision$/u);
  await expect(
    page.getByRole("heading", { name: "Review the Public Beta release decision", level: 1 }),
  ).toBeFocused();
  for (const heading of ["Question", "Scope", "Lifecycle", "Open Context", "Supporting Evidence"]) {
    await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "Lifecycle", level: 2 }).locator("..").getByText("Pending", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Decision boundary.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Portal cannot accept or resolve this Review/iu)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("planning-review-desktop.png"),
    fullPage: true,
  });

  await page.goBack();
  await expect(review).toBeFocused();
});

test("Audit keeps current review, pending decision, and accepted history distinct", async ({
  page,
}, testInfo) => {
  await page.goto("./#/attention");
  const auditLink = page.getByRole("link", { name: "Audit", exact: true });
  await expect(auditLink).toBeVisible();
  await auditLink.click();

  await expect(page).toHaveURL(/#\/audit$/u);
  await expect(page.getByRole("heading", { name: "Planning Audit", level: 1 })).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "Project navigation" }).getByRole("link", {
      name: "Audit",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
  for (const region of [
    "Current Project Review",
    "Decisions Awaiting Attention",
    "Past Accepted Decisions",
  ]) {
    await expect(page.getByRole("region", { name: region })).toBeVisible();
  }

  const pending = page.getByRole("region", { name: "Decisions Awaiting Attention" });
  const pendingReview = pending.getByRole("link", {
    name: "Review the Public Beta release decision",
    exact: true,
  });
  await expect(pendingReview).toHaveAttribute("href", "#/reviews/public-beta-release-decision");

  const history = page.getByRole("region", { name: "Past Accepted Decisions" });
  const times = await history
    .locator("time")
    .evaluateAll((items) => items.map((item) => item.getAttribute("datetime")));
  expect(times).toEqual(["2026-08-08T09:30:00Z", "2026-08-07T16:10:00Z", "2026-08-06T11:00:00Z"]);
  await expect(history.getByText("Gate Passage", { exact: true })).toBeVisible();
  await expect(history.getByText("Human acceptance", { exact: true })).toBeVisible();
  await expect(history.getByText(/Tests and evidence did not pass this Gate/iu)).toBeVisible();
  await expect(history.getByText("Planning Review accepted", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("audit-desktop.png"), fullPage: true });
});

test("Attention and Audit stay accessible, responsive, and local to the static demo", async ({
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
  await page.goto("./#/attention");
  await expect(page.getByText("Can't verify", { exact: true })).toBeVisible();
  await expect(page.getByText("No blocking diagnostics", { exact: true })).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("attention-360.png"), fullPage: true });

  await page.getByRole("button", { name: "Open navigation" }).click();
  const auditLink = page
    .getByRole("navigation", { name: "Project navigation" })
    .getByRole("link", { name: "Audit", exact: true });
  await auditLink.focus();
  await auditLink.press("Enter");
  await expect(page).toHaveURL(/#\/audit$/u);
  await expect(page.getByRole("heading", { name: "Planning Audit", level: 1 })).toBeFocused();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("audit-360.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Planning Audit", level: 1 })).toBeVisible();

  await page.goto("./#/reviews/public-beta-release-decision");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Review the Public Beta release decision", level: 1 }),
  ).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("planning-review-360.png"), fullPage: true });

  const viteEnvironmentPath = new URL("../node_modules/vite/dist/client/env.mjs", import.meta.url)
    .pathname;
  const staticPaths = new Set([
    `/bearing/@fs${viteEnvironmentPath}`,
    "/bearing/@vite/client",
    "/bearing/",
    "/bearing/app.js",
    "/bearing/mock-data.js",
    "/bearing/styles.css",
  ]);
  expect(
    requests.filter(({ method, url }) => {
      const requestUrl = new URL(url);
      return (
        method !== "GET" ||
        requestUrl.origin !== "http://127.0.0.1:4193" ||
        !staticPaths.has(requestUrl.pathname)
      );
    }),
  ).toEqual([]);
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
