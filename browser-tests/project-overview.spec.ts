import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, test } from "@playwright/test";
import { projectGenerationSchema } from "../src/project-generation/schema";
import { createSourceRecord } from "../src/project-generation/source-records";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { browserArtifactPath } from "./browser-artifact-output";
import { projectRowEnvelope } from "./project-row-fixture";

const completedAt = "2026-07-13T20:00:00+08:00";

const expectMinimumTarget = async (target: Locator, size: number): Promise<void> => {
  const box = await target.boundingBox();
  if (box === null) throw new Error("Expected an interactive target with rendered bounds.");
  expect(box.width).toBeGreaterThanOrEqual(size);
  expect(box.height).toBeGreaterThanOrEqual(size);
};

const projectView = () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.summary.validity !== "available") throw new Error("Expected Summary fixture.");
  const briefSource = createSourceRecord(snapshot.basis.basisFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/project-brief.md",
    binding: { role: "project-brief", identity: "project-brief:current" },
  });
  return {
    project: { entryId: "overview", displayName: "Bearing 控制台", availability: "available" },
    cache: {
      snapshot: {
        state: "available",
        snapshot: projectGenerationSchema.parse({
          ...snapshot,
          brief: {
            validity: "available",
            value: {
              id: "project-brief:current",
              title: "Project Brief",
              generatedAt: "2026-07-14T08:00:00Z",
              atAGlance: "Keep the whole project visible.",
              currentPosition: "The revised Overview is being delivered.",
              establishedBaseline: ["Managed planning remains directly readable."],
              source: briefSource.reference,
            },
          },
          summary: {
            ...snapshot.summary,
            value: {
              ...snapshot.summary.value,
              updatedAt: "2026-07-13T20:00:00Z",
              purpose: "让用户和 agent 每天快速看清 whole project。",
            },
          },
          sources: [...snapshot.sources, briefSource],
        }),
      },
      receipt: {
        schemaVersion: 1,
        producer: { packageName: "@lagrangee/bearing", packageVersion: "0.0.0-test" },
        completedAt,
        sitemap: { version: 1, fingerprint: snapshot.basis.basisFingerprint },
        reconciliation: "no-op",
      },
      retained: false,
    },
    diagnosticCounts: { blocking: 1, nonBlocking: 0, total: 1 },
  };
};

const projectGeneration = () => {
  const view = projectView();
  if (view.cache.snapshot.state !== "available") throw new Error("Expected project Snapshot.");
  return view.cache.snapshot.snapshot;
};

const readyEnvelope = (section: "overview" | "roadmaps" = "overview") =>
  projectRowEnvelope({
    snapshot: projectGeneration(),
    section,
    entryId: "overview",
    displayName: "Bearing 控制台",
  });

