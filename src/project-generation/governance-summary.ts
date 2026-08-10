import type { ProjectGenerationInput } from "./contract";
import { bodyIssue, type GovernanceInput, projectOrientationRecord } from "./governance-common";
import { projectSummarySchema } from "./schema";

export const buildSummaryProjection = (
  input: GovernanceInput,
): ProjectGenerationInput["summary"] => {
  const parsed = projectOrientationRecord(input, "project-summary");
  if (parsed.validity !== "available") return parsed;
  const { record } = parsed;
  const purpose = record.content.values["Purpose"];
  const currentDesign = record.content.values["Current Design"];
  const boundaries = record.content.values["Boundaries"];
  const futureCandidates = record.content.values["Future Candidates"];
  const materialRevisions = record.content.values["Material Revisions"];
  if (
    typeof purpose !== "string" ||
    typeof currentDesign !== "string" ||
    !Array.isArray(boundaries) ||
    !Array.isArray(futureCandidates) ||
    !Array.isArray(materialRevisions)
  ) {
    return {
      validity: "invalid",
      issues: [bodyIssue(record, "invalid-project-summary-body")],
    };
  }
  return {
    validity: "available",
    value: projectSummarySchema.parse({
      id: record.data.ID,
      title: record.data.Title,
      source: record.source.reference,
      purpose,
      currentDesign,
      ...(record.data["Updated at"] === undefined ? {} : { updatedAt: record.data["Updated at"] }),
      ...(record.data.Languages === undefined
        ? {}
        : {
            languages: {
              ...(record.data.Languages.Purpose === undefined
                ? {}
                : { purpose: record.data.Languages.Purpose }),
              ...(record.data.Languages["Current Design"] === undefined
                ? {}
                : { currentDesign: record.data.Languages["Current Design"] }),
            },
          }),
      boundaries,
      futureCandidates,
      materialRevisions,
    }),
  };
};
