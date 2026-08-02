import { z } from "zod";
import { languageTagSchema } from "../language-tag";
import { bearingOwnedEventTimeSchema } from "../source-event-time";
import { titledSourceShape } from "./schema-node";
import { semanticPlainTextSchema } from "./schema-primitives";

export const projectBriefSchema = z.strictObject({
  id: z.literal("project-brief:current"),
  ...titledSourceShape,
  generatedAt: bearingOwnedEventTimeSchema.unwrap(),
  projectPurpose: semanticPlainTextSchema,
  currentStage: semanticPlainTextSchema,
  materialAchievedState: semanticPlainTextSchema,
  languages: z
    .strictObject({
      projectPurpose: languageTagSchema.optional(),
      currentStage: languageTagSchema.optional(),
      materialAchievedState: languageTagSchema.optional(),
    })
    .optional(),
});
