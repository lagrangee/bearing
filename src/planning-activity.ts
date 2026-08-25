import type { DatabaseSync } from "node:sqlite";
import { Temporal } from "@js-temporal/polyfill";
import { effortSchema, gateSchema, roadmapSchema } from "./project-generation/schema";
import {
  type ActivityInspectResult,
  activityInspectResultSchema,
  planningActivityIntervalSchema,
} from "./project-read-model/contract";
import type { SourceEventTime } from "./source-event-time";

export type PlanningActivityInterval = Readonly<{
  date: string;
  timeZone: string;
  startInclusive: string;
  endExclusive: string;
}>;

export const planningActivityInterval = (
  date: string,
  timeZone: string,
): PlanningActivityInterval => {
  const localDate = Temporal.PlainDate.from(date);
  const start = localDate.toZonedDateTime(timeZone).toInstant();
  const end = localDate.add({ days: 1 }).toZonedDateTime(timeZone).toInstant();
  return planningActivityIntervalSchema.parse({
    date,
    timeZone,
    startInclusive: start.toString(),
    endExclusive: end.toString(),
  });
};

type AvailableSourceEventTime = Extract<SourceEventTime, { availability: "available" }>;
type GovernanceEvent = Readonly<{
  reference: string;
  currentTitle: string;
  event:
    | "roadmap-started"
    | "roadmap-completed"
    | "roadmap-superseded"
    | "gate-planned"
    | "gate-activated"
    | "gate-passed"
    | "gate-superseded"
    | "effort-planned"
    | "effort-activated"
    | "effort-concluded";
  occurredAt: AvailableSourceEventTime;
}>;

const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") throw new Error("Project Read Model payload is missing.");
  return JSON.parse(value);
};

const occurredInside = (
  time: SourceEventTime | undefined,
  interval: PlanningActivityInterval,
): time is AvailableSourceEventTime =>
  time?.availability === "available" &&
  Temporal.Instant.compare(time.value, interval.startInclusive) >= 0 &&
  Temporal.Instant.compare(time.value, interval.endExclusive) < 0;

const event = (
  reference: string,
  currentTitle: string,
  role: GovernanceEvent["event"],
  time: SourceEventTime | undefined,
  interval: PlanningActivityInterval,
): readonly GovernanceEvent[] =>
  occurredInside(time, interval)
    ? [{ reference, currentTitle, event: role, occurredAt: time }]
    : [];

const committedObjects = (
  database: DatabaseSync,
  kind: "roadmap" | "gate" | "effort",
): readonly unknown[] =>
  database
    .prepare("SELECT payload_json FROM project_objects WHERE kind = ? ORDER BY ordinal")
    .all(kind)
    .map((row) => parseJson(row["payload_json"]));

export const queryPlanningActivity = (
  database: DatabaseSync,
  request: Readonly<{ date: string; timeZone: string }>,
): ActivityInspectResult => {
  const interval = planningActivityInterval(request.date, request.timeZone);
  const roadmaps = committedObjects(database, "roadmap").flatMap((payload) => {
    const roadmap = roadmapSchema.parse(payload);
    return [
      ...event(roadmap.id, roadmap.title, "roadmap-started", roadmap.startedAt, interval),
      ...event(roadmap.id, roadmap.title, "roadmap-completed", roadmap.completedAt, interval),
      ...event(roadmap.id, roadmap.title, "roadmap-superseded", roadmap.supersededAt, interval),
    ];
  });
  const gates = committedObjects(database, "gate").flatMap((payload) => {
    const gate = gateSchema.parse(payload);
    return [
      ...event(gate.id, gate.title, "gate-planned", gate.plannedAt, interval),
      ...event(gate.id, gate.title, "gate-activated", gate.activatedAt, interval),
      ...event(gate.id, gate.title, "gate-passed", gate.passage?.acceptedAt, interval),
      ...event(gate.id, gate.title, "gate-superseded", gate.supersededAt, interval),
    ];
  });
  const efforts = committedObjects(database, "effort").flatMap((payload) => {
    const effort = effortSchema.parse(payload);
    return [
      ...event(effort.id, effort.title, "effort-planned", effort.plannedAt, interval),
      ...event(effort.id, effort.title, "effort-activated", effort.activatedAt, interval),
      ...event(
        effort.id,
        effort.title,
        "effort-concluded",
        effort.conclusion?.concludedAt,
        interval,
      ),
    ];
  });
  return activityInspectResultSchema.parse({
    schemaVersion: 1,
    interval,
    historicalCompleteness: "not-established",
    governance: {
      roadmaps: { total: roadmaps.length, items: roadmaps },
      gates: { total: gates.length, items: gates },
      efforts: { total: efforts.length, items: efforts },
    },
  });
};
