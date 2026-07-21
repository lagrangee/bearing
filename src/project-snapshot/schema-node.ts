import { z } from "zod";
import { assetIdSchema, semanticPlainTextSchema } from "./schema-primitives";
import { sourceReferenceSchema } from "./source-schema";

const citationSchema = z.strictObject({
  assetId: assetIdSchema,
  note: semanticPlainTextSchema,
});

export const titledSourceShape = {
  title: semanticPlainTextSchema,
  source: sourceReferenceSchema,
} as const;

export const citedNodeShape = {
  ...titledSourceShape,
  citations: z.array(citationSchema),
} as const;
