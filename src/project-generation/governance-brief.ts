import type { ProjectGenerationInput } from "./contract";
import { bodyIssue, type GovernanceInput, projectOrientationRecord } from "./governance-common";
import { projectBriefSchema } from "./schema-brief";

export const buildBriefProjection = (input: GovernanceInput): ProjectGenerationInput["brief"] => {
  const parsed = projectOrientationRecord(input, "project-brief");
  if (parsed.validity !== "available") return parsed;
  const { record } = parsed;
  const projectPurpose = record.content.values["Project Purpose"];
  const currentStage = record.content.values["Current Stage"];
  const materialAchievedState = record.content.values["Material Achieved State"];
  if (
    typeof projectPurpose !== "string" ||
    typeof currentStage !== "string" ||
    typeof materialAchievedState !== "string"
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
      projectPurpose,
      currentStage,
      materialAchievedState,
      ...(languages === undefined
        ? {}
        : {
            languages: {
              ...(languages["Project Purpose"] === undefined
                ? {}
                : { projectPurpose: languages["Project Purpose"] }),
              ...(languages["Current Stage"] === undefined
                ? {}
                : { currentStage: languages["Current Stage"] }),
              ...(languages["Material Achieved State"] === undefined
                ? {}
                : { materialAchievedState: languages["Material Achieved State"] }),
            },
          }),
    }),
  };
};
