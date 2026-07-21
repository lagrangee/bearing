import { z } from "zod";
import { languageTagSchema } from "../language-tag";
import { uniqueIdentityArraySchema } from "./projection-identity";
import { titledSourceShape } from "./schema-node";
import { semanticPlainTextSchema } from "./schema-primitives";

const semanticListSchema = uniqueIdentityArraySchema(semanticPlainTextSchema, (item) => item);

export const projectSummarySchema = z.strictObject({
  id: z.literal("project-summary:current"),
  ...titledSourceShape,
  purpose: semanticPlainTextSchema,
  currentDesign: semanticPlainTextSchema,
  languages: z
    .strictObject({
      purpose: languageTagSchema.optional(),
      currentDesign: languageTagSchema.optional(),
    })
    .optional(),
  boundaries: semanticListSchema,
  futureCandidates: semanticListSchema,
  materialRevisions: semanticListSchema,
});
