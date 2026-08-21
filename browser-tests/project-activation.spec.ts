import { expect, test } from "@playwright/test";
import { PORTAL_BUILD_IDENTITY_HEADER } from "../src/portal-build-identity-wire";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { projectRowEnvelope } from "./project-row-fixture";

const snapshot = createProjectOverviewFixture();
const firstBuildIdentity = "1".repeat(64);
const secondBuildIdentity = "2".repeat(64);

test("a changed Portal Build Identity reloads once and an unchanged identity stays calm", async ({
  page,
}) => {
  let bootstrapReads = 0;
  let projectReads = 0;
  let activeBuildIdentity = firstBuildIdentity;
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests += 1;
  });
  await page.route("**/api/v1/bootstrap", (route) => {
    bootstrapReads += 1;
    return route.fulfill({
      headers: { [PORTAL_BUILD_IDENTITY_HEADER]: activeBuildIdentity },
      json: { version: 1, state: "ready", portalBuildIdentity: activeBuildIdentity },
    });
  });
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) => {
    projectReads += 1;
    return route.fulfill({
      headers: { [PORTAL_BUILD_IDENTITY_HEADER]: activeBuildIdentity },
      json: projectRowEnvelope({ snapshot, section: "overview", entryId: "overview" }),
    });
  });

  await page.goto("/projects/overview");
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  expect({ bootstrapReads, projectReads, documentRequests }).toEqual({
    bootstrapReads: 1,
    projectReads: 1,
    documentRequests: 1,
  });

  activeBuildIdentity = secondBuildIdentity;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => bootstrapReads).toBe(2);
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  expect({ projectReads, documentRequests }).toEqual({ projectReads: 3, documentRequests: 2 });

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => projectReads).toBe(4);
  await page.waitForTimeout(50);
  expect({ bootstrapReads, documentRequests }).toEqual({ bootstrapReads: 2, documentRequests: 2 });
});

test("Project activation reads one typed section and performs no hidden write", async ({
  page,
}) => {
  const requests: { method: string; url: string }[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/projects/overview/")) {
      requests.push({ method: request.method(), url: request.url() });
    }
  });
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) =>
    route.fulfill({
      json: projectRowEnvelope({ snapshot, section: "overview", entryId: "overview" }),
    }),
  );

  await page.goto("/projects/overview");

  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh all sources" })).toBeVisible();
  expect(requests.filter((request) => request.method === "GET")).toHaveLength(1);
  expect(requests.filter((request) => request.method === "POST")).toEqual([]);
});

test("qualified Project Activation events perform one typed GET without hidden writes", async ({
  page,
}) => {
  let reads = 0;
  const writes: string[] = [];
  await page.clock.install({ time: new Date("2026-08-21T10:00:00+08:00") });
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(`${request.method()} ${request.url()}`);
  });
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) => {
    reads += 1;
    return route.fulfill({
      json: projectRowEnvelope({ snapshot, section: "overview", entryId: "overview" }),
    });
  });

  await page.goto("/projects/overview");
  await expect.poll(() => reads).toBe(1);

  await page.clock.fastForward(300_000);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => reads).toBe(2);
  await page.locator("main").click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(50);
  expect(reads).toBe(2);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(1_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(50);
  expect(reads).toBe(2);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(300_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => reads).toBe(3);
  await page.locator("main").click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(50);
  expect(reads).toBe(3);

  await page.clock.fastForward(300_000);
  await page.locator("main").click({ position: { x: 4, y: 4 } });
  await expect.poll(() => reads).toBe(4);
  await page.locator("main").click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(50);

  expect(reads).toBe(4);
  expect(writes).toEqual([]);
});

