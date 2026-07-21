import { expect, test } from "@playwright/test";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";

test("Project Brief applies only authored per-part language metadata", async ({ page }) => {
  // Given: a Chinese Purpose explicitly declares zh-CN while English Current Design is undeclared.
  const snapshot = createProjectOverviewFixture();
  if (snapshot.summary.validity !== "available") throw new Error("Expected Summary fixture.");
  const localizedSnapshot = {
    ...snapshot,
    summary: {
      ...snapshot.summary,
      value: {
        ...snapshot.summary.value,
        purpose: "让用户和 agent 每天快速看清 whole project。",
        languages: { purpose: "zh-CN" },
      },
    },
  };
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({
      json: {
        version: 1,
        state: "ready",
        view: {
          project: { entryId: "overview", displayName: "Bearing", availability: "available" },
          cache: {
            snapshot: { state: "available", snapshot: localizedSnapshot },
            receipt: {
              schemaVersion: 1,
              producer: {
                packageName: "@lagrangee/bearing",
                packageVersion: "0.0.0-test",
              },
              completedAt: "2026-07-14T12:00:00+08:00",
              sitemap: { version: 1, fingerprint: snapshot.basis.sitemapFingerprint },
              reconciliation: "no-op",
            },
            retained: false,
          },
          diagnosticCounts: { blocking: 0, nonBlocking: 0, total: 0 },
        },
        validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
        session: { csrfToken: "language-contract-csrf" },
      },
    }),
  );

  // When: Overview renders the normalized Project Brief.
  await page.goto("/projects/overview");

  // Then: declared Chinese is scoped locally and undeclared English inherits the document language.
  const purpose = page.getByText("让用户和 agent 每天快速看清 whole project。", { exact: true });
  await expect(purpose).toHaveAttribute("lang", "zh-CN");
  const currentDesign = page.getByText("One read-oriented governance surface.", { exact: true });
  await expect(currentDesign).not.toHaveAttribute("lang", /.+/u);
  expect(
    await currentDesign.evaluate((element) => element.closest("[lang]")?.getAttribute("lang")),
  ).toBe("en");
});
