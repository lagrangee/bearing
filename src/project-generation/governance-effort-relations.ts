import type {
  CollectionProjection,
  Effort,
  MilestoneGate,
  ProjectionIssue,
  SourceRecord,
} from "./contract";
import type { BuildResult, GovernanceInput } from "./governance-common";

const contributorIssue = (
  gateId: MilestoneGate["id"],
  source: SourceRecord["reference"],
): ProjectionIssue => ({
  code: "untrusted-effort-contributor",
  target: gateId,
  message: "A canonical Effort contributor is unavailable to trusted planning rollup.",
  source,
});

export const untrustedEffortContributorIssues = (
  input: GovernanceInput,
  effortResults: readonly BuildResult<Effort>[],
  gates: readonly MilestoneGate[],
): readonly ProjectionIssue[] => {
  const unavailableSources = new Set(
    effortResults
      .filter((result) => result.item === undefined)
      .map((result) => result.source.reference),
  );
  const gateById = new Map<string, MilestoneGate>(gates.map((gate) => [gate.id, gate]));
  return input.records.flatMap((record) => {
    if (record.type !== "effort") return [];
    if (!unavailableSources.has(record.source.reference)) return [];
    const data = record.data;
    if (data === undefined) return [];
    if (data.Type !== "effort") return [];
    const gate = gateById.get(data["Target gate"]);
    return gate?.roadmapId === data.Roadmap
      ? [contributorIssue(gate.id, record.source.reference)]
      : [];
  });
};

export const addCollectionIssues = <T>(
  projection: CollectionProjection<T>,
  added: readonly ProjectionIssue[],
): CollectionProjection<T> => {
  if (added.length === 0) return projection;
  if (projection.validity === "invalid") {
    return { validity: "invalid", issues: [...projection.issues, ...added] };
  }
  const issues = [...(projection.validity === "partial" ? projection.issues : []), ...added];
  return projection.items.length === 0
    ? { validity: "invalid", issues }
    : { validity: "partial", items: projection.items, issues };
};