test("deferred activation deduplicates signals and gives a manual provider action precedence", async ({
  page,
}) => {
  let reads = 0;
  let providerPosts = 0;
  let releaseProvider = () => {};
  const providerGate = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  await page.clock.install({ time: new Date("2026-08-21T11:00:00+08:00") });
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) => {
    reads += 1;
    return route.fulfill({
      json: projectRowEnvelope({ snapshot, section: "overview", entryId: "overview" }),
    });
  });
  await page.route("**/api/v1/projects/overview/provider-observation", async (route) => {
    providerPosts += 1;
    await providerGate;
    return route.fulfill({
      json: {
        version: 1,
        state: "completed",
        action: "all-sources-refresh",
        acquisitionCount: 1,
        observations: [],
        diagnostics: [],
      },
    });
  });

  await page.goto("/projects/overview");
  await expect.poll(() => reads).toBe(1);

  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => reads).toBe(2);

  await page.clock.fastForward(300_000);
  await page.getByRole("button", { name: "Refresh all sources" }).click();
  await page.waitForTimeout(50);
  expect(reads).toBe(2);
  expect(providerPosts).toBe(0);

  await page
    .getByRole("dialog", { name: "Refresh all sources" })
    .getByRole("button", { name: "Confirm refresh all sources" })
    .click();
  await expect.poll(() => providerPosts).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(50);
  expect(reads).toBe(2);

  releaseProvider();
  await expect.poll(() => reads).toBe(3);
  await page.waitForTimeout(50);

  expect(reads).toBe(3);
  expect(providerPosts).toBe(1);
});

test("direct navigation requests only the addressed typed section", async ({ page }) => {
  const sections: string[] = [];
  await page.clock.install({ time: new Date("2026-08-21T13:00:00+08:00") });
  await page.route("**/api/v1/projects/overview/read-model?section=*", (route) => {
    const section = new URL(route.request().url()).searchParams.get("section");
    if (section !== "overview" && section !== "roadmaps") throw new Error("Unexpected section.");
    sections.push(section);
    return route.fulfill({
      json: projectRowEnvelope({ snapshot, section, entryId: "overview" }),
    });
  });

  await page.goto("/projects/overview/roadmaps");
  await expect(page.getByRole("heading", { name: "Roadmaps", level: 1 })).toBeVisible();
  await page.clock.fastForward(300_000);
  const overview = page.getByRole("link", { name: "Overview", exact: true });
  const box = await overview.boundingBox();
  if (box === null) throw new Error("Expected the Overview link to have a bounding box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  expect(sections).toEqual(["roadmaps", "overview"]);
});

test("a failed section change never reuses rows from the prior section", async ({ page }) => {
  await page.route("**/api/v1/projects/overview/read-model?section=*", (route) => {
    const section = new URL(route.request().url()).searchParams.get("section");
    return section === "overview"
      ? route.fulfill({
          json: projectRowEnvelope({ snapshot, section: "overview", entryId: "overview" }),
        })
      : route.fulfill({
          status: 503,
          json: {
            version: 1,
            state: "failed",
            error: { code: "project-read-failed", message: "Project data is unavailable." },
            session: { csrfToken: "ticket-11-csrf" },
          },
        });
  });

  await page.goto("/projects/overview");
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Assets", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Project could not be loaded" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toHaveCount(0);
});

test("typed Project data recovery names the operation that can make progress", async ({ page }) => {
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) =>
    route.fulfill({
      status: 503,
      json: {
        version: 1,
        state: "failed",
        error: {
          code: "project-data-needs-rebuild",
          message: "Project data needs an explicit rebuild.",
        },
        session: { csrfToken: "ticket-11-csrf" },
      },
    }),
  );

  await page.goto("/projects/overview");

  await expect(page.getByRole("heading", { name: "Project could not be loaded" })).toBeVisible();
  await expect(
    page.getByText(
      "Project data storage requires explicit recovery. Use the Agent Surface to review the recovery action.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Use Retry to read this project again.")).toHaveCount(0);
});

test("typed Find recovery requests a compatible runtime", async ({ page }) => {
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) =>
    route.fulfill({
      json: projectRowEnvelope({ snapshot, section: "overview", entryId: "overview" }),
    }),
  );
  await page.route("**/api/v1/projects/overview/find?query=*", (route) =>
    route.fulfill({
      status: 503,
      json: {
        version: 1,
        state: "failed",
        error: {
          code: "project-data-needs-update",
          message: "Project Find needs a compatible Bearing runtime.",
        },
      },
    }),
  );

  await page.goto("/projects/overview");
  await page.getByRole("button", { name: "Find in project" }).click();
  await page.getByRole("searchbox").fill("Gate");

  await expect(page.getByText("Find needs a compatible Bearing runtime.")).toBeVisible();
});

