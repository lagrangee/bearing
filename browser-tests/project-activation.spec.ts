import { expect, test } from "@playwright/test";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { withRebuiltPlanningLineage } from "../tests/planning-lineage-fixture";

const completedAt = "2026-07-13T20:00:00+08:00";

const projectView = (entryId = "overview", clearAttention = false) => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.summary.validity !== "available") throw new Error("Expected Summary fixture.");
  const projectedSnapshot = clearAttention
    ? withRebuiltPlanningLineage({
        ...snapshot,
        checks: { validity: "available" as const, items: [] },
        reviews: { validity: "available" as const, items: [] },
        diagnostics: [],
        attention: [],
      })
    : snapshot;
  return {
    project: { entryId, displayName: `${entryId} project`, availability: "available" },
    cache: {
      snapshot: { state: "available", snapshot: projectedSnapshot },
      receipt: {
        schemaVersion: 1,
        producer: { packageName: "@lagrangee/bearing", packageVersion: "0.0.0-test" },
        completedAt,
        sitemap: { version: 1, fingerprint: snapshot.basis.sitemapFingerprint },
        reconciliation: "no-op",
      },
      retained: false,
    },
    diagnosticCounts: clearAttention
      ? { blocking: 0, nonBlocking: 0, total: 0 }
      : { blocking: 1, nonBlocking: 0, total: 1 },
  };
};

const readyEnvelope = (entryId = "overview", due = false, clearAttention = false) => ({
  version: 1,
  state: "ready",
  view: projectView(entryId, clearAttention),
  validation: { due, cooldownRemainingMs: due ? 0 : 30_000, inFlight: false },
  session: { csrfToken: `csrf-${entryId}` },
});

const automaticEnvelope = (outcome: "checked" | "materialized" | "synced") => ({
  version: 1,
  state: "completed",
  mode: "ensure-current",
  outcome,
  ...(outcome === "synced" ? { reconciliation: "applied" } : {}),
  snapshotDisposition: outcome === "materialized" ? "materialized" : "reused",
  view: projectView(),
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
});

const forcedEnvelope = () => ({
  version: 1,
  state: "completed",
  mode: "force",
  outcome: "applied",
  reconciliation: "applied",
  snapshotDisposition: "reused",
  view: projectView(),
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
});

test("the entry module establishes an API session before project activation", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/v1/bootstrap", (route) => {
    requests.push("bootstrap");
    return route.fulfill({ json: { version: 1, state: "ready" } });
  });
  await page.route("**/api/v1/projects/overview/snapshot", (route) => {
    requests.push("snapshot");
    return route.fulfill({ json: readyEnvelope() });
  });

  await page.goto("/projects/overview");

  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  expect(requests).toEqual(["bootstrap", "snapshot"]);
});

