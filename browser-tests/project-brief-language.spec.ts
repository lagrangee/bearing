import { expect, test } from "@playwright/test";
import { createSourceRecord } from "../src/project-generation/source-records";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { projectRowEnvelope } from "./project-row-fixture";

test("Project Brief applies only authored per-part language metadata", async ({ page }) => {
  // Given: a Chinese At a Glance explicitly declares zh-CN while Current Position is undeclared.
  const snapshot = createProjectOverviewFixture();
  const briefSource = createSourceRecord(snapshot.basis.basisFingerprint, {
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
        atAGlance: "让用户和 agent 每天快速看清 whole project。",
        currentPosition: "One read-oriented governance surface.",
        establishedBaseline: ["Managed planning remains directly readable."],
        languages: { atAGlance: "zh-CN" },
        source: briefSource.reference,
      },
    },
    sources: [...snapshot.sources, briefSource],
  };
  await page.route("**/api/v1/projects/overview/read-model?section=overview", (route) =>
    route.fulfill({
      json: projectRowEnvelope({
        snapshot: localizedSnapshot,
        section: "overview",
        entryId: "overview",
        displayName: "Bearing",
      }),
    }),
  );

  // When: Overview renders the normalized Project Brief.
  await page.goto("/projects/overview");

  // Then: declared Chinese is scoped locally and undeclared English inherits the document language.
  const atAGlance = page.getByText("让用户和 agent 每天快速看清 whole project。", {
    exact: true,
  });
  await expect(atAGlance).toHaveAttribute("lang", "zh-CN");
  const currentPosition = page.getByText("One read-oriented governance surface.", {
    exact: true,
  });
  await expect(currentPosition).not.toHaveAttribute("lang", /.+/u);
  expect(
    await currentPosition.evaluate((element) => element.closest("[lang]")?.getAttribute("lang")),
  ).toBe("en");
});
