import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { unexpectedStaticRequests } from "./demo-static-boundary";

const walkthrough = (page: Page) =>
  page.getByRole("dialog", { name: "Daily governance walkthrough" });

const next = (page: Page) =>
  walkthrough(page).getByRole("button", { name: /Next|Finish walkthrough/iu });

test("walkthrough follows the fixed daily governance route and supports previous and close", async ({
  page,
}) => {
  await page.goto("./#/overview");
  const trigger = page.getByRole("button", { name: "Start daily governance walkthrough" });
  await page.getByRole("tab", { name: "Project Summary" }).click();
  await expect(page.getByRole("heading", { name: "Purpose", level: 3 })).toBeVisible();
  await trigger.focus();
  await trigger.press("Enter");

  const dialog = walkthrough(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Step 1 of 7", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Current Position", level: 2 })).toBeFocused();
  await expect(page.locator(".walkthrough-target")).toContainText("Current Position");
  await expect(dialog.getByRole("button", { name: "Skip walkthrough" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Explore current page" })).toHaveCount(0);

  const dialogBox = await dialog.boundingBox();
  const previousBox = await dialog.getByRole("button", { name: "Previous step" }).boundingBox();
  const nextBox = await dialog.getByRole("button", { name: "Next step" }).boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(previousBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(previousBox?.x).toBeLessThan((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) / 2);
  expect(nextBox?.x).toBeGreaterThan((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) / 2);

  await next(page).click();
  await expect(page).toHaveURL(/#\/gates\/release-candidate-ready$/u);
  await expect(dialog.getByRole("heading", { name: "Focused Gate and readiness" })).toBeVisible();
  await expect(page.locator(".walkthrough-target")).toContainText("Ready for review");
  await expect(page.locator(".walkthrough-target")).toContainText("Not passed");
  await expect(dialog).toContainText("Ready for review is evidence for a human decision");

  await next(page).click();
  await expect(page).toHaveURL(/#\/attention$/u);
  await expect(page.locator(".walkthrough-target")).toContainText("Needs a human decision");

  await next(page).click();
  await expect(page).toHaveURL(/#\/efforts\/release-packaging$/u);
  await expect(page.locator(".walkthrough-target")).toContainText("Provider evidence");
  await expect(page.locator(".walkthrough-target")).toContainText("Current Work");

  await next(page).click();
  await expect(page).toHaveURL(/#\/native-work\/release-packaging$/u);
  await expect(dialog).toContainText("Can't verify");
  await expect(dialog).toContainText("non-current evidence");
  await expect(page.locator(".walkthrough-target")).toContainText(
    "Verify clean-install release bundle",
  );

  await next(page).click();
  await expect(page).toHaveURL(/#\/assets\/public-beta-readiness-review$/u);
  await expect(page.locator(".walkthrough-target")).toContainText("Planning Use");

  await next(page).click();
  await expect(page).toHaveURL(/#\/lineage\/public-beta-readiness-review$/u);
  await expect(page.locator(".walkthrough-target")).toContainText("Planning Citation");
  await dialog.getByRole("button", { name: "Previous step" }).click();
  await expect(page).toHaveURL(/#\/assets\/public-beta-readiness-review$/u);
  await expect(dialog.getByText("Step 6 of 7", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Close walkthrough" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.goto("./#/efforts/beta-operations");
  const degradedEvidence = page.getByRole("region", { name: "Can't verify" });
  await expect(degradedEvidence).toContainText(
    "The last successful sample evidence is not current",
  );
  await page.goto("./#/reviews/public-beta-release-decision");
  await expect(
    page.getByText("Beta Operations evidence remains stale and cannot contribute to readiness."),
  ).toBeVisible();
});

test("walkthrough traps focus, closes with Escape, restores focus, and permits normal navigation", async ({
  page,
}) => {
  await page.goto("./#/overview");
  const trigger = page.getByRole("button", { name: "Start daily governance walkthrough" });
  await trigger.click();
  const dialog = walkthrough(page);
  const heading = dialog.getByRole("heading", { name: "Current Position", level: 2 });
  const lastControl = dialog.getByRole("button", { name: "Next step" });
  await expect(heading).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastControl).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(heading).toBeFocused();

  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page).toHaveURL(/#\/assets$/u);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/#\/overview$/u);
  await page.goForward();
  await expect(page).toHaveURL(/#\/assets$/u);

  await trigger.click();
  await expect(page).toHaveURL(/#\/overview$/u);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Close walkthrough" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("walkthrough keeps the page available across the navigation breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("./#/overview");
  const trigger = page.getByRole("button", { name: "Start daily governance walkthrough" });
  await trigger.click();
  const dialog = walkthrough(page);

  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(dialog).toBeVisible();
    for (const selector of [".topbar", "#main-content"]) {
      await expect(page.locator(selector)).not.toHaveAttribute("aria-hidden", "true");
      expect(
        await page
          .locator(selector)
          .evaluate((element) => (element instanceof HTMLElement ? element.inert : undefined)),
      ).toBe(false);
    }
    await expect(dialog.getByRole("heading", { name: "Current Position", level: 2 })).toBeFocused();
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("keyboard completes the walkthrough and the linked governance reading path", async ({
  page,
}) => {
  await page.goto("./#/overview");
  const trigger = page.getByRole("button", { name: "Start daily governance walkthrough" });
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = walkthrough(page);

  for (const route of [
    "gates/release-candidate-ready",
    "attention",
    "efforts/release-packaging",
    "native-work/release-packaging",
    "assets/public-beta-readiness-review",
    "lineage/public-beta-readiness-review",
  ]) {
    const control = dialog.getByRole("button", { name: "Next step" });
    await control.focus();
    await control.press("Enter");
    await expect(page).toHaveURL(new RegExp(`#/${route}$`, "u"));
    await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
  }
  const finish = dialog.getByRole("button", { name: "Finish walkthrough" });
  await finish.focus();
  await finish.press("Enter");
  await expect(trigger).toBeFocused();

  const roadmaps = page.getByRole("link", { name: "Roadmaps", exact: true });
  await roadmaps.focus();
  await roadmaps.press("Enter");
  const roadmap = page.getByRole("link", { name: "Public Beta Readiness", exact: true });
  await roadmap.focus();
  await roadmap.press("Enter");
  const gate = page.getByRole("link", { name: "Release candidate ready", exact: true });
  await gate.focus();
  await gate.press("Enter");
  const effort = page.getByRole("link", { name: "Release Packaging", exact: true });
  await effort.focus();
  await effort.press("Enter");
  const nativeWork = page.getByRole("link", { name: /Full work history/iu });
  await nativeWork.focus();
  await nativeWork.press("Enter");

  const find = page.getByRole("button", { name: "Find in project" });
  await find.focus();
  await find.press("Enter");
  const search = page.getByRole("searchbox", {
    name: "Search identity, title, or semantic phrase",
  });
  await search.pressSequentially("release evidence scope");
  await search.press("Enter");
  const preview = page.getByRole("link", { name: "View Content", exact: true });
  await preview.focus();
  await preview.press("Enter");
  const returnToAsset = page.getByRole("link", { name: "Return to Asset detail", exact: true });
  await returnToAsset.focus();
  await returnToAsset.press("Enter");
  await expect(page.getByRole("link", { name: "View Content", exact: true })).toBeFocused();
});

test("walkthrough is responsive, accessible, and understandable with reduced motion", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./#/overview");
    await page.getByRole("button", { name: "Start daily governance walkthrough" }).click();
    const dialog = walkthrough(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-describedby", "walkthrough-purpose");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    for (let step = 1; step <= 7; step += 1) {
      await expect(dialog.getByText(`Step ${step} of 7`, { exact: true })).toBeVisible();
      await expect(page.locator(".walkthrough-target")).toHaveCount(1);
      expect(
        await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
      ).toBe(false);
      if (step < 7) await next(page).click();
    }

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`walkthrough-${width}.png`),
    });
    await next(page).click();
    await expect(dialog).toBeHidden();
    if (width === 360) {
      const menu = page.getByRole("button", { name: "Open navigation" });
      await menu.click();
      const navigation = page.getByRole("navigation", { name: "Project navigation" });
      const close = navigation.getByRole("button", { name: "Close navigation" });
      await expect(close).toBeFocused();
      await close.press("Shift+Tab");
      await expect(navigation.getByRole("link", { name: "Audit", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
    }
  }
});

test("walkthrough and inherited Find, navigation, and Preview stay static and side-effect free", async ({
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
  await page.getByRole("button", { name: "Start daily governance walkthrough" }).click();
  for (let step = 1; step < 7; step += 1) await next(page).click();
  await next(page).click();

  await page.getByRole("button", { name: "Find in project" }).click();
  await page
    .getByRole("searchbox", { name: "Search identity, title, or semantic phrase" })
    .fill("release evidence scope");
  await page.getByRole("option", { name: /Public Beta Readiness Review/iu }).click();
  await expect(page).toHaveURL(/#\/assets\/public-beta-readiness-review$/u);
  await page.getByRole("link", { name: "View Content", exact: true }).click();
  await expect(page.getByText("Pre-rendered bundled sample", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Return to Asset detail", exact: true }).click();

  expect(unexpectedStaticRequests(requests, new URL(page.url()).origin)).toEqual([]);
  await expect(page.locator('script[src*="@vite/client"]')).toHaveCount(0);
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
