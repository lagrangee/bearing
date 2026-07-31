import type { Effort, MilestoneGate, ProjectSnapshot, Roadmap } from "../project-snapshot/contract";
import { assessSelectedProviderObservationEvidence } from "../provider-observation-contract";
import { sameMattNativeScope } from "../providers/matt-skills-v1/native-subject";

export const collectRoadmapEvidenceIds = (
  roadmap: Roadmap,
  gates: readonly MilestoneGate[],
  efforts: readonly Effort[],
): readonly string[] => {
  const ids = new Set(roadmap.citations.map((citation) => citation.assetId));
  for (const gate of gates) {
    for (const citation of gate.citations) ids.add(citation.assetId);
    for (const assetId of gate.passage?.evidenceAssetIds ?? []) ids.add(assetId);
  }
  for (const effort of efforts) {
    for (const citation of effort.citations) ids.add(citation.assetId);
  }
  return [...ids];
};

type MapIssueAssessment = Readonly<{
  missingRelationCount: number;
  uncertain: boolean;
}>;

export const assessScopedMapIssues = (
  captures: ProjectSnapshot["providerObservations"],
  selections: ProjectSnapshot["providerObservationSelections"],
  efforts: readonly Effort[],
  _sources: ProjectSnapshot["sources"],
): MapIssueAssessment => {
  let uncertain = false;
  const missingRelationCount = efforts.filter((effort) => {
    const binding = effort.workBinding;
    if (binding === undefined) return false;
    const capture = captures.find((capture) => sameMattNativeScope(capture.binding, binding));
    const selection = selections.find((candidate) => sameMattNativeScope(candidate, binding));
    if (
      assessSelectedProviderObservationEvidence(capture, selection).frontierEvidence === "withheld"
    ) {
      uncertain = true;
    }
    return capture === undefined;
  }).length;
  return { missingRelationCount, uncertain: uncertain || missingRelationCount > 0 };
};

export const hasScopedGateIssue = (
  gates: ProjectSnapshot["gates"],
  gateIds: readonly string[],
): boolean =>
  gates.validity === "partial" &&
  gates.issues.some(
    (issue) => issue.code === "untrusted-effort-contributor" && gateIds.includes(issue.target),
  );
