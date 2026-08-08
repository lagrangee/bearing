import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OverviewPage } from "../src/portal-ui/overview-page";
import type { ProjectGeneration } from "../src/project-generation/contract";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const render = (snapshot: ProjectGeneration): string =>
  renderToStaticMarkup(
    createElement(OverviewPage, {
      entryId: "bearing",
      onNavigate: () => {},
      onOpenRoadmap: () => {},
      snapshot,
    }),
  );

test("renders Brief-first orientation without Guidance or Discovered Work", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.summary.validity !== "available") throw new Error("Expected Summary fixture.");
  const briefSource = `source:${"b".repeat(64)}`;
  const current = {
    ...snapshot,
    summary: {
      validity: "available",
      value: { ...snapshot.summary.value, updatedAt: "2026-08-03T01:02:03Z" },
    },
    brief: {
      validity: "available",
      value: {
        id: "project-brief:current",
        title: "Project Brief",
        generatedAt: "2026-08-03T02:03:04Z",
        projectPurpose: "Keep the whole project visible.",
        currentStage: "The revised reading contract is being delivered.",
        materialAchievedState: "Summary and Brief now have independent lifecycle truth.",
        source: briefSource,
      },
    },
    sources: [
      ...snapshot.sources,
      {
        reference: briefSource,
        kind: "canonical",
        displayLocator: ".bearing/state/project-brief.md",
        binding: { role: "project-brief", identity: "project-brief:current" },
      },
    ],
  } as unknown as ProjectGeneration;

  const html = render(current);

  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain('>Brief</button>');
  expect(html).toContain('aria-selected="false"');
  expect(html).toContain('>Project Summary</button>');
  expect(html).toContain("Generated");
  expect(html).toContain('dateTime="2026-08-03T02:03:04Z"');
  expect(html).not.toContain("Next Work");
  expect(html).not.toContain("Discovered Work");
  expect(html).not.toContain("View Project Summary");
});

test("keeps an absent Brief honest without time, fallback excerpt, or refresh action", () => {
  const html = render(createProjectOverviewFixture());

  expect(html).toContain("Project Brief has not been generated yet.");
  expect(html).not.toContain("Keep the whole project visible.");
  expect(html).not.toContain("Generated");
  expect(html).not.toContain("Refresh");
});