test("Overview is Brief-first, keeps managed context stable, and stays responsive", async ({
  page,
}, testInfo) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) =>
    route.fulfill({ json: readyEnvelope() }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/overview");

  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await expect(page.locator(".project-switcher code")).toHaveText("Bearing 控制台");
  await expect(page.locator(".project-switcher strong")).toHaveText("Portal Project");
  await expect(page.locator(".topbar-refresh")).toContainText("Refresh all sources");
  const briefTab = page.getByRole("tab", { name: "Brief", exact: true });
  const summaryTab = page.getByRole("tab", { name: "Project Summary", exact: true });
  await expect(briefTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("The revised Overview is being delivered.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('time[datetime="2026-07-14T08:00:00Z"]')).toBeVisible();
  await expect(
    page.getByText("让用户和 agent 每天快速看清 whole project。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active Roadmaps" })).toBeVisible();
  await expect(page.getByText("Next work", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Discovered Work", { exact: false })).toHaveCount(0);
  expect(
    await page
      .locator(".overview-page > *")
      .evaluateAll((elements) => elements.map((element) => element.className)),
  ).toEqual(["project-intro", "attention-queue", "roadmap-landscape"]);
  await summaryTab.click();
  await expect(summaryTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("让用户和 agent 每天快速看清 whole project。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('time[datetime="2026-07-13T20:00:00Z"]')).toBeVisible();
  await expect(page.getByRole("region", { name: "Attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active Roadmaps" })).toBeVisible();
  await summaryTab.press("ArrowLeft");
  await expect(briefTab).toBeFocused();
  await expect(briefTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("main").getByText("Planning Audit", { exact: true })).toHaveCount(0);
  await expect(page.locator("main").getByText("Assets", { exact: true })).toHaveCount(0);
  await expect(page.locator(".roadmap-landscape-item h3")).toHaveText([
    "Second Horizon",
    "Portal Evolution",
  ]);
  await expect(page.getByText("No Gate horizon is available.", { exact: true })).toBeVisible();
  await expectMinimumTarget(briefTab, 40);
  await expectMinimumTarget(summaryTab, 40);
  const firstGate = page.locator(".gate-node").first();
  await expectMinimumTarget(firstGate, 40);
  await firstGate.hover();
  await expect(firstGate.locator(".gate-copy strong")).toHaveCSS(
    "text-decoration-line",
    "underline",
  );
  await page.mouse.move(0, 0);
  expect(posts).toEqual([]);
  await expect(page.locator(".topbar-refresh")).toHaveText("Refresh all sources");
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "overview-1280.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  for (const width of [768, 640, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.waitForTimeout(250);
    await expect(page.locator(".portal-shell")).not.toHaveClass(/nav-open/u);
    const navigationBox = await page.locator("#project-navigation").boundingBox();
    expect(navigationBox === null || navigationBox.x + navigationBox.width <= 0).toBe(true);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    if (width <= 640) {
      const topbar = await page.locator(".topbar").boundingBox();
      if (topbar === null) throw new Error("Expected the narrow topbar.");
      expect(topbar.height).toBeLessThanOrEqual(61);
      await expect(page.locator(".project-switcher")).toBeHidden();
      await expect(page.locator(".project-title-narrow")).toBeVisible();
    }
    await page.screenshot({
      path: await browserArtifactPath(testInfo, `overview-${width}.png`),
      fullPage: true,
    });
  }
  await expectMinimumTarget(briefTab, 44);
  await expectMinimumTarget(summaryTab, 44);
  await expectMinimumTarget(page.locator(".gate-node").first(), 44);
  await expect(page.locator(".updated-date")).toBeHidden();
  const menu = page.getByRole("button", { name: "Open navigation" });
  await menu.click();
  const navigation = page.getByRole("navigation", { name: "Project navigation" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByText("Read only", { exact: true })).toHaveCount(1);
  await expect(navigation.getByRole("link", { name: "Switch project" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(navigation.getByRole("button", { name: "Close navigation" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  const syncBox = await page.getByRole("button", { name: "Refresh all sources" }).boundingBox();
  if (syncBox === null) throw new Error("Expected the mobile source refresh target.");
  expect(syncBox.x + syncBox.width).toBeLessThanOrEqual(365);
});

test("ordinary in-project navigation does not reactivate validation", async ({ page }) => {
  let snapshotReads = 0;
  await page.route("**/api/v1/projects/overview/read-model?section=*", (route) => {
    snapshotReads += 1;
    const section = new URL(route.request().url()).searchParams.get("section");
    return route.fulfill({ json: readyEnvelope(section === "roadmaps" ? "roadmaps" : "overview") });
  });
  await page.goto("/projects/overview");
  await page.getByRole("link", { name: "Roadmaps", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/overview\/roadmaps$/u);
  await expect(page.getByRole("heading", { name: "Roadmaps", level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  expect(snapshotReads).toBe(3);
});

test("invalid and absent semantic projections stay scoped to their Overview sections", async ({
  page,
}) => {
  const view = projectView();
  if (
    view.cache.snapshot.state !== "available" ||
    view.cache.snapshot.snapshot.roadmapIndex.validity !== "available"
  ) {
    throw new Error("Expected available browser fixture.");
  }
  const scopedSnapshot = projectGenerationSchema.parse({
    ...view.cache.snapshot.snapshot,
    summary: {
      validity: "invalid",
      issues: [
        {
          code: "invalid-summary",
          target: "project-summary",
          message: "Summary sections are malformed.",
        },
      ],
    },
    brief: { validity: "absent" },
  });
  const scopedView = {
    ...view,
    cache: {
      ...view.cache,
      snapshot: {
        state: "available",
        snapshot: scopedSnapshot,
      },
    },
  };
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) =>
    route.fulfill({
      json: projectRowEnvelope({
        snapshot: scopedView.cache.snapshot.snapshot,
        section: "overview",
        entryId: "overview",
        displayName: "Bearing 控制台",
      }),
    }),
  );
  await page.goto("/projects/overview");

  await expect(page.getByText("Project Brief has not been generated yet.")).toBeVisible();
  await page.getByRole("tab", { name: "Project Summary", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Project Summary unavailable" })).toBeVisible();
  await expect(page.getByText("Summary sections are malformed.")).toBeVisible();
  await expect(
    page.getByText(/Correct the Project Summary source in Agent Surface/u),
  ).toBeVisible();
  await expect(page.getByText("Next work", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Active Roadmaps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Portal Evolution" })).toBeVisible();
});

test("legacy Summary records omit unavailable Updated time without leaving a placeholder", async ({
  page,
}) => {
  const view = projectView();
  if (
    view.cache.snapshot.state !== "available" ||
    view.cache.snapshot.snapshot.brief.validity !== "available" ||
    view.cache.snapshot.snapshot.summary.validity !== "available"
  ) {
    throw new Error("Expected available orientation fixtures.");
  }
  const { updatedAt: _updatedAt, ...summaryValue } = view.cache.snapshot.snapshot.summary.value;
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) =>
    route.fulfill({
      json: projectRowEnvelope({
        snapshot: {
          ...view.cache.snapshot.snapshot,
          summary: { validity: "available", value: summaryValue },
        },
        section: "overview",
        entryId: "overview",
        displayName: "Bearing 控制台",
      }),
    }),
  );
  await page.goto("/projects/overview");

  await expect(page.getByText("Generated", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Project Summary", exact: true }).click();
  await expect(page.getByText("Updated", { exact: true })).toHaveCount(0);
  await expect(page.locator(".orientation-time")).toHaveCount(0);
});
