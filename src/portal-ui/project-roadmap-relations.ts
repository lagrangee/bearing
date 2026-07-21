import type { Effort, MilestoneGate, ProjectSnapshot, Roadmap } from "../project-snapshot/contract";
import { assessScopedProjectionIssues } from "../project-snapshot/scoped-native-relations";

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
  maps: ProjectSnapshot["maps"],
  effortSources: readonly string[],
  sources: ProjectSnapshot["sources"],
): MapIssueAssessment =>
  assessScopedProjectionIssues(maps, effortSources, sources, {
    unscopableIsUncertain: true,
  });

export const hasScopedGateIssue = (
  gates: ProjectSnapshot["gates"],
  gateIds: readonly string[],
): boolean =>
  gates.validity === "partial" &&
  gates.issues.some(
    (issue) => issue.code === "untrusted-effort-contributor" && gateIds.includes(issue.target),
  );
