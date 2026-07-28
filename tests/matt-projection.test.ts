import { expect, test } from "bun:test";
import { mattPlanningPresentation } from "../src/providers/matt-skills-v1/projection";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

test("derives Matt-owned planning lanes before Portal source decoration", () => {
  const capture = createProjectOverviewFixture().providerCaptures.find(
    (candidate) => candidate.binding.nativeScope === ".scratch/portal",
  );
  if (capture === undefined) throw new Error("Expected the Portal Matt capture.");

  expect(mattPlanningPresentation(capture)).toMatchObject({
    maps: [{ title: "Portal Validation", state: "active", fogCount: 2 }],
    tickets: [
      { title: "Build the Roadmap journey", state: "claimed" },
      { title: "Review the Roadmap journey", state: "ready" },
      { title: "Pass the integration gate", state: "blocked" },
    ],
  });
});
