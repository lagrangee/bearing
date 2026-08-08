import { sameMattNativeScope } from "../providers/matt-skills-v1/native-subject";
import {
  projectExpectedSourceEventTime,
  projectOptionalSourceEventTime,
} from "../source-event-time";
import type {
  Authority,
  CollectionProjection,
  Effort,
  MilestoneGate,
  ProjectSnapshotInput,
  Roadmap,
  SourceRecord,
} from "./contract";
import { buildBriefProjection } from "./governance-brief";
import {
  type BuildResult,
  bodyIssue,
  citations,
  collection,
  exactList,
  exactProse,
  failedResult,
  type GovernanceInput,
  governanceSources,
  parsedFor,
} from "./governance-common";
import {
  addCollectionIssues,
  untrustedEffortContributorIssues,
} from "./governance-effort-relations";
import { buildRoadmapIndexProjection } from "./governance-index";
import { buildSummaryProjection } from "./governance-summary";
import { isolateDuplicateIdentities } from "./projection-identity";
import { authoritySchema, effortSchema, gateSchema, roadmapSchema } from "./schema";

type Input = GovernanceInput;
type Governance = Pick<ProjectSnapshotInput, "summary" | "brief" | "roadmapIndex"> &
  Readonly<{
    roadmaps: CollectionProjection<Roadmap>;
    gates: CollectionProjection<MilestoneGate>;
    efforts: CollectionProjection<Effort>;
    authorities: CollectionProjection<Authority>;
    sources: readonly SourceRecord[];
  }>;
const roadmapProjection = (input: Input): BuildResult<Roadmap>[] =>
  parsedFor(input, "roadmap").map((result): BuildResult<Roadmap> => {
    const record = result.item;
    if (record === undefined || record.data.Type !== "roadmap") return failedResult(result);
    const data = record.data;
    const intent = exactProse(record, ["Intent"], "Intent");
    if (intent === undefined)
      return { source: record.source, issue: bodyIssue(record, "invalid-roadmap-body") };
    return {
      source: record.source,
      item: roadmapSchema.parse({
        id: data.ID,
        title: data.Title,
        source: record.source.reference,
        citations: citations(data),
        intent,
        lifecycle: data.Status,
        startedAt: projectExpectedSourceEventTime(data["Started at"]),
        ...(data.Status === "completed"
          ? { completedAt: projectExpectedSourceEventTime(data["Completed at"]) }
          : {}),
        ...(data.Status === "superseded"
          ? { supersededAt: projectExpectedSourceEventTime(data["Superseded at"]) }
          : {}),
        focusedGateId: data["Focused gate"],
        gateOrder: data["Gate order"],
        horizon: "unknown",
        effortIds: [],
      }),
    };
  });

const gateProjection = (input: Input): BuildResult<MilestoneGate>[] =>
  parsedFor(input, "milestone-gate").map((result): BuildResult<MilestoneGate> => {
    const record = result.item;
    if (record === undefined || record.data.Type !== "milestone-gate") return failedResult(result);
    const data = record.data;
    const intent = exactProse(record, ["Intent", "Exit Criteria"], "Intent");
    const exitCriteria = exactList(record, ["Intent", "Exit Criteria"], "Exit Criteria");
    if (intent === undefined || exitCriteria === undefined || exitCriteria.length === 0)
      return { source: record.source, issue: bodyIssue(record, "invalid-gate-body") };
    return {
      source: record.source,
      item: gateSchema.parse({
        id: data.ID,
        title: data.Title,
        source: record.source.reference,
        citations: citations(data),
        intent,
        exitCriteria,
        roadmapId: data.Roadmap,
        lifecycle: data.Status,
        plannedAt: projectExpectedSourceEventTime(data["Planned at"]),
        ...(data.Status === "active" || data.Status === "passed"
          ? { activatedAt: projectExpectedSourceEventTime(data["Activated at"]) }
          : data.Status === "superseded"
            ? (() => {
                const activatedAt = projectOptionalSourceEventTime(data["Activated at"]);
                return activatedAt === undefined ? {} : { activatedAt };
              })()
            : {}),
        ...(data.Status === "superseded"
          ? { supersededAt: projectExpectedSourceEventTime(data["Superseded at"]) }
          : {}),
        readiness: "unknown",
        horizonState: "unknown",
        effortIds: data["Effort order"],
        ...(data.Passage === undefined
          ? {}
          : {
              passage: {
                acceptedDecision: data.Passage["Accepted decision"],
                acceptedAt: projectExpectedSourceEventTime(data.Passage["Accepted at"]),
                rationale: data.Passage.Rationale,
                evidence: data.Passage.Evidence.map((entry) => ({
                  locator: entry.Locator,
                  relevance: entry.Relevance,
                })),
                exceptions: data.Passage.Exceptions,
              },
            }),
      }),
    };
  });

