import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import {
  projectRowEnvelope,
  projectSectionFromRequest,
  projectTargetFromRequest,
} from "./project-row-fixture";

const snapshot = createProjectOverviewFixture();

test("provider observation actions are explicit, costed, contextual, and accessible", async ({
  page,
}) => {
  const posts: unknown[] = [];
  let failure = false;
  let holdAllSources = false;
  let releaseAllSources: (() => void) | undefined;
  await page.route("**/api/v1/projects/refresh/read-model?section=*", (route) => {
    const url = route.request().url();
    return route.fulfill({
      json: projectRowEnvelope({
        snapshot,
        section: projectSectionFromRequest(url),
        target: projectTargetFromRequest(url),
        entryId: "refresh",
      }),
    });
  });
  await page.route("**/api/v1/projects/refresh/provider-observation", async (route) => {
    const request = route.request().postDataJSON();
    posts.push(request);
    const action = request.action as "item-refresh" | "source-load" | "all-sources-refresh";
    if (action === "all-sources-refresh" && holdAllSources) {
      await new Promise<void>((resolve) => {
        releaseAllSources = resolve;
      });
    }
    return route.fulfill({
      json: failure
        ? {
            version: 1,
            state: "attention",
            action,
            condition: "provider-network",
            acquisitionCount: 1,
            observations: [
              {
                scope: ".scratch/portal",
                disposition: "retained-after-failure",
                observedAt: "2026-07-28T00:00:00.000Z",
              },
            ],
            diagnostics: [
              {
                reference: "matt.github.acquisition.network",
                summary: "Source refresh needs Agent Surface attention.",
              },
            ],
            explanation: "The provider network was unavailable for this observation.",
            nextAction: "Open Bearing in the Agent Surface to diagnose provider connectivity.",
          }
        : {
            version: 1,
            state: "completed",
            action,
            acquisitionCount: action === "all-sources-refresh" ? 2 : 1,
            observations: [
              {
                scope: ".scratch/portal",
                disposition: "captured",
                observedAt: "2026-08-08T10:00:00.000Z",
              },
            ],
            diagnostics: [],
          },
    });
  });

  await page.goto("/projects/refresh");
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh all sources" })).toBeVisible();
  expect(posts).toEqual([]);

  await page.getByRole("button", { name: "Refresh all sources" }).click();
  const dialog = page.getByRole("dialog", { name: "Refresh all sources" });
  await expect(dialog).toContainText("every current Work Binding");
  await expect(dialog).toContainText("provider rate limits");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Refresh all sources" })).toBeFocused();
  expect(posts).toEqual([]);

  await page.getByRole("button", { name: "Refresh all sources" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh all sources" })).toBeFocused();
  expect(posts).toEqual([]);

  await page.getByRole("button", { name: "Refresh all sources" }).click();
  holdAllSources = true;
  await dialog.getByRole("button", { name: "Confirm refresh all sources" }).click();
  await expect(page.getByRole("status")).toContainText("Refreshing sources");
  await expect(page.getByRole("button", { name: "Refresh all sources" })).toBeDisabled();
  releaseAllSources?.();
  await expect(page.getByRole("status")).toContainText("2 sources checked");
  await expect(page.getByRole("button", { name: "Refresh all sources" })).toBeFocused();
  expect(posts).toEqual([
    {
      version: 1,
      action: "all-sources-refresh",
      confirmation: "refresh-all-current-sources",
    },
  ]);

  const effortHref = planningLineageSubjectHref("refresh", {
    kind: "effort",
    id: "effort:portal",
  });
  await page.goto(effortHref);
  await expect(page.getByRole("button", { name: "Refresh source" })).toBeVisible();
  await expect(page.getByText("Source status", { exact: true })).toBeVisible();
  await expect(page.getByText("Checked", { exact: true })).toBeVisible();
  await expect(page.getByText("Provider observation", { exact: true })).toHaveCount(0);
  expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: "Refresh source" }).click();
  expect(posts.at(-1)).toEqual({
    version: 1,
    action: "source-load",
    binding: { provider: "matt-skills/v1", nativeScope: ".scratch/portal" },
  });

  const itemHref = planningLineageSubjectHref("refresh", {
    kind: "native-subject",
    id: ".scratch/portal/issues/02-review.md",
  });
  await page.goto(itemHref);
  await expect(page.getByRole("button", { name: "Refresh source" })).toBeVisible();
  await expect(
    page.locator('.source-observation-action time[datetime="2026-07-28T00:00:00.000Z"]'),
  ).toBeVisible();
  await expect(page.locator(".source-observation-action")).not.toContainText(
    "2026-07-28T00:00:00.000Z",
  );
  expect(posts).toHaveLength(2);
  await page.getByRole("button", { name: "Refresh source" }).click();
  expect(posts.at(-1)).toEqual({
    version: 1,
    action: "item-refresh",
    binding: { provider: "matt-skills/v1", nativeScope: ".scratch/portal" },
    subject: ".scratch/portal/issues/02-review.md",
  });

  failure = true;
  await page.getByRole("button", { name: "Refresh source" }).click();
  const attention = page.locator(".source-observation-feedback");
  await expect(attention).toContainText("provider network was unavailable");
  await expect(attention.locator('time[datetime="2026-07-28T00:00:00.000Z"]')).toBeVisible();
  await expect(
    attention.getByText("matt.github.acquisition.network", { exact: true }),
  ).toBeVisible();
  await expect(attention.getByRole("button", { name: "Copy diagnostic reference" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Retry|Repair/u })).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("structural storage and compatibility states only direct the user to Agent Surface", async ({
  page,
}) => {
  for (const [code, expected] of [
    ["project-data-needs-rebuild", "Project data storage requires explicit recovery."],
    ["project-data-needs-update", "This project needs a compatible Bearing runtime."],
  ] as const) {
    await page.route("**/api/v1/projects/structural/read-model?section=overview", (route) =>
      route.fulfill({
        status: 503,
        json: {
          version: 1,
          state: "failed",
          error: { code, message: expected },
          session: { csrfToken: "ticket-12-csrf" },
        },
      }),
    );
    await page.goto("/projects/structural");
    await expect(page.getByText(/Agent Surface/u)).toBeVisible();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy diagnostic reference" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Retry|Repair/u })).toHaveCount(0);
    await page.unroute("**/api/v1/projects/structural/read-model?section=overview");
  }
});

test("settled structural Provider Application states suppress every repeat observation action", async ({
  page,
}) => {
  const effortHref = (entryId: string) =>
    planningLineageSubjectHref(entryId, { kind: "effort", id: "effort:portal" });
  for (const [condition, reference] of [
    ["storage-recovery-required", "project-read-model-recovery-required"],
    ["need-update", "project-read-model-need-update"],
    ["removal-required", "repository-integration-removal-required"],
  ] as const) {
    const entryId = `structural-${condition}`;
    let posts = 0;
    await page.route(`**/api/v1/projects/${entryId}/read-model?section=*`, (route) =>
      route.fulfill({
        json: projectRowEnvelope({
          snapshot,
          section: projectSectionFromRequest(route.request().url()),
          target: projectTargetFromRequest(route.request().url()),
          entryId,
        }),
      }),
    );
    await page.route(`**/api/v1/projects/${entryId}/provider-observation`, (route) => {
      posts += 1;
      return route.fulfill({
        json: {
          version: 1,
          state: "attention",
          action: "source-load",
          condition,
          acquisitionCount: 0,
          observations: [],
          diagnostics: [{ reference, summary: "Source refresh needs Agent Surface attention." }],
          explanation: "This structural condition needs Agent Surface attention.",
          nextAction: "Open Bearing in the Agent Surface to resolve the structural condition.",
        },
      });
    });

    await page.goto(effortHref(entryId));
    await expect(
      page.getByRole("heading", { name: "Web Portal Validation", level: 1 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Refresh source" }).click();
    await expect(page.locator(".source-observation-feedback")).toContainText(reference);
    await expect(page.locator(".source-observation-feedback")).toBeFocused();
    await expect(page.getByRole("button", { name: "Copy diagnostic reference" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Refresh source|Refresh all sources/u }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Retry|Repair/u })).toHaveCount(0);
    expect(posts).toBe(1);

    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
    await expect(page.locator(".source-observation-feedback")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh all sources" })).toHaveCount(0);
    expect(posts).toBe(1);
    await page.unroute(`**/api/v1/projects/${entryId}/read-model?section=*`);
    await page.unroute(`**/api/v1/projects/${entryId}/provider-observation`);
  }
});
