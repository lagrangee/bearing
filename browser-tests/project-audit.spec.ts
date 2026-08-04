import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import {
  createAbsentProjectAuditFixture,
  createInvalidProjectAuditFixture,
  createMissingGeneratedTimeAuditFixture,
  createPartialProjectAuditFixture,
  createProjectAuditFixture,
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
  session: { csrfToken: "ticket-39-csrf" },
});

const serveSnapshot = async (page: Page, current: () => ProjectSnapshot): Promise<void> => {
  await page.route("**/api/v1/projects/audit/snapshot", (route) =>
    route.fulfill({ json: envelope(current()) }),
  );
};

const minimumTarget = async (target: Locator, size: number): Promise<void> => {
  const box = await target.boundingBox();
  if (box === null) throw new Error("Expected rendered target bounds.");
  expect(box.width).toBeGreaterThanOrEqual(size);
  expect(box.height).toBeGreaterThanOrEqual(size);
};

test("Audit is findings-first and a promoted finding navigates directly", async ({
  page,
}, testInfo) => {
  const snapshot = createProjectAuditFixture();
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await serveSnapshot(page, () => snapshot);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/audit/audit");

  await expect(page.getByRole("heading", { name: "Planning Audit", level: 1 })).toBeVisible();
  await expect(page.getByText("Stale", { exact: true })).toBeVisible();
  await expect(page.getByText("1 finding", { exact: true })).toBeVisible();
  const findings = page.getByRole("region", { name: "Findings" });
  await expect(findings.getByText("Severity", { exact: true })).toHaveCount(0);
  await expect(findings.getByText("2 affected references", { exact: true })).toBeVisible();
  await expect(
    findings.getByText("The question should remain visible until the Check is resolved."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Incomplete coverage" })).toBeVisible();
  await expect(page.getByText("authority:architecture", { exact: true })).toBeVisible();
  await expect(page.getByText("Advisory snapshot", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Decision truth", { exact: true })).toHaveCount(0);

  const target = findings.getByRole("link", { name: /Portal direction needs a decision path/u });
  await expect(target).toHaveAttribute(
    "href",
    "/projects/audit/lineage/alignment-check/alignment-check%3Aportal",
  );
  await minimumTarget(target, 40);
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "audit-findings-1280.png"),
    fullPage: true,
  });
  await target.click();
  await expect(page).toHaveURL(
    /\/projects\/audit\/lineage\/alignment-check\/alignment-check%3Aportal$/u,
  );
  await expect(page.getByRole("heading", { name: "Confirm the Portal revision" })).toBeVisible();

  expect(posts).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Audit distinguishes complete, incomplete, partial, absent, and invalid states", async ({
  page,
}) => {
  let snapshot = createZeroProjectAuditFixture();
  await serveSnapshot(page, () => snapshot);
  await page.goto("/projects/audit/audit");

  await expect(page.getByText("Complete coverage", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No findings" })).toBeVisible();
  await expect(page.getByText("Skipped scope", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Projection issues", { exact: true })).toHaveCount(0);

  snapshot = createProjectAuditFixture();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Incomplete coverage" })).toBeVisible();
  await expect(page.getByText("Skipped scope", { exact: true })).toBeVisible();
  await expect(page.getByText("Projection issues", { exact: true })).toHaveCount(0);

  snapshot = createPartialProjectAuditFixture();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Partial projection" })).toBeVisible();
  await expect(page.getByText("Projection issues", { exact: true })).toBeVisible();
  await expect(page.getByText(/Some Audit material could not be projected/u)).toBeVisible();
  await expect(
    page.getByText(/Correct the reported source and run Planning Audit again/u),
  ).toBeVisible();

  snapshot = createAbsentProjectAuditFixture();
  await page.reload();
  await expect(page.getByRole("heading", { name: "No current Audit" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Resume Audit/u })).toHaveCount(0);

  snapshot = createInvalidProjectAuditFixture();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Planning Audit unavailable" })).toBeVisible();
  await expect(page.getByText("Generated time unavailable", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Recovery", { exact: true })).toBeVisible();

  snapshot = createMissingGeneratedTimeAuditFixture();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Planning Audit unavailable" })).toBeVisible();
  await expect(page.getByText("Generated time unavailable", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Generated", { exact: true })).toHaveCount(0);
});

test("Audit findings remain readable and directly navigable at narrow widths", async ({
  page,
}, testInfo) => {
  const snapshot = createProjectAuditFixture();
  await serveSnapshot(page, () => snapshot);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/projects/audit/audit");

  const target = page.getByRole("link", { name: /Portal direction needs a decision path/u });
  await minimumTarget(target, 44);
  await expect(target).toBeVisible();
  expect(await page.locator("html").evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(
    false,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "audit-findings-375.png"),
    fullPage: true,
  });
});
