import { expect, test } from "@playwright/test";
import { createSourceRecord } from "../src/project-generation/source-records";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { projectRowEnvelope } from "./project-row-fixture";

test("Project Brief applies only authored per-part language metadata", async ({ page }) => {
  // Given: a Chinese Purpose explicitly declares zh-CN while English Current Stage is undeclared.
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
        projectPurpose: "让用户和 agent 每天快速看清 whole project。",
        currentStage: "One read-oriented governance surface.",
        materialAchievedState: "Managed planning remains directly readable.",
        languages: { projectPurpose: "zh-CN" },
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
  const purpose = page.getByText("让用户和 agent 每天快速看清 whole project。", { exact: true });
  await expect(purpose).toHaveAttribute("lang", "zh-CN");
  const currentStage = page.getByText("One read-oriented governance surface.", { exact: true });
  await expect(currentStage).not.toHaveAttribute("lang", /.+/u);
  expect(
    await currentStage.evaluate((element) => element.closest("[lang]")?.getAttribute("lang")),
  ).toBe("en");
});
