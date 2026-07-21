import { parseCanonicalRecord } from "./canonical-record";
import type { ProjectSnapshotInput } from "./contract";
import { bodyIssue, type GovernanceInput } from "./governance-common";
import { projectSummarySchema } from "./schema";

export const buildSummaryProjection = (input: GovernanceInput): ProjectSnapshotInput["summary"] => {
  const record = input.records.find((candidate) => candidate.type === "project-summary");
  if (record === undefined) return { validity: "absent" };
  const parsed = parseCanonicalRecord(record);
  if (!parsed.ok) return { validity: "invalid", issues: [parsed.issue] };
  if (parsed.value.data.Type !== "project-summary") {
    return { validity: "invalid", issues: [bodyIssue(parsed.value, "invalid-project-summary")] };
  }
  if (parsed.value.content.kind !== "sections") {
    return {
      validity: "invalid",
      issues: [bodyIssue(parsed.value, "invalid-project-summary-body")],
    };
  }
  const purpose = parsed.value.content.values["Purpose"];
  const currentDesign = parsed.value.content.values["Current Design"];
  const boundaries = parsed.value.content.values["Boundaries"];
  const futureCandidates = parsed.value.content.values["Future Candidates"];
  const materialRevisions = parsed.value.content.values["Material Revisions"];
  if (
    typeof purpose !== "string" ||
    typeof currentDesign !== "string" ||
    !Array.isArray(boundaries) ||
    !Array.isArray(futureCandidates) ||
    !Array.isArray(materialRevisions)
  ) {
    return {
      validity: "invalid",
      issues: [bodyIssue(parsed.value, "invalid-project-summary-body")],
    };
  }
  return {
    validity: "available",
    value: projectSummarySchema.parse({
      id: parsed.value.data.ID,
      title: parsed.value.data.Title,
      source: parsed.value.source.reference,
      purpose,
      currentDesign,
      ...(parsed.value.data.Languages === undefined
        ? {}
        : {
            languages: {
              ...(parsed.value.data.Languages.Purpose === undefined
                ? {}
                : { purpose: parsed.value.data.Languages.Purpose }),
              ...(parsed.value.data.Languages["Current Design"] === undefined
                ? {}
                : { currentDesign: parsed.value.data.Languages["Current Design"] }),
            },
          }),
      boundaries,
      futureCandidates,
      materialRevisions,
    }),
  };
};
