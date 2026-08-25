import type { DatabaseSync } from "node:sqlite";
import { Temporal } from "@js-temporal/polyfill";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { effortSchema, gateSchema, roadmapSchema } from "./project-generation/schema";
import {
  type ActivityInspectResult,
  activityInspectResultSchema,
  planningActivityIntervalSchema,
} from "./project-read-model/contract";
import { providerObservationSelectionSchema } from "./provider-evidence-contract";
import type { MattProjectedObject } from "./providers/matt-skills-v1/projection";
import { mattObjects } from "./providers/matt-skills-v1/projection";
import { mattNativeWorkReadingContextForEffort } from "./providers/matt-skills-v1/reading-state";
import { mattSkillsV1ProviderObservationSchema } from "./providers/matt-skills-v1/schema";
import { buildMattNativeWorkRegion } from "./providers/matt-skills-v1/work-region";
import type { ProjectedNativeTime, SourceEventTime } from "./source-event-time";

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
type AvailableNativeTime = Extract<ProjectedNativeTime, { availability: "available" }>;
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

type BoundProviderEvidence = Readonly<{
  selection: ReturnType<typeof providerObservationSelectionSchema.parse>;
  observation?: ReturnType<typeof mattSkillsV1ProviderObservationSchema.parse>;
}>;

const boundProviderEvidence = (database: DatabaseSync): readonly BoundProviderEvidence[] =>
  database
    .prepare(
      "SELECT observation_json, selection_json FROM provider_evidence WHERE role = 'bound' ORDER BY binding_key",
    )
    .all()
    .map((row) => ({
      selection: providerObservationSelectionSchema.parse(parseJson(row["selection_json"])),
      ...(typeof row["observation_json"] === "string"
        ? {
            observation: mattSkillsV1ProviderObservationSchema.parse(
              parseJson(row["observation_json"]),
            ),
          }
        : {}),
    }));

const availableNativeTimeInside = (
  time: ProjectedNativeTime | undefined,
  interval: PlanningActivityInterval,
): time is AvailableNativeTime =>
  time?.availability === "available" &&
  Temporal.Instant.compare(time.value, interval.startInclusive) >= 0 &&
  Temporal.Instant.compare(time.value, interval.endExclusive) < 0;

const trackerClosureTime = (object: MattProjectedObject): ProjectedNativeTime | undefined => {
  if (object.kind === "map" || object.kind === "spec") return undefined;
  if (object.kind === "incoming-issue") {
    return object.lifecycle.state === "closed" ? object.lifecycle.closedAt : undefined;
  }
  return object.trackerClosure.state === "closed" ? object.trackerClosure.closedAt : undefined;
};

const activityNativeReference = (nativeScope: string, reference: string): string =>
  `native-subject:sha256:${bytesToHex(
    sha256(
      utf8ToBytes(`bearing-planning-activity-native-subject-v1\n${nativeScope}\n${reference}`),
    ),
  )}`;

type NativeEvent = Readonly<{
  subjectReference: string;
  nativeReference: string;
  currentTitle: string;
  subjectKind: "wayfinder-ticket" | "delivery-ticket" | "incoming-issue";
  event: "native-created" | "tracker-closed";
  occurredAt: Omit<AvailableNativeTime, "basis">;
  timeBasis: AvailableNativeTime["basis"];
}>;

const nativeEvent = (
  object: Exclude<MattProjectedObject, { kind: "map" | "spec" }>,
  role: NativeEvent["event"],
  time: ProjectedNativeTime | undefined,
  nativeScope: string,
  interval: PlanningActivityInterval,
): readonly NativeEvent[] => {
  if (!availableNativeTimeInside(time, interval)) return [];
  const { basis, ...occurredAt } = time;
  return [
    {
      subjectReference: object.ref,
      nativeReference: activityNativeReference(nativeScope, object.ref),
      currentTitle: object.title,
      subjectKind: object.kind,
      event: role,
      occurredAt,
      timeBasis: basis,
    },
  ];
};

const nativeEventsFor = (
  observation: BoundProviderEvidence["observation"],
  interval: PlanningActivityInterval,
): readonly NativeEvent[] =>
  mattObjects(observation).flatMap((object) => {
    if (object.kind === "map" || object.kind === "spec") return [];
    return [
      ...nativeEvent(
        object,
        "native-created",
        object.native.createdAt,
        observation?.binding.nativeScope ?? "",
        interval,
      ),
      ...nativeEvent(
        object,
        "tracker-closed",
        trackerClosureTime(object),
        observation?.binding.nativeScope ?? "",
        interval,
      ),
    ];
  });

