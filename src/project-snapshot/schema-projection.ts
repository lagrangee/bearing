import { z } from "zod";
import { uniqueIdentityArraySchema } from "./projection-identity";
import { nonEmptyStringSchema, semanticPlainTextSchema } from "./schema-primitives";
import { sourceReferenceSchema } from "./source-schema";

export const projectionIssueSchema = z.strictObject({
  code: nonEmptyStringSchema,
  target: nonEmptyStringSchema,
  message: semanticPlainTextSchema,
  source: sourceReferenceSchema.optional(),
});

const projectionIssuesSchema = z.array(projectionIssueSchema).min(1);

export const singletonProjectionSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("validity", [
    z.strictObject({ validity: z.literal("available"), value }),
    z.strictObject({ validity: z.literal("absent") }),
    z.strictObject({ validity: z.literal("partial"), value, issues: projectionIssuesSchema }),
    z.strictObject({ validity: z.literal("invalid"), issues: projectionIssuesSchema }),
  ]);

export const collectionProjectionSchema = <T extends z.ZodType>(
  item: T,
  identityOf: (value: z.output<T>) => string,
) => {
  const items = uniqueIdentityArraySchema(item, identityOf);
  const retainedItems = items.refine((values) => values.length > 0, {
    message: "A partial collection must retain at least one trustworthy member.",
  });
  return z.discriminatedUnion("validity", [
    z.strictObject({ validity: z.literal("available"), items }),
    z.strictObject({
      validity: z.literal("partial"),
      items: retainedItems,
      issues: projectionIssuesSchema,
    }),
    z.strictObject({ validity: z.literal("invalid"), issues: projectionIssuesSchema }),
  ]);
};