test("project switch remounts activation and clears project-scoped inspector state", async ({
  page,
}) => {
  const entries: string[] = [];
  await page.route("**/api/v1/projects/*/snapshot", (route) => {
    const segments = new URL(route.request().url()).pathname.split("/");
    const entryId = decodeURIComponent(segments.at(-2) ?? "");
    entries.push(entryId);
    return route.fulfill({ json: readyEnvelope(entryId) });
  });
  await page.goto("/projects/first");
  await expect(
    page.getByRole("link", { name: /Return to Project Catalog from first project/u }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View Project Summary" }).click();
  await expect(page.getByRole("complementary", { name: "Selected context" })).toBeVisible();

  await page.evaluate(() => {
    window.history.pushState({}, "", "/projects/second");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(
    page.getByRole("link", { name: /Return to Project Catalog from second project/u }),
  ).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Selected context" })).toHaveCount(0);
  expect(entries).toEqual(["first", "second"]);
});

test("reload, reconnect, browser return, and inactive interaction reactivate cache checks", async ({
  page,
}) => {
  let reads = 0;
  await page.clock.install({ time: new Date("2026-07-13T20:00:00+08:00") });
  await page.route("**/api/v1/projects/overview/snapshot", (route) => {
    reads += 1;
    return route.fulfill({ json: readyEnvelope() });
  });
  await page.goto("/projects/overview");
  await expect.poll(() => reads).toBe(1);

  const expectReadAfter = async (action: () => Promise<unknown>) => {
    const before = reads;
    await action();
    await expect.poll(() => reads).toBeGreaterThan(before);
  };
  await expectReadAfter(() => page.evaluate(() => window.dispatchEvent(new Event("online"))));
  await expectReadAfter(() =>
    (async () => {
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.clock.fastForward(300_001);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    })(),
  );
  await expectReadAfter(() => page.reload());
  await page.clock.fastForward(300_001);
  await expectReadAfter(() => page.locator("main").click({ position: { x: 4, y: 4 } }));
});

test("visible-only focus does not reactivate project validation", async ({ page }) => {
  let reads = 0;
  const bodies: string[] = [];
  await page.route("**/api/v1/projects/overview/snapshot", (route) => {
    reads += 1;
    return route.fulfill({ json: readyEnvelope("overview", reads > 1) });
  });
  await page.route("**/api/v1/projects/overview/sync", (route) => {
    bodies.push(route.request().postData() ?? "");
    return route.fulfill({ json: automaticEnvelope("checked") });
  });
  await page.goto("/projects/overview");
  await expect.poll(() => reads).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(100);

  expect(reads).toBe(1);
  expect(bodies).toEqual([]);
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("aria-hidden", "false");
  expect(await page.locator("main").getAttribute("inert")).toBeNull();
});

test("brief annotation-like visibility cycle does not reactivate project validation", async ({
  page,
}) => {
  let reads = 0;
  const bodies: string[] = [];
  await page.clock.install({ time: new Date("2026-07-13T20:00:00+08:00") });
  await page.route("**/api/v1/projects/overview/snapshot", (route) => {
    reads += 1;
    return route.fulfill({ json: readyEnvelope("overview", reads > 1) });
  });
  await page.route("**/api/v1/projects/overview/sync", (route) => {
    bodies.push(route.request().postData() ?? "");
    return route.fulfill({ json: automaticEnvelope("checked") });
  });
  await page.goto("/projects/overview");
  await expect.poll(() => reads).toBe(1);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(1_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(100);

  expect(reads).toBe(1);
  expect(bodies).toEqual([]);
  await expect(page.locator("main")).toHaveAttribute("aria-hidden", "false");
  expect(await page.locator("main").getAttribute("inert")).toBeNull();
});

test("the first explicit Sync after inactivity forces reconciliation without an automatic check", async ({
  page,
}) => {
  let reads = 0;
  const bodies: string[] = [];
  await page.clock.install({ time: new Date("2026-07-13T20:00:00+08:00") });
  await page.route("**/api/v1/projects/overview/snapshot", (route) => {
    reads += 1;
    return route.fulfill({ json: readyEnvelope("overview", reads > 1) });
  });
  await page.route("**/api/v1/projects/overview/sync", (route) => {
    bodies.push(route.request().postData() ?? "");
    return route.fulfill({
      json: bodies.at(-1)?.includes('"mode":"force"')
        ? forcedEnvelope()
        : automaticEnvelope("checked"),
    });
  });
  await page.goto("/projects/overview");
  await expect.poll(() => reads).toBe(1);

  const sync = page.getByRole("button", { name: "Sync", exact: true });
  await expect(sync).toBeEnabled();
  await page.clock.fastForward(300_001);
  await sync.click();

  await expect.poll(() => bodies).toEqual([JSON.stringify({ version: 1, mode: "force" })]);
  expect(reads).toBe(1);
});

test("a browser-return click on Sync forces reconciliation before automatic activation", async ({
  page,
}) => {
  let reads = 0;
  let returnReadCompleted = false;
  let releaseReturnRead = () => {};
  const returnReadGate = new Promise<void>((resolve) => {
    releaseReturnRead = resolve;
  });
  const bodies: string[] = [];
  await page.clock.install({ time: new Date("2026-07-13T20:00:00+08:00") });
  await page.route("**/api/v1/projects/overview/snapshot", async (route) => {
    reads += 1;
    if (reads > 1) await returnReadGate;
    await route.fulfill({ json: readyEnvelope("overview", reads > 1) });
    if (reads > 1) returnReadCompleted = true;
  });
  await page.route("**/api/v1/projects/overview/sync", (route) => {
    bodies.push(route.request().postData() ?? "");
    return route.fulfill({
      json: bodies.at(-1)?.includes('"mode":"force"')
        ? forcedEnvelope()
        : automaticEnvelope("checked"),
    });
  });
  await page.goto("/projects/overview");
  await expect.poll(() => reads).toBe(1);
  const sync = page.getByRole("button", { name: "Sync", exact: true });
  const box = await sync.boundingBox();
  if (box === null) throw new Error("Expected the Sync button to have a bounding box.");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(300_001);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".project-operation")).toHaveText("Checking");
  await expect(page.locator(".topbar-sync")).toBeEnabled();
  await expect(page.locator(".topbar-sync svg")).not.toHaveClass(/is-spinning/u);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect.poll(() => bodies).toEqual([JSON.stringify({ version: 1, mode: "force" })]);
  releaseReturnRead();
  await expect.poll(() => returnReadCompleted).toBe(true);
  expect(bodies).toEqual([JSON.stringify({ version: 1, mode: "force" })]);
});

test("a malformed Sync response retains the GET cache and Retry forces reconciliation", async ({
  page,
}) => {
  const bodies: string[] = [];
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({ json: readyEnvelope("overview", true) }),
  );
  await page.route("**/api/v1/projects/overview/sync", (route) => {
    bodies.push(route.request().postData() ?? "");
    return bodies.length === 1
      ? route.fulfill({ contentType: "application/json", body: "not-json" })
      : route.fulfill({ json: forcedEnvelope() });
  });
  await page.goto("/projects/overview");

  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  const banner = page.getByRole("alert");
  await expect(banner).toContainText("Cached project content remains visible");
  await banner.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(banner).toHaveCount(0);
  expect(bodies).toEqual([
    JSON.stringify({ version: 1, mode: "ensure-current" }),
    JSON.stringify({ version: 1, mode: "force" }),
  ]);
});

test("an invalid CSRF session is refreshed once before the automatic check fails", async ({
  page,
}) => {
  let reads = 0;
  const csrfTokens: string[] = [];
  await page.route("**/api/v1/projects/overview/snapshot", (route) => {
    reads += 1;
    return route.fulfill({
      json: {
        ...readyEnvelope("overview", true),
        session: { csrfToken: reads === 1 ? "csrf-stale" : "csrf-current" },
      },
    });
  });
  await page.route("**/api/v1/projects/overview/sync", (route) => {
    csrfTokens.push(route.request().headers()["x-bearing-csrf-token"] ?? "");
    return csrfTokens.length === 1
      ? route.fulfill({
          status: 403,
          json: { code: "invalid-csrf-token", message: "CSRF check failed." },
        })
      : route.fulfill({ json: automaticEnvelope("checked") });
  });

  await page.goto("/projects/overview");

  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".project-operation")).toHaveText("Up to date");
  expect(reads).toBe(2);
  expect(csrfTokens).toEqual(["csrf-stale", "csrf-current"]);
});

