import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import {
  createAbsentProjectAuditFixture,
  createInvalidProjectAuditFixture,
  createPartialProjectAuditFixture,
  createProjectAuditFixture,
  createUnavailableAuditPromotionFixture,
  createZeroProjectAuditFixture,
} from "../tests/fixtures/project-audit";
import { browserArtifactPath } from "./browser-artifact-output";

const envelope = (snapshot: ProjectSnapshot) => ({
  version: 1,
  state: "ready",
  view: {
    project: { entryId: "audit", displayName: "Audit fixture", availability: "available" },
    cache: {
      snapshot: { state: "available", snapshot },
      receipt: {
        schemaVersion: 1,
        producer: { packageName: "@lagrangee/bearing", packageVersion: "0.0.0-test" },
        completedAt: "2026-07-14T12:00:00+08:00",
        sitemap: { version: 1, fingerprint: snapshot.basis.sitemapFingerprint },
        reconciliation: "no-op",
      },
      retained: false,
    },
    diagnosticCounts: { blocking: 0, nonBlocking: 0, total: 0 },
  },
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
  session: { csrfToken: "ticket-14-csrf" },
});

const serveSnapshot = async (page: Page, current: () => ProjectSnapshot): Promise<void> => {
  await page.route("**/api/v1/projects/audit/snapshot", (route) =>
    route.fulfill({ json: envelope(current()) }),
  );
};

const focusByTab = async (page: Page, target: Locator): Promise<void> => {
  for (let index = 0; index < 50; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => document.activeElement === element)) return;
  }
  throw new Error("Expected target in the document tab order.");
};

const minimumTarget = async (target: Locator, size: number): Promise<void> => {
  const box = await target.boundingBox();
  if (box === null) throw new Error("Expected rendered target bounds.");
  expect(box.width).toBeGreaterThanOrEqual(size);
  expect(box.height).toBeGreaterThanOrEqual(size);
};

const expectClosedNarrowNavigation = async (page: Page): Promise<void> => {
  const navigation = page.locator(".project-nav");
  await expect(navigation).toHaveAttribute("aria-hidden", "true");
  await expect(navigation).toHaveAttribute("inert", "");
  await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "");
};

test("Audit findings preserve advisory truth, decision paths, and display-only provenance", async ({
  page,
}, testInfo) => {
  const snapshot = createProjectAuditFixture();
  const posts: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await serveSnapshot(page, () => snapshot);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/audit");
  await page.getByRole("link", { name: "Audit", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/audit\/audit$/u);

  await expect(page.getByRole("heading", { name: "Planning Audit", level: 1 })).toBeVisible();
  await expect(page.getByText("Stale", { exact: true })).toBeVisible();
  await expect(page.getByText("Incomplete", { exact: true })).toHaveCount(2);
  await expect(page.getByText("authority:architecture", { exact: true })).toBeVisible();
  await expect(page.getByText(/severity|priority|risk/iu)).toHaveCount(0);
  const row = page.getByRole("button", { name: /Portal direction needs a decision path/u });
  await focusByTab(page, row);
  await page.keyboard.press("Enter");
  const inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(
    inspector.getByRole("heading", { name: "Portal direction needs a decision path" }),
  ).toBeVisible();
  await expect(inspector.getByText("alignment-check:portal", { exact: true })).toBeVisible();
  await expect(inspector.getByText("Confirm the Portal revision", { exact: true })).toBeVisible();
  await expect(inspector.getByText("open", { exact: true })).toBeVisible();
  await expect(
    inspector.getByText(".bearing/state/alignment-checks/portal.md", { exact: true }),
  ).toBeVisible();
  await expect(
    inspector.getByText(".bearing/state/roadmaps/portal.md", { exact: false }),
  ).toBeVisible();
  await expect(
    inspector.getByText(/The question should remain visible until the Check is resolved/u),
  ).toBeVisible();
  await expect(
    inspector.getByText(/The Audit does not decide whether the revision is accepted/u),
  ).toBeVisible();
  await expect(inspector.getByRole("link", { name: "Open full detail" })).toHaveAttribute(
    "href",
    "/projects/audit/lineage/alignment-check/alignment-check%3Aportal",
  );
  await expect(
    inspector.getByRole("button", { name: /Resume|Accept|Dismiss|Revise|Generate/iu }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();

  expect(posts).toEqual([]);
  expect(
    (await page.request.get("/api/v1/projects/audit/audit?path=planning-audit.md")).status(),
  ).toBe(404);
  expect((await page.request.get("/.bearing/state/planning-audit.md")).status()).toBe(404);
  await minimumTarget(row, 40);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "audit-findings-1280.png"),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("Audit findings reflow at 200 percent equivalent and narrow modal widths", async ({
  page,
}, testInfo) => {
  const snapshot = createProjectAuditFixture();
  await serveSnapshot(page, () => snapshot);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/projects/audit/audit");

  for (const width of [640, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await expectClosedNarrowNavigation(page);
    await expect(page.getByRole("button", { name: /2 affected references/u })).toBeVisible();
    expect(await page.locator("html").evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(
      false,
    );
    await page.screenshot({
      path: await browserArtifactPath(testInfo, `audit-findings-${width}.png`),
      fullPage: true,
    });
  }

  const row = page.getByRole("button", { name: /Portal direction needs a decision path/u });
  await minimumTarget(row, 44);
  await row.focus();
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog", { name: "Selected context" });
  const close = dialog.getByRole("button", { name: "Close selected context" });
  await expect(close).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await expect(dialog.getByText(/Source source:[0-9a-f]{64}/u).first()).toBeVisible();
  expect(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(false);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("link", { name: "Open full detail" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "audit-finding-inspector-375.png"),
  });
  await dialog.getByRole("heading", { name: "Confidence boundary" }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "audit-finding-evidence-375.png"),
  });
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
});

test("Audit keeps absent, zero, partial, and invalid projection states distinct", async ({
  page,
}) => {
  let snapshot = createAbsentProjectAuditFixture();
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await serveSnapshot(page, () => snapshot);
  await page.goto("/projects/audit/audit");

  await expect(page.getByText("No current Audit", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
  const resume = page.getByRole("button", { name: /Resume Audit in Agent Surface/u });
  await resume.click();
  const inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("button", { name: /Resume in Agent Surface/u })).toHaveCount(0);
  await expect(inspector.locator("a[href]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(resume).toBeFocused();

  snapshot = createZeroProjectAuditFixture();
  await page.reload();
  await expect(page.getByRole("heading", { name: "No material findings" })).toBeVisible();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();

  snapshot = createPartialProjectAuditFixture();
  await page.reload();
  await expect(page.getByText(/Audit orientation is partial/u)).toBeVisible();
  await expect(page.getByText(/1 projection issue is reported separately/u)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Portal direction needs a decision path/u }),
  ).toBeVisible();

  snapshot = createUnavailableAuditPromotionFixture();
  await page.reload();
  await expect(page.getByText(/0 findings resolve to canonical decision paths/u)).toBeVisible();
  await expect(
    page.getByText(/1 declared promotion is unavailable in the current Snapshot/u),
  ).toBeVisible();

  snapshot = createInvalidProjectAuditFixture();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Planning Audit unavailable" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Portal direction needs a decision path/u }),
  ).toHaveCount(0);
  expect(posts).toEqual([]);
});
