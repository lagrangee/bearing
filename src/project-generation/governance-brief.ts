import type { ProjectGenerationInput } from "./contract";
import { bodyIssue, type GovernanceInput, projectOrientationRecord } from "./governance-common";
import { projectBriefSchema } from "./schema-brief";

export const buildBriefProjection = (input: GovernanceInput): ProjectGenerationInput["brief"] => {
  const parsed = projectOrientationRecord(input, "project-brief");
  if (parsed.validity !== "available") return parsed;
  const { record } = parsed;
  const atAGlance = record.content.values["At a Glance"];
  const currentPosition = record.content.values["Current Position"];
  const establishedBaseline = record.content.values["Established Baseline"];
  if (
    typeof atAGlance !== "string" ||
    typeof currentPosition !== "string" ||
    !Array.isArray(establishedBaseline) ||
    establishedBaseline.length === 0 ||
    establishedBaseline.length > 5
  ) {
    return {
      validity: "invalid",
      issues: [bodyIssue(record, "invalid-project-brief-body")],
    };
  }
  const languages = record.data.Languages;
  return {
    validity: "available",
    value: projectBriefSchema.parse({
      id: record.data.ID,
      title: "Project Brief",
      source: record.source.reference,
      generatedAt: record.data["Generated at"],
      atAGlance,
      currentPosition,
      establishedBaseline,
      ...(languages === undefined
        ? {}
        : {
            languages: {
              ...(languages["At a Glance"] === undefined
                ? {}
                : { atAGlance: languages["At a Glance"] }),
              ...(languages["Current Position"] === undefined
                ? {}
                : { currentPosition: languages["Current Position"] }),
              ...(languages["Established Baseline"] === undefined
                ? {}
                : { establishedBaseline: languages["Established Baseline"] }),
            },
          }),
    }),
  };
};