const frontierCount = (
  region: ReturnType<typeof buildMattNativeWorkRegion>,
  frontier: "claimed" | "ready" | "blocked" | "resolved",
) => {
  const roles = region.roles.filter(
    (role) => role.role === "wayfinder" || role.role === "delivery",
  );
  if (roles.some((role) => role.count.mode === "unavailable")) return { mode: "unavailable" };
  const value = roles
    .flatMap((role) => role.items)
    .filter((item) => item.frontier === frontier).length;
  return roles.some((role) => role.count.mode === "at-least")
    ? { mode: "at-least" as const, value }
    : { mode: "exact" as const, value };
};

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
  const effortRecords = committedObjects(database, "effort").map((payload) =>
    effortSchema.parse(payload),
  );
  const efforts = effortRecords.flatMap((effort) => {
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
  const evidence = boundProviderEvidence(database);
  let remainingItemBudget = 20;
  const effortActivity = effortRecords.flatMap((effort) => {
    const selected =
      effort.workBinding === undefined
        ? undefined
        : evidence.find(
            (candidate) =>
              candidate.selection.provider === effort.workBinding?.provider &&
              candidate.selection.nativeScope === effort.workBinding.nativeScope,
          );
    const observation = selected?.observation;
    const context = mattNativeWorkReadingContextForEffort(
      effortRecords,
      effort,
      observation,
      selected === undefined ? [] : [selected.selection],
    );
    const nativeEvents = nativeEventsFor(observation, interval);
    const hasGovernanceEvent = efforts.some((candidate) => candidate.reference === effort.id);
    if (effort.lifecycle !== "active" && !hasGovernanceEvent && nativeEvents.length === 0)
      return [];
    const expanded = nativeEvents.slice(0, remainingItemBudget);
    remainingItemBudget -= expanded.length;
    const region =
      observation !== undefined && selected !== undefined && context?.state === "bound"
        ? buildMattNativeWorkRegion(observation, [selected.selection], context)
        : undefined;
    return [
      {
        reference: effort.id,
        currentTitle: effort.title,
        lifecycle: effort.lifecycle,
        evidence:
          observation === undefined || selected === undefined
            ? { state: "unavailable" as const }
            : {
                state: "available" as const,
                observationId: observation.id,
                observedAt: observation.observedAt,
                freshness: selected.selection.effectiveFreshness,
                coverage: observation.coverage.assessment,
                completion: observation.completion,
              },
        currentFrontier:
          region === undefined || observation === undefined
            ? { state: "unavailable" as const }
            : {
                state: "available" as const,
                asOf: observation.observedAt,
                counts: {
                  claimed: frontierCount(region, "claimed"),
                  ready: frontierCount(region, "ready"),
                  blocked: frontierCount(region, "blocked"),
                  resolved: frontierCount(region, "resolved"),
                },
              },
        activity: {
          totals: {
            nativeCreated: nativeEvents.filter((item) => item.event === "native-created").length,
            trackerClosed: nativeEvents.filter((item) => item.event === "tracker-closed").length,
            uniqueSubjects: new Set(nativeEvents.map((item) => item.subjectReference)).size,
            byTimeBasis: {
              sourceEvent: nativeEvents.filter((item) => item.timeBasis === "source-event").length,
              inferredSourceMetadata: nativeEvents.filter(
                (item) => item.timeBasis === "inferred-source-metadata",
              ).length,
            },
          },
          items: expanded.map(({ subjectReference: _subjectReference, ...item }) => item),
          omittedItemCount: nativeEvents.length - expanded.length,
        },
      },
    ];
  });
  const expandedItemCount = 20 - remainingItemBudget;
  const totalNativeEventCount = effortActivity.reduce(
    (total, effort) =>
      total + effort.activity.totals.nativeCreated + effort.activity.totals.trackerClosed,
    0,
  );
  return activityInspectResultSchema.parse({
    schemaVersion: 1,
    interval,
    historicalCompleteness: "not-established",
    governance: {
      roadmaps: { total: roadmaps.length, items: roadmaps },
      gates: { total: gates.length, items: gates },
      efforts: { total: efforts.length, items: efforts },
    },
    efforts: effortActivity,
    detailBudget: {
      limit: 20,
      expandedItemCount,
      omittedItemCount: totalNativeEventCount - expandedItemCount,
    },
  });
};
