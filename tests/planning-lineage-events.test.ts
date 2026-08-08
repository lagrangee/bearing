import { expect, test } from "bun:test";
import {
  latestPlanningLineageEvent,
  planningLineageEventsFor,
} from "../src/portal-ui/planning-lineage-events";
import type { AssetProjection, Roadmap } from "../src/project-snapshot/contract";
import { authoritySchema, planningReviewSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const available = (value: string, precision: "date" | "second" = "second") =>
  ({ availability: "available", value, precision }) as const;

test("retains semantic lifecycle order when event times are unavailable, equal, or reversed", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.roadmaps.validity === "invalid") throw new Error("Expected Roadmaps.");
  const template = snapshot.roadmaps.items[0];
  if (template === undefined) throw new Error("Expected a Roadmap.");
  const roadmap: Roadmap = {
    ...template,
    lifecycle: "completed",
    startedAt: available("2026-07-31T10:00:00Z"),
    completedAt: available("2026-07-31T09:00:00Z"),
  };

  const events = planningLineageEventsFor(snapshot, { kind: "roadmap", id: roadmap.id }, roadmap);

  expect(events.map((event) => event.role)).toEqual(["roadmap.started", "roadmap.completed"]);
  expect(latestPlanningLineageEvent(events)?.role).toBe("roadmap.completed");
});

test("keeps date-only producer time exact and orders Asset roles semantically", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.assets.validity === "invalid") throw new Error("Expected Assets.");
  const template = snapshot.assets.items[0];
  if (template === undefined) throw new Error("Expected an Asset.");
  const asset: AssetProjection = {
    ...template,
    producedAt: available("2026-07-31", "date"),
    registeredAt: available("2026-07-30T09:00:00Z"),
  };

  const events = planningLineageEventsFor(snapshot, { kind: "asset", id: asset.id }, asset);

  expect(events.map((event) => [event.role, event.time])).toEqual([
    ["asset.produced", { availability: "available", value: "2026-07-31", precision: "date" }],
    [
      "asset.registered",
      {
        availability: "available",
        value: "2026-07-30T09:00:00Z",
        precision: "second",
      },
    ],
  ]);
});

test("Authority Adoption reuses Accepted Decision time without inventing an adoption time", () => {
  const snapshot = createProjectOverviewFixture();
  const source = snapshot.sources[0];
  if (source === undefined) throw new Error("Expected a Source.");
  const review = planningReviewSchema.parse({
    id: "planning-review:adopt",
    title: "Adopt",
    source: source.reference,
    citations: [],
    status: "completed",
    question: "Should the project adopt the baseline?",
    scope: { kind: "project" },
    resolution: {
      acceptedDecision: "Adopt it.",
      acceptedAt: available("2026-07-31T09:00:00Z"),
      rationale: "It governs the baseline.",
      changedReferences: ["authority:test"],
    },
  });
  const authority = authoritySchema.parse({
    id: "authority:test",
    title: "Test Authority",
    source: source.reference,
    citations: [],
    scope: "Govern the test.",
    baselineAssetIds: ["asset:planning-model-evidence"],
    adoptions: [
      {
        assetId: "asset:planning-model-evidence",
        decisionReference: review.id,
      },
    ],
  });
  const withReview = {
    ...snapshot,
    reviews: { validity: "available" as const, items: [review] },
  };

  expect(
    planningLineageEventsFor(withReview, { kind: "authority", id: authority.id }, authority),
  ).toEqual([
    {
      role: "authority.adoption",
      label: "Adopted Planning Model Evidence",
      time: available("2026-07-31T09:00:00Z"),
      decisionReference: "planning-review:adopt",
    },
  ]);
});
