import { expect, test } from "bun:test";
import {
  latestPlanningLineageEvent,
  planningLineageEventsFor,
} from "../src/portal-ui/planning-lineage-events";
import type { AssetProjection, Roadmap } from "../src/project-generation/contract";
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

test("keeps the exact Added to Assets time", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.assets.validity === "invalid") throw new Error("Expected Assets.");
  const template = snapshot.assets.items[0];
  if (template === undefined) throw new Error("Expected an Asset.");
  const asset: AssetProjection = {
    ...template,
    addedAt: available("2026-07-31", "date"),
  };

  const events = planningLineageEventsFor(snapshot, { kind: "asset", id: asset.id }, asset);

  expect(events.map((event) => [event.role, event.time])).toEqual([
    ["asset.added", { availability: "available", value: "2026-07-31", precision: "date" }],
  ]);
});