const effortProjection = (input: Input): BuildResult<Effort>[] =>
  parsedFor(input, "effort").map((result): BuildResult<Effort> => {
    const record = result.item;
    if (record === undefined || record.data.Type !== "effort") return failedResult(result);
    const data = record.data;
    const intent = exactProse(record, ["Intent", "Work"], "Intent");
    if (intent === undefined)
      return { source: record.source, issue: bodyIssue(record, "invalid-effort-body") };
    const bindingDiagnostic = input.diagnostics.find(
      (diagnostic) =>
        diagnostic.target === record.locator && diagnostic.code.startsWith("effort-work-binding-"),
    );
    const declaredBinding =
      data["Work binding"] === undefined
        ? undefined
        : {
            provider: data["Work binding"].Provider,
            nativeScope: data["Work binding"]["Native scope"],
          };
    const workBindingState =
      bindingDiagnostic?.code === "effort-work-binding-missing"
        ? ({ state: "invalid", reason: "missing" } as const)
        : bindingDiagnostic?.code === "effort-work-binding-unparseable"
          ? ({ state: "invalid", reason: "unparseable" } as const)
          : bindingDiagnostic?.code === "effort-work-binding-conflict"
            ? ({ state: "invalid", reason: "conflicting" } as const)
            : declaredBinding !== undefined &&
                input.providerObservations !== undefined &&
                !input.providerObservations.some((observation) =>
                  sameMattNativeScope(observation.binding, declaredBinding),
                )
              ? ({ state: "invalid", reason: "unresolved" } as const)
              : ({ state: "bound" } as const);
    return {
      source: record.source,
      item: effortSchema.parse({
        id: data.ID,
        title: data.Title,
        source: record.source.reference,
        citations: citations(data),
        intent,
        roadmapId: data.Roadmap,
        targetGateId: data["Target gate"],
        authorityIds: data.Authorities,
        lifecycle: data.Lifecycle,
        plannedAt: projectExpectedSourceEventTime(data["Planned at"]),
        ...(data["Activated at"] === undefined
          ? {}
          : { activatedAt: projectExpectedSourceEventTime(data["Activated at"]) }),
        ...(data.Conclusion === undefined
          ? {}
          : {
              conclusion: {
                disposition: data.Conclusion.Disposition,
                rationale: data.Conclusion.Rationale,
                concludedAt: projectExpectedSourceEventTime(data.Conclusion["Concluded at"]),
                ...(data.Conclusion["Replacement effort"] === undefined
                  ? {}
                  : { replacementEffortId: data.Conclusion["Replacement effort"] }),
              },
            }),
        ...(data["Work binding"] === undefined
          ? {}
          : {
              workBinding: declaredBinding,
            }),
        workBindingState,
      }),
    };
  });

const authorityProjection = (input: Input): BuildResult<Authority>[] =>
  parsedFor(input, "authority").map((result): BuildResult<Authority> => {
    const record = result.item;
    if (record === undefined || record.data.Type !== "authority") return failedResult(result);
    const data = record.data;
    const scope = exactProse(record, ["Scope", "Current Baseline"], "Scope");
    if (scope === undefined)
      return { source: record.source, issue: bodyIssue(record, "invalid-authority-body") };
    return {
      source: record.source,
      item: authoritySchema.parse({
        id: data.ID,
        title: data.Title,
        source: record.source.reference,
        citations: citations(data),
        scope,
        baselineAssetIds: data.Baseline,
      }),
    };
  });

export const buildGovernanceProjection = (input: Input): Governance => {
  const efforts = isolateDuplicateIdentities(effortProjection(input), (effort) => effort.id);
  const roadmaps = isolateDuplicateIdentities(roadmapProjection(input), (roadmap) => roadmap.id);
  const roadmapCollection = collection(roadmaps);
  const gateResults = isolateDuplicateIdentities(gateProjection(input), (gate) => gate.id);
  const retainedGates = gateResults.flatMap((result) =>
    result.item === undefined ? [] : [result.item],
  );
  const gates = addCollectionIssues(
    collection(gateResults),
    untrustedEffortContributorIssues(input, efforts, retainedGates),
  );
  const authorities = isolateDuplicateIdentities(
    authorityProjection(input),
    (authority) => authority.id,
  );
  return {
    summary: buildSummaryProjection(input),
    brief: buildBriefProjection(input),
    roadmapIndex: buildRoadmapIndexProjection(input, roadmapCollection),
    roadmaps: roadmapCollection,
    gates,
    efforts: collection(efforts),
    authorities: collection(authorities),
    sources: governanceSources(input),
  };
};
