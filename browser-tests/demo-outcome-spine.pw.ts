import { expect, test } from "@playwright/test";
import { unexpectedStaticRequests } from "./demo-static-boundary";

test("Outcome Spine journey follows the prewritten hash screens", async ({ page }, testInfo) => {
  await page.goto("./#/overview");

  await page.getByRole("link", { name: "Roadmaps", exact: true }).click();
  await expect(page).toHaveURL(/#\/roadmaps$/u);
  await expect(page.getByRole("heading", { name: "Roadmaps", level: 1 })).toBeFocused();
  await expect(
    page.getByRole("link", { name: "Public Beta Readiness", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Collaboration Value", { exact: true })).toBeVisible();
  await expect(page.getByText("Private Alpha Learning", { exact: true })).toBeVisible();
  await expect(page.locator(".roadmap-lifecycle")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("roadmaps-desktop.png"), fullPage: true });

  await page.getByRole("link", { name: "Public Beta Readiness", exact: true }).click();
  await expect(page).toHaveURL(/#\/roadmaps\/public-beta-readiness$/u);
  const outcomeSpine = page.getByRole("region", { name: "Outcome Spine" });
  await expect(outcomeSpine).toBeVisible();
  await expect(outcomeSpine.getByText("Passed", { exact: true }).first()).toBeVisible();
  await expect(outcomeSpine.getByText("Current", { exact: true })).toBeVisible();
  await expect(outcomeSpine.getByText("Planned", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Release candidate ready", exact: true }).click();
  await expect(page).toHaveURL(/#\/gates\/release-candidate-ready$/u);
  const gateHeader = page
    .getByRole("heading", { name: "Release candidate ready", level: 1 })
    .locator("..");
  await expect(gateHeader.getByText(/Ready for review/iu)).toBeVisible();
  await expect(gateHeader.getByText("Not passed", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Intent", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exit Criteria", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contributing Efforts", level: 2 })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("release-gate-desktop.png"), fullPage: true });

  await page.getByRole("link", { name: "Release Packaging", exact: true }).click();
  await expect(page).toHaveURL(/#\/efforts\/release-packaging$/u);
  const effortHeader = page
    .getByRole("heading", { name: "Release Packaging", level: 1 })
    .locator("..");
  await expect(effortHeader.getByText("Effort lifecycle", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider evidence", level: 2 })).toBeVisible();
  await expect(page.getByText("Native-work summary", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current Work", level: 2 })).toBeVisible();

  await page.getByRole("link", { name: /Full work history/iu }).click();
  await expect(page).toHaveURL(/#\/native-work\/release-packaging$/u);
  await expect(page.getByText("Map chapter", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Public Beta release path", level: 3 }),
  ).toBeVisible();
  const workViews = page.getByRole("navigation", { name: "Native Work Frontier views" });
  for (const view of ["Current · 3", "History · 1", "All · 4"]) {
    await expect(workViews.getByRole("link", { name: view, exact: true })).toBeVisible();
  }
  const mapChapter = page.locator(".matt-map-chapter");
  for (const fact of ["Lifecycle", "Fog", "Decisions", "Out of scope"]) {
    await expect(mapChapter.getByText(fact, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Current provider-native work.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Historical provider-native work.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("All work grouped by provider role.", { exact: true })).toHaveCount(
    0,
  );
  for (const role of ["Spec / PRD", "Wayfinder", "Delivery", "Incoming"]) {
    await expect(page.getByText(role, { exact: true }).first()).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("native-work-desktop.png"), fullPage: true });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Release Packaging native work", level: 1 }),
  ).toBeVisible();
});

test("Roadmap fixture exposes ten Gates and twelve Efforts", async ({ page }) => {
  await page.goto("./#/roadmaps");

  await expect(
    page.getByRole("group", { name: "Public Beta Gates" }).locator(".gate-node"),
  ).toHaveCount(4);
  await expect(
    page.getByRole("group", { name: "Collaboration Value Gates" }).locator(".gate-node"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("group", { name: "Private Alpha Gates" }).locator(".gate-node"),
  ).toHaveCount(3);
  expect(
    await page.evaluate(() => {
      const demo = Reflect.get(globalThis, "NORTHSTAR_DEMO") as {
        roadmapEfforts: readonly string[];
      };
      return demo.roadmapEfforts.length;
    }),
  ).toBe(12);

  await page.goto("./#/roadmaps/public-beta-readiness");
  await expect(
    page.getByRole("region", { name: "Outcome Spine" }).getByRole("listitem"),
  ).toHaveCount(10);
});

test("Overview orientation and Attention match the production reading contract", async ({
  page,
}) => {
  await page.goto("./#/overview");

  const briefTab = page.getByRole("tab", { name: "Brief" });
  const summaryTab = page.getByRole("tab", { name: "Project Summary" });
  await expect(briefTab).toHaveAttribute("aria-selected", "true");
  await briefTab.focus();
  await briefTab.press("ArrowRight");
  await expect(summaryTab).toBeFocused();
  await expect(summaryTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Purpose", level: 3 })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Attention" }).getByText("Planning Review"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Attention" }).getByText("Can't verify"),
  ).toHaveCount(0);
});

test("Beta Operations is a fixed degraded evidence screen", async ({ page }, testInfo) => {
  await page.goto("./#/efforts/beta-operations");

  await expect(page.getByRole("heading", { name: "Beta Operations", level: 1 })).toBeVisible();
  const degradedEvidence = page.getByRole("region", { name: "Can't verify" });
  await expect(degradedEvidence).toBeVisible();
  await expect(degradedEvidence.getByText("Stale", { exact: true })).toBeVisible();
  await expect(degradedEvidence.getByText("Latest refresh failed", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("beta-operations-desktop.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByRole("region", { name: "Can't verify" })).toBeVisible();
});

test("keyboard navigation stays local to the static demo", async ({ page }) => {
  const requests: { method: string; url: string }[] = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));

  await page.goto("./#/roadmaps");
  const roadmapLink = page.getByRole("link", { name: "Public Beta Readiness", exact: true });
  await roadmapLink.focus();
  await expect(roadmapLink).toBeFocused();
  await roadmapLink.press("Enter");
  await expect(page).toHaveURL(/#\/roadmaps\/public-beta-readiness$/u);
  await expect(
    page.getByRole("heading", { name: "Public Beta Readiness", level: 1 }),
  ).toBeFocused();

  await page.goBack();
  await expect(roadmapLink).toBeFocused();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Public Beta Readiness", level: 1 }),
  ).toBeFocused();

  const gateLink = page.getByRole("link", { name: "Release candidate ready", exact: true });
  await gateLink.focus();
  await gateLink.press("Enter");
  await expect(page).toHaveURL(/#\/gates\/release-candidate-ready$/u);
  await expect(
    page.getByRole("heading", { name: "Release candidate ready", level: 1 }),
  ).toBeFocused();

  await page.goBack();
  await expect(gateLink).toBeFocused();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Release candidate ready", level: 1 }),
  ).toBeFocused();

  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await skipLink.focus();
  await skipLink.press("Enter");
  await expect(page).toHaveURL(/#\/gates\/release-candidate-ready$/u);
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Release candidate ready", level: 1 }),
  ).toBeVisible();

  expect(unexpectedStaticRequests(requests, new URL(page.url()).origin)).toEqual([]);
});

test("production-aligned shell stays readable at 360px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("./#/roadmaps");

  await expect(page.getByRole("heading", { name: "Roadmaps", level: 1 })).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("roadmaps-360.png"), fullPage: true });

  const menu = page.locator(".mobile-menu");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".topbar")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#main-content")).toHaveAttribute("aria-hidden", "true");
  const navigation = page.getByRole("navigation", { name: "Project navigation" });
  await expect.poll(async () => (await navigation.boundingBox())?.x).toBe(0);
  const close = page.getByRole("button", { name: "Close navigation" }).first();
  await expect(close).toBeFocused();
  await close.press("Shift+Tab");
  await expect(navigation.getByRole("link", { name: "Audit", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(page.locator(".topbar")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#main-content")).not.toHaveAttribute("aria-hidden", "true");

  await menu.click();
  await expect.poll(async () => (await navigation.boundingBox())?.x).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("navigation-360.png"), fullPage: false });
  await navigation.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: "Northstar", level: 1 })).toBeFocused();
});
