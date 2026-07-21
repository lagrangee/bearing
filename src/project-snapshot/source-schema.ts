import { z } from "zod";
import { displaySourceLocatorSchema } from "../reference-schema";

export { displayAssetLocatorSchema, displaySourceLocatorSchema } from "../reference-schema";

export const SOURCE_KINDS = ["canonical", "tracker", "asset", "evidence"] as const;
export const SOURCE_BINDING_ROLES = [
  "project-summary",
  "roadmap-index",
  "roadmap",
  "milestone-gate",
  "effort",
  "authority",
  "asset",
  "alignment-check",
  "planning-review",
  "planning-audit",
  "next-work-guidance",
  "guidance-item",
  "audit-finding",
  "map",
  "ticket",
] as const;

export const sourceKindSchema = z.enum(SOURCE_KINDS);
export const sourceBindingRoleSchema = z.enum(SOURCE_BINDING_ROLES);
export const sourceBindingSchema = z.strictObject({
  role: sourceBindingRoleSchema,
  identity: z.string().min(1),
});
export const sourceReferenceSchema = z
  .string()
  .regex(/^source:[0-9a-f]{64}$/u)
  .brand("SourceReference");
export const sourceRecordSchema = z.strictObject({
  reference: sourceReferenceSchema,
  kind: sourceKindSchema,
  displayLocator: displaySourceLocatorSchema,
  fragment: z.string().min(1).optional(),
  binding: sourceBindingSchema.optional(),
});
export const sourceReferenceSeedSchema = z.strictObject({
  basisFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  kind: sourceKindSchema,
  displayLocator: displaySourceLocatorSchema,
  fragment: z.string().min(1).optional(),
  binding: sourceBindingSchema.optional(),
});

export type SourceBinding = z.infer<typeof sourceBindingSchema>;
export type SourceBindingRole = z.infer<typeof sourceBindingRoleSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type SourceReferenceSeed = z.input<typeof sourceReferenceSeedSchema>;
