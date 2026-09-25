import { expect, test } from "bun:test";
import { mattPlanningPresentation } from "../src/providers/matt-skills-v1/projection";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

test("derives Matt-owned planning lanes before Portal source decoration", () => {
  const capture = createProjectOverviewFixture().providerObservations.find(
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

test("does not present a closed Delivery with unavailable completion as ready work", () => {
  const capture = createProjectOverviewFixture().providerObservations.find(
    (candidate) => candidate.binding.nativeScope === ".scratch/portal",
  );
  if (capture === undefined || (capture.state !== "available" && capture.state !== "partial")) {
    throw new Error("Expected the Portal Matt capture.");
  }
  const ticket = capture.projection.deliveryTickets[0];
  if (ticket === undefined) throw new Error("Expected a Delivery ticket.");
  expect(
    mattPlanningPresentation({
      ...capture,
      projection: {
        ...capture.projection,
        graph: { parentChild: [], blockedBy: [] },
        wayfinderTickets: [],
        deliveryTickets: [
          {
            ...ticket,
            lifecycle: { state: "completion-unavailable", reason: "source-contract-gap" },
          },
        ],
      },
    }).tickets,
  ).toMatchObject([{ state: "uncertain" }]);
});
