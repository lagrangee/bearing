import { z } from "zod";
import { languageTagSchema } from "../language-tag";
import { bearingOwnedEventTimeSchema } from "../source-event-time";
import { titledSourceShape } from "./schema-node";
import { semanticPlainTextSchema } from "./schema-primitives";

export const projectBriefSchema = z.strictObject({
  id: z.literal("project-brief:current"),
  ...titledSourceShape,
  generatedAt: bearingOwnedEventTimeSchema.unwrap(),
  atAGlance: semanticPlainTextSchema,
  currentPosition: semanticPlainTextSchema,
  establishedBaseline: z.array(semanticPlainTextSchema).min(1).max(5),
  languages: z
    .strictObject({
      atAGlance: languageTagSchema.optional(),
      currentPosition: languageTagSchema.optional(),
      establishedBaseline: languageTagSchema.optional(),
    })
    .optional(),
});
