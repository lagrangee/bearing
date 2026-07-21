import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, test } from "@playwright/test";
import { browserArtifactPath } from "./browser-artifact-output";

const session = { csrfToken: "ticket-10-browser-session" };
const mixedCatalog = {
  version: 1,
  state: "ready",
  session,
  entries: [
    {
      entryId: "available-bearing",
      displayName: "Bearing 控制台",
      repoRoot: "/Users/example/Projects/Bearing Portal",
      availability: "available",
    },
    {
      entryId: "missing-project",
      displayName: "Missing project",
      repoRoot: "/Users/example/Projects/missing-project",
      availability: "missing",
      detail: "The registered repository no longer exists.",
    },
  ],
} as const;

const expectMinimumTarget = async (target: Locator, size: number): Promise<void> => {
  const box = await target.boundingBox();
  if (box === null) throw new Error("Expected an interactive target with rendered bounds.");
  expect(box.width).toBeGreaterThanOrEqual(size);
  expect(box.height).toBeGreaterThanOrEqual(size);
};

test("Catalog selection is keyboard-safe, responsive, and path-opaque", async ({
  page,
}, testInfo) => {
  await page.route("**/api/v1/catalog", (route) => route.fulfill({ json: mixedCatalog }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const available = page.getByRole("button", {
    name: "Bearing 控制台 /Users/example/Projects/Bearing Portal Available",
    exact: true,
  });
  await available.focus();
  await page.keyboard.press("Enter");
  const inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText("Catalog entry", { exact: true })).toBeVisible();
  await expectMinimumTarget(inspector.getByRole("button", { name: "Close selected context" }), 40);
  await expect(inspector.getByRole("link", { name: "Open project" })).toHaveAttribute(
    "href",
    "/projects/available-bearing",
  );
  await page.keyboard.press("Escape");
  await expect(available).toBeFocused();

  await page.keyboard.press("ArrowDown");
  const missing = page.getByRole("button", {
    name: "Missing project /Users/example/Projects/missing-project Repository missing",
    exact: true,
  });
  await expect(missing).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Open project" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "catalog-mixed-1280.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await available.click();
  const narrowInspector = page.getByRole("dialog", { name: "Selected context" });
  await expect(narrowInspector).toBeVisible();
  await expectMinimumTarget(
    narrowInspector.getByRole("button", { name: "Close selected context" }),
    44,
  );
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "catalog-inspector-375.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(available).toBeFocused();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Catalog renders empty and typed failure states", async ({ page }, testInfo) => {
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({ json: { version: 1, state: "ready", entries: [], session } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No registered projects" })).toBeVisible();

  await page.unroute("**/api/v1/catalog");
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      json: {
        version: 1,
        state: "failed",
        entries: [],
        diagnostic: { code: "catalog-invalid", message: "Catalog requires Agent Surface repair." },
        session,
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Catalog needs repair" })).toBeVisible();
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "catalog-failure-1280.png"),
    fullPage: true,
  });
});

test("Catalog rejects a successful response with an invalid Entry ID", async ({ page }) => {
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      json: {
        ...mixedCatalog,
        entries: [{ ...mixedCatalog.entries[0], entryId: "invalid entry" }],
      },
    }),
  );

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Catalog is unavailable" })).toBeVisible();
  await expect(page.getByText("Catalog response does not match version 1.")).toBeVisible();
});

test("Catalog keeps HTTP errors distinct from schema mismatch", async ({ page }) => {
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({ status: 503, json: { message: "upstream detail" } }),
  );

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Catalog is unavailable" })).toBeVisible();
  await expect(page.getByText("Catalog request returned 503.")).toBeVisible();
  await expect(page.getByText("upstream detail")).toHaveCount(0);
});
