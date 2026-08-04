import type {
  ArtifactAnalysis,
  AssetAvailability,
  BearingNode,
  CanonicalReference,
  EffortTopology,
  GateTopology,
  RoadmapTopology,
} from "./artifact-model";
import { isBearingStableIdReference } from "./artifact-model";
import { analyzeParsedAssetRegistry } from "./asset-analysis";
import type { BearingArtifact, DecodedBearingRecordContent } from "./bearing-record-decoder";
import type { Citation } from "./schema-definitions";
import type { StructuralDiagnostic } from "./types";

const citationsToReferences = (
  source: string,
  citations: readonly Citation[] | undefined,
): CanonicalReference[] =>
  (citations ?? []).map((citation) => ({ source, target: citation.Asset }));

const stableReference = (source: string, target: string): CanonicalReference[] =>
  isBearingStableIdReference(target) ? [{ source, target }] : [];

const stableReferences = (source: string, targets: readonly string[]): CanonicalReference[] =>
  targets.flatMap((target) => stableReference(source, target));

export const analyzeDecodedBearingArtifact = (
  locator: string,
  data: BearingArtifact | undefined,
  content: DecodedBearingRecordContent,
): ArtifactAnalysis => {
  if (content.kind === "asset-registry") {
    return analyzeParsedAssetRegistry(locator, {
      ok: true,
      entries: [
        ...content.assets.map((asset) => ({
          key: asset.ID,
          title: asset.Title,
          data: asset,
        })),
        ...content.invalidEntries.map((entry) => ({ ...entry, data: undefined })),
      ],
    });
  }

  if (data === undefined) {
    return {
      nodes: [],
      references: [],
      planningCitations: [],
      authorityBaselines: [],
      assetAvailability: [],
      roadmaps: [],
      gates: [],
      efforts: [],
      diagnostics: [],
    };
  }

  const diagnostics: StructuralDiagnostic[] = [];
  const nodes: BearingNode[] = [];
  const references: CanonicalReference[] = [];
  const planningCitations: CanonicalReference[] = [];
  const authorityBaselines: CanonicalReference[] = [];
  const assetAvailability: AssetAvailability[] = [];
  const roadmaps: RoadmapTopology[] = [];
  const gates: GateTopology[] = [];
  const efforts: EffortTopology[] = [];
  const addPlanningCitations = (citations: readonly Citation[] | undefined): void => {
    const registered = citationsToReferences(locator, citations);
    references.push(...registered);
    planningCitations.push(...registered);
  };

  switch (data.Type) {
    case "project-summary":
    case "project-brief":
      break;
    case "roadmap-index":
      references.push(...data.Roadmaps.map((target) => ({ source: locator, target })));
      break;
    case "roadmap":
      nodes.push({ id: data.ID, locator });
      roadmaps.push({
        id: data.ID,
        locator,
        lifecycle: data.Status,
        focusedGate: data["Focused gate"],
        gateOrder: data["Gate order"],
      });
      references.push(...data["Gate order"].map((target) => ({ source: locator, target })));
      if (data["Focused gate"] !== null) {
        references.push({ source: locator, target: data["Focused gate"] });
      }
      addPlanningCitations(data.Citations);
      if (data.Status !== "active" && data["Focused gate"] !== null) {
        diagnostics.push({
          code: "closed-roadmap-has-focus",
          impact: "blocking",
          target: locator,
          message: "Completed or superseded Roadmap must have Focused gate: null.",
        });
      }
      break;
    case "milestone-gate":
      nodes.push({ id: data.ID, locator });
      gates.push({
        id: data.ID,
        locator,
        lifecycle: data.Status,
        roadmap: data.Roadmap,
        effortOrder: data["Effort order"],
      });
      references.push({ source: locator, target: data.Roadmap });
      references.push(...data["Effort order"].map((target) => ({ source: locator, target })));
      addPlanningCitations(data.Citations);
      if (data.Status === "passed" && data.Passage === undefined) {
        diagnostics.push({
          code: "passed-gate-missing-passage",
          impact: "blocking",
          target: locator,
          message: "Passed Gate requires a Passage decision record.",
        });
      }
      if ((data.Status === "planned" || data.Status === "active") && data.Passage !== undefined) {
        diagnostics.push({
          code: "open-gate-has-passage",
          impact: "blocking",
          target: locator,
          message: "Planned or active Gate cannot have a Passage decision record.",
        });
      }
      for (const target of data.Passage?.Evidence ?? []) {
        references.push({ source: locator, target });
      }
      break;
    case "effort":
      nodes.push({ id: data.ID, locator });
      efforts.push({
        id: data.ID,
        locator,
        roadmap: data.Roadmap,
        targetGate: data["Target gate"],
      });
      references.push(
        { source: locator, target: data.Roadmap },
        { source: locator, target: data["Target gate"] },
      );
      references.push(...data.Authorities.map((target) => ({ source: locator, target })));
      addPlanningCitations(data.Citations);
      break;
    case "authority":
      nodes.push({ id: data.ID, locator });
      for (const target of data.Baseline) {
        const reference = { source: locator, target };
        references.push(reference);
        authorityBaselines.push(reference);
      }
      addPlanningCitations(data.Citations);
      break;
    case "asset-registry":
      break;
    case "alignment-check":
      nodes.push({ id: data.ID, locator });
      references.push(...stableReference(locator, data.Target));
      references.push(...stableReferences(locator, data.Resolution?.["Changed references"] ?? []));
      addPlanningCitations(data.Citations);
      if (data.Status === "resolved" && data.Resolution === undefined) {
        diagnostics.push({
          code: "resolved-check-missing-resolution",
          impact: "blocking",
          target: locator,
          message: "Resolved Alignment Check requires Resolution.",
        });
      }
      break;
    case "planning-review":
      nodes.push({ id: data.ID, locator });
      references.push(...stableReferences(locator, data.Resolution?.["Changed references"] ?? []));
      addPlanningCitations(data.Citations);
      if (data.Status === "completed" && data.Resolution === undefined) {
        diagnostics.push({
          code: "completed-review-missing-resolution",
          impact: "blocking",
          target: locator,
          message: "Completed Planning Review requires Resolution.",
        });
      }
      break;
    case "planning-audit":
      nodes.push({ id: data.ID, locator });
      references.push(...stableReferences(locator, data["Skipped targets"]));
      if (content.kind === "planning-audit" && content.result.ok) {
        for (const finding of content.result.value.findings) {
          const source = `${locator}#${finding.fragment}`;
          references.push(...stableReferences(source, finding.affectedReferences));
          if (finding.promotion !== undefined) {
            references.push({ source, target: finding.promotion.target });
          }
        }
      }
      break;
    case "next-work-guidance":
      nodes.push({ id: data.ID, locator });
      if (data["Based on audit"] !== undefined) {
        references.push({ source: locator, target: data["Based on audit"] });
      }
      if (content.kind === "next-work-guidance" && content.result.ok) {
        references.push(
          ...stableReferences(locator, content.result.value.primary.supportingReferences),
          ...content.result.value.alternatives.flatMap((item) =>
            stableReferences(locator, item.supportingReferences),
          ),
        );
      }
      break;
  }
  const analysis: ArtifactAnalysis = {
    nodes,
    references,
    planningCitations,
    authorityBaselines,
    assetAvailability,
    roadmaps,
    gates,
    efforts,
    diagnostics,
  };
  if (!diagnostics.some((diagnostic) => diagnostic.impact === "blocking")) return analysis;
  return {
    ...analysis,
    nodes: [],
    references: [],
    planningCitations: [],
    authorityBaselines: [],
    assetAvailability: [],
    roadmaps: [],
    gates: [],
    efforts: [],
  };
};
