import { expect, type Page, test } from "@playwright/test";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { withRebuiltPlanningLineage } from "../tests/planning-lineage-fixture";

const serveSnapshot = async (page: Page, snapshot: ProjectSnapshot): Promise<void> => {
  const view = {
    project: {
      entryId: "guidance-coverage",
      displayName: "Coverage Project",
      availability: "available",
    },
    cache: {
      snapshot: { state: "available", snapshot },
      receipt: {
        schemaVersion: 1,
        producer: { packageName: "@lagrangee/bearing", packageVersion: "0.0.0-test" },
        completedAt: "2026-07-13T20:00:00+08:00",
        sitemap: { version: 1, fingerprint: snapshot.basis.sitemapFingerprint },
        reconciliation: "no-op",
      },
      retained: false,
    },
    diagnosticCounts: { blocking: 0, nonBlocking: 0, total: 0 },
  };
  await page.route("**/api/v1/projects/guidance-coverage/snapshot", (route) =>
    route.fulfill({
      json: {
        version: 1,
        state: "ready",
        view,
        validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
        session: { csrfToken: "coverage-csrf" },
      },
    }),
  );
};

test("Overview presents partial semantic coverage independently from freshness and Attention", async ({
  page,
}) => {
  // Given: trustworthy Guidance is stale and was produced from an incomplete current Audit.
  const fixture = createProjectOverviewFixture();
  if (fixture.guidance.validity !== "available") throw new Error("Expected Guidance fixture.");
  if (fixture.audit.validity !== "available") throw new Error("Expected Audit fixture.");
  const snapshot = projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...fixture,
      checks: { validity: "available", items: [] },
      reviews: { validity: "available", items: [] },
      diagnostics: [],
      attention: [],
      audit: {
        validity: "available",
        value: {
          ...fixture.audit.value,
          coverage: "incomplete",
          skippedTargets: ["roadmap:second"],
        },
      },
      guidance: {
        ...fixture.guidance,
        value: {
          ...fixture.guidance.value,
          semanticCoverage: "partial",
          semanticFreshness: "stale",
        },
      },
    }),
  );
  await serveSnapshot(page, snapshot);

  // When: the user opens Overview through the real browser surface.
  await page.goto("/projects/guidance-coverage");

  // Then: coverage and freshness remain distinct, while recommendations stay readable.
  await expect(page.locator(".guidance-section .truth-note")).toHaveText(
    "Partial project coverage · Guidance may be stale",
  );
  await expect(page.locator(".guidance-section .projection-note")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Attention" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Finish Overview/u })).toBeVisible();
});

test("Overview keeps relation-partial Guidance readable without changing semantic coverage", async ({
  page,
}) => {
  // Given: Guidance prose is trustworthy while its declared Audit relation is unavailable.
  const fixture = createProjectOverviewFixture();
  if (fixture.guidance.validity !== "available") throw new Error("Expected Guidance fixture.");
  const snapshot = projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...fixture,
      checks: { validity: "available", items: [] },
      reviews: { validity: "available", items: [] },
      diagnostics: [],
      attention: [],
      audit: { validity: "absent" },
      guidance: {
        validity: "partial",
        value: fixture.guidance.value,
        issues: [
          {
            code: "unavailable-next-work-guidance-audit-basis",
            target: ".bearing/state/next-work-guidance.md",
            message: "Next Work Guidance depends on an unavailable Planning Audit.",
            source: fixture.guidance.value.source,
          },
        ],
      },
    }),
  );
  await serveSnapshot(page, snapshot);

  // When: the user opens Overview through the same normalized read path.
  await page.goto("/projects/guidance-coverage");

  // Then: projection partiality is separate from coverage and never becomes Attention.
  await expect(page.locator(".guidance-section .projection-note")).toHaveText(
    "Guidance remains readable; 1 projection issue is isolated.",
  );
  await expect(page.locator(".guidance-section .truth-note")).toHaveText("Guidance may be stale");
  await expect(page.locator(".guidance-section .truth-note")).not.toContainText(
    "Partial project coverage",
  );
  await expect(page.getByRole("region", { name: "Attention" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Finish Overview/u })).toBeVisible();
});