test("explicit all-sources refresh re-reads rows and does not call the legacy Sync operation", async ({
  page,
}) => {
  let reads = 0;
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) => {
    reads += 1;
    return route.fulfill({
      json: projectRowEnvelope({ snapshot, section: "overview", entryId: "overview" }),
    });
  });
  await page.route("**/api/v1/projects/overview/provider-observation", (route) =>
    route.fulfill({
      json: {
        version: 1,
        state: "completed",
        action: "all-sources-refresh",
        acquisitionCount: 1,
        observations: [],
        diagnostics: [],
      },
    }),
  );

  await page.goto("/projects/overview");
  expect(posts).toEqual([]);
  await page.getByRole("button", { name: "Refresh all sources" }).click();
  await page
    .getByRole("dialog", { name: "Refresh all sources" })
    .getByRole("button", { name: "Confirm refresh all sources" })
    .click();
  await expect.poll(() => reads).toBe(2);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toContain("/provider-observation");
  expect(posts[0]).not.toContain("/sync");
});

test("a completed Provider Application result survives a typed-row re-read failure", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) => {
    reads += 1;
    return reads === 1
      ? route.fulfill({
          json: projectRowEnvelope({ snapshot, section: "overview", entryId: "overview" }),
        })
      : route.fulfill({
          status: 503,
          json: {
            version: 1,
            state: "failed",
            error: {
              code: reads === 2 ? "project-read-failed" : "project-data-needs-rebuild",
              message: "Project data is unavailable.",
            },
            session: { csrfToken: "ticket-12-csrf" },
          },
        });
  });
  await page.route("**/api/v1/projects/overview/provider-observation", (route) =>
    route.fulfill({
      json: {
        version: 1,
        state: "completed",
        action: "all-sources-refresh",
        acquisitionCount: 1,
        observations: [],
        diagnostics: [],
      },
    }),
  );

  await page.goto("/projects/overview");
  await page.getByRole("button", { name: "Refresh all sources" }).click();
  await page
    .getByRole("dialog", { name: "Refresh all sources" })
    .getByRole("button", { name: "Confirm refresh all sources" })
    .click();

  await expect(page.getByRole("status")).toContainText("1 source checked");
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("project-read-failed");
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByRole("button", { name: "Copy diagnostic reference" })).toBeVisible();
  await expect(page.getByText("provider observation request did not complete")).toHaveCount(0);

  await page.getByRole("button", { name: "Refresh all sources" }).click();
  await page
    .getByRole("dialog", { name: "Refresh all sources" })
    .getByRole("button", { name: "Confirm refresh all sources" })
    .click();
  await expect.poll(() => reads).toBe(3);
  await expect(page.getByRole("alert")).toContainText("project-data-needs-rebuild");
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByRole("button", { name: "Refresh all sources" })).toHaveCount(0);
});

test("an explicit Provider Application survives same-project navigation and re-reads the current route", async ({
  page,
}) => {
  const sections: string[] = [];
  let releaseProvider: (() => void) | undefined;
  await page.route("**/api/v1/projects/overview/read-model?section=*", (route) => {
    const section = new URL(route.request().url()).searchParams.get("section");
    if (section !== "overview" && section !== "assets") throw new Error("Unexpected section.");
    sections.push(section);
    return route.fulfill({
      json: projectRowEnvelope({ snapshot, section, entryId: "overview" }),
    });
  });
  await page.route("**/api/v1/projects/overview/provider-observation", async (route) => {
    await new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    return route.fulfill({
      json: {
        version: 1,
        state: "completed",
        action: "all-sources-refresh",
        acquisitionCount: 1,
        observations: [],
        diagnostics: [],
      },
    });
  });

  await page.goto("/projects/overview");
  await page.getByRole("button", { name: "Refresh all sources" }).click();
  await page
    .getByRole("dialog", { name: "Refresh all sources" })
    .getByRole("button", { name: "Confirm refresh all sources" })
    .click();
  await expect(page.getByRole("status")).toContainText("Refreshing sources");
  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();

  releaseProvider?.();
  await expect(page.getByRole("status")).toContainText("1 source checked");
  await expect.poll(() => sections).toEqual(["overview", "assets", "assets"]);
  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
});

test("unavailable projects expose a bounded recovery path", async ({ page }) => {
  await page.route("**/api/v1/projects/missing/read-model?section=overview", (route) =>
    route.fulfill({
      json: {
        version: 1,
        state: "unavailable",
        project: { entryId: "missing", displayName: "Missing", availability: "missing" },
        diagnostic: { code: "project-unavailable", message: "Project root is unavailable." },
        session: { csrfToken: "ticket-11-csrf" },
      },
    }),
  );

  await page.goto("/projects/missing");

  await expect(page.getByRole("heading", { name: "Project is unavailable" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Return to Project Catalog", exact: true }),
  ).toHaveAttribute("href", "/");
});
