import type { SourceRecord } from "../project-snapshot/contract";
import type { ProjectInspectorSelection } from "./project-inspector";
import type {
  MattMapView,
  RoadmapDetailModel,
  RoadmapEffortModel,
  RoadmapGateModel,
} from "./project-roadmap-model";

const gateState = (entry: RoadmapGateModel): string => {
  const state = entry.gate.horizonState;
  if (state === "focused") return "Current";
  if (state === "unknown") return "State unavailable";
  return `${state[0]?.toUpperCase()}${state.slice(1)}`;
};

export const readinessLabel = (readiness: RoadmapGateModel["gate"]["readiness"]): string => {
  if (readiness === "ready-for-review") return "Ready for review";
  if (readiness === "not-ready") return "Not ready";
  return "Readiness unknown";
};

export const gateInspection = (
  entry: RoadmapGateModel,
  roadmapTitle: string,
  gateCount: number,
): ProjectInspectorSelection => {
  const passage = entry.gate.passage;
  return {
    eyebrow: `G${entry.ordinal} · Milestone Gate`,
    title: entry.gate.title,
    detail: entry.gate.intent,
    handoff: true,
    source: entry.source,
    facts: [
      { label: "State", value: gateState(entry) },
      { label: "Readiness", value: readinessLabel(entry.gate.readiness) },
      { label: "Roadmap", value: roadmapTitle },
      { label: "Position", value: `${entry.ordinal} of ${gateCount}` },
    ],
    sections: [
      { title: "Exit criteria", items: entry.gate.exitCriteria },
      ...(passage === undefined
        ? []
        : [
            {
              title: "Accepted Passage",
              body: `${passage.acceptedDecision} ${passage.rationale}`,
              items:
                passage.exceptions.length === 0 ? ["No recorded exceptions."] : passage.exceptions,
            },
          ]),
    ],
  };
};

export const roadmapInspection = (
  model: Extract<RoadmapDetailModel, { state: "available" | "partial" }>,
): ProjectInspectorSelection => ({
  eyebrow: "Roadmap",
  title: model.roadmap.title,
  detail: model.roadmap.intent,
  handoff: true,
  source: model.source,
  facts: [
    { label: "Lifecycle", value: model.roadmap.lifecycle },
    { label: "Horizon", value: model.roadmap.horizon },
    {
      label: "Focused Gate",
      value: model.focusedGate?.gate.title ?? "No focused Gate",
    },
    { label: "Ordered Gates", value: String(model.gates.length) },
  ],
});

const laneItems = (
  label: string,
  tickets: RoadmapEffortModel["frontier"]["claimed"],
): NonNullable<ProjectInspectorSelection["sections"]> =>
  tickets.length === 0
    ? []
    : [
        {
          title: label,
          items: tickets.map((ticket) =>
            ticket.blockedBy.length === 0
              ? ticket.title
              : `${ticket.title} · ${ticket.blockedBy.length} blocker(s)`,
          ),
        },
      ];

export const frontierSummary = (model: RoadmapEffortModel): string => {
  const counts = [
    ["Claimed", model.frontier.claimed.length],
    ["Ready", model.frontier.ready.length],
    ...(model.frontier.uncertain.length === 0
      ? []
      : ([["Uncertain", model.frontier.uncertain.length]] as const)),
    ["Blocked", model.frontier.blocked.length],
    ["Resolved", model.frontier.resolved.length],
  ] as const;
  return counts.map(([label, count]) => `${label} ${count}`).join(" · ");
};

export const effortInspection = (model: RoadmapEffortModel): ProjectInspectorSelection => ({
  eyebrow: "Effort",
  title: model.effort.title,
  detail: model.effort.intent,
  handoff: true,
  source: model.source,
  facts: [
    { label: "Lifecycle", value: model.effort.derivedState },
    { label: "Target Gate", value: model.targetGate?.title ?? "Unavailable" },
    { label: "Frontier", value: frontierSummary(model) },
    { label: "Fog", value: String(model.fogCount) },
    ...(model.providerAssessment === undefined
      ? []
      : [
          { label: "Capture", value: model.providerAssessment.projectionState },
          { label: "Freshness", value: model.providerAssessment.freshness },
          { label: "Coverage", value: model.providerAssessment.coverage },
          { label: "Completion", value: model.providerAssessment.completion },
          { label: "Frontier evidence", value: model.providerAssessment.frontierEvidence },
          {
            label: "Blocking diagnostics",
            value: String(model.providerAssessment.blockingDiagnosticCount),
          },
        ]),
    {
      label: "Map",
      value: model.maps.map((map) => map.reference).join(", ") || "No Map",
      code: model.maps.length > 0,
    },
  ],
  sections: [
    ...laneItems("Claimed", model.frontier.claimed),
    ...laneItems("Ready", model.frontier.ready),
    ...laneItems("Uncertain", model.frontier.uncertain),
    ...laneItems("Blocked", model.frontier.blocked),
    ...laneItems("Resolved", model.frontier.resolved),
  ],
});

export const mapInspection = (
  map: MattMapView,
  source: SourceRecord | undefined,
): ProjectInspectorSelection => ({
  eyebrow: "Tracker-native Map",
  title: map.title,
  detail: "Read-only native work context for this contributing Effort.",
  handoff: true,
  source,
  facts: [
    { label: "Lifecycle", value: map.state },
    { label: "Fog", value: String(map.fogCount) },
    { label: "Reference", value: map.reference, code: true },
  ],
});

export const sourceInspection = (
  eyebrow: string,
  title: string,
  source: SourceRecord | undefined,
): ProjectInspectorSelection => ({
  eyebrow,
  title,
  detail: "This provenance is bounded to the current semantic Snapshot.",
  source,
});
