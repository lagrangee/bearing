import { parseCanonicalRecord } from "./canonical-record";
import type { CollectionProjection, ProjectSnapshotInput, Roadmap, RoadmapIndex } from "./contract";
import type { GovernanceInput } from "./governance-common";
import { roadmapIdSchema } from "./schema-primitives";
import { roadmapIndexSchema } from "./schema-roadmap-index";

const availableRoadmaps = (projection: CollectionProjection<Roadmap>): readonly Roadmap[] =>
  projection.validity === "invalid" ? [] : projection.items;

export const buildRoadmapIndexProjection = (
  input: GovernanceInput,
  roadmaps: CollectionProjection<Roadmap>,
): ProjectSnapshotInput["roadmapIndex"] => {
  const record = input.records.find((candidate) => candidate.type === "roadmap-index");
  if (record === undefined) return { validity: "absent" };
  const parsed = parseCanonicalRecord(record);
  if (!parsed.ok) return { validity: "invalid", issues: [parsed.issue] };
  if (parsed.value.data.Type !== "roadmap-index") {
    return {
      validity: "invalid",
      issues: [
        {
          code: "invalid-roadmap-index",
          target: record.locator,
          message: "Roadmap Index does not match its package-owned semantic schema.",
          source: parsed.value.source.reference,
        },
      ],
    };
  }
  const byId = new Map(availableRoadmaps(roadmaps).map((roadmap) => [roadmap.id, roadmap]));
  const roadmapIds = parsed.value.data.Roadmaps.map((id) => roadmapIdSchema.parse(id));
  const indexedIds = new Set(roadmapIds);
  const unlistedIssues = availableRoadmaps(roadmaps).flatMap((roadmap) =>
    indexedIds.has(roadmap.id)
      ? []
      : [
          {
            code: "roadmap-index-roadmap-unlisted",
            target: roadmap.id,
            message: "A trustworthy Roadmap is not listed in the canonical Roadmap Index.",
            source: parsed.value.source.reference,
          },
        ],
  );
  const indexed = roadmapIds.flatMap((id) => {
    const roadmap = byId.get(id);
    return roadmap === undefined ? [] : [roadmap];
  });
  const value: RoadmapIndex = roadmapIndexSchema.parse({
    source: parsed.value.source.reference,
    activeRoadmapIds: indexed
      .filter((roadmap) => roadmap.lifecycle === "active")
      .map((roadmap) => roadmap.id),
    completedRoadmapIds: indexed
      .filter((roadmap) => roadmap.lifecycle === "completed")
      .map((roadmap) => roadmap.id),
    supersededRoadmapIds: indexed
      .filter((roadmap) => roadmap.lifecycle === "superseded")
      .map((roadmap) => roadmap.id),
  });
  const issues = roadmapIds.flatMap((id) =>
    byId.has(id)
      ? []
      : [
          {
            code: "roadmap-index-target-unavailable",
            target: id,
            message: "Indexed Roadmap is unavailable to the Project Snapshot.",
            source: parsed.value.source.reference,
          },
        ],
  );
  if (unlistedIssues.length > 0) {
    return { validity: "invalid", issues: [...issues, ...unlistedIssues] };
  }
  return issues.length === 0
    ? { validity: "available", value }
    : { validity: "partial", value, issues };
};
