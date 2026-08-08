import { expect, test } from "@playwright/test";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { projectRowEnvelope } from "./project-row-fixture";

const snapshot = createProjectOverviewFixture();

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
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  expect(requests.filter((request) => request.method === "GET")).toHaveLength(1);
  expect(requests.filter((request) => request.method === "POST")).toEqual([]);
});

test("direct navigation requests only the addressed typed section", async ({ page }) => {
  const sections: string[] = [];
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
  await page.getByRole("link", { name: "Overview", exact: true }).click();
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
    page.getByText("Use the Agent Surface to rebuild project data, then retry."),
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

test("Refresh re-reads rows and does not call the legacy Sync operation", async ({ page }) => {
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

  await page.goto("/projects/overview");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => reads).toBe(2);
  expect(posts).toEqual([]);
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
