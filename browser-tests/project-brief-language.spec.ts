import { expect, test } from "@playwright/test";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";

test("Project Brief applies only authored per-part language metadata", async ({ page }) => {
  // Given: a Chinese Purpose explicitly declares zh-CN while English Current Stage is undeclared.
  const snapshot = createProjectOverviewFixture();
  const briefSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/project-brief.md",
    binding: { role: "project-brief", identity: "project-brief:current" },
  });
  const localizedSnapshot = {
    ...snapshot,
    brief: {
      validity: "available" as const,
      value: {
        id: "project-brief:current" as const,
        title: "Project Brief",
        generatedAt: "2026-07-14T08:00:00Z",
        projectPurpose: "让用户和 agent 每天快速看清 whole project。",
        currentStage: "One read-oriented governance surface.",
        materialAchievedState: "Managed planning remains directly readable.",
        languages: { projectPurpose: "zh-CN" },
        source: briefSource.reference,
      },
    },
    sources: [...snapshot.sources, briefSource],
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
  const currentStage = page.getByText("One read-oriented governance surface.", { exact: true });
  await expect(currentStage).not.toHaveAttribute("lang", /.+/u);
  expect(
    await currentStage.evaluate((element) => element.closest("[lang]")?.getAttribute("lang")),
  ).toBe("en");
});