test("a typed Sync failure without a view retains the GET cache and exposes Retry", async ({
  page,
}) => {
  const bodies: string[] = [];
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({ json: readyEnvelope("overview", true) }),
  );
  await page.route("**/api/v1/projects/overview/sync", (route) => {
    bodies.push(route.request().postData() ?? "");
    return route.fulfill({
      json:
        bodies.length === 1
          ? {
              version: 1,
              state: "failed",
              mode: "ensure-current",
              outcome: "failed",
              error: {
                code: "snapshot-write-failed",
                message: "Project cache could not be saved.",
              },
              validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
            }
          : forcedEnvelope(),
    });
  });

  await page.goto("/projects/overview");

  const banner = page.getByRole("alert");
  await expect(banner).toContainText("Cached project content remains visible");
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await banner.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(banner).toHaveCount(0);
  expect(bodies).toEqual([
    JSON.stringify({ version: 1, mode: "ensure-current" }),
    JSON.stringify({ version: 1, mode: "force" }),
  ]);
});

test("topbar exposes healthy and unavailable Attention truth", async ({ page }) => {
  let unavailable = false;
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({
      json: unavailable
        ? {
            version: 1,
            state: "unavailable",
            project: {
              entryId: "overview",
              displayName: "overview project",
              availability: "missing",
            },
            diagnostic: { code: "project-missing", message: "The repository is unavailable." },
            session: { csrfToken: "csrf-overview" },
          }
        : readyEnvelope("overview", false, true),
    }),
  );
  await page.goto("/projects/overview");
  await expect(page.locator(".attention-clear")).toContainText("AttentionClear");
  await expect(page.locator(".project-operation")).toHaveText("Checked recently");
  await expect(page.getByRole("region", { name: "Attention" })).toHaveCount(0);

  unavailable = true;
  await page.reload();
  await expect(page.locator(".attention-unavailable")).toContainText("AttentionUnavailable");
  await expect(page.getByRole("heading", { name: "Project is unavailable" })).toBeVisible();
});

test("refresh and reconciliation states settle into a persistent current status", async ({
  page,
}) => {
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({ json: readyEnvelope("overview", true) }),
  );
  await page.route("**/api/v1/projects/overview/sync", (route) => {
    const body = route.request().postData() ?? "";
    return route.fulfill({
      json: body.includes('"mode":"force"') ? forcedEnvelope() : automaticEnvelope("materialized"),
    });
  });
  await page.goto("/projects/overview");

  await expect(page.locator(".project-operation")).toHaveText("Refreshing view");
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await expect(page.locator(".project-operation")).toHaveText("Up to date");
  await page.getByRole("button", { name: "Sync" }).click();
  await expect(page.locator(".project-operation")).toHaveText("Syncing");
  await expect(page.locator(".project-operation")).toHaveText("Updated");
  await expect(page.locator(".project-operation")).toHaveText("Up to date", { timeout: 3_000 });
  await expect(page.getByText(/Last synced|Synced Jul|Synced Never/u)).toHaveCount(0);
});
