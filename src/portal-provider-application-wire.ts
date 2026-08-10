import { z } from "zod";
import { nativeReferenceSchema } from "./native-reconciliation-contract";

const bindingSchema = z.strictObject({
  provider: z.literal("matt-skills/v1"),
  nativeScope: nativeReferenceSchema,
});

export const portalProviderApplicationRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    version: z.literal(1),
    action: z.literal("item-refresh"),
    binding: bindingSchema,
    subject: nativeReferenceSchema,
  }),
  z.strictObject({
    version: z.literal(1),
    action: z.literal("source-load"),
    binding: bindingSchema,
  }),
  z.strictObject({
    version: z.literal(1),
    action: z.literal("all-sources-refresh"),
    confirmation: z.literal("refresh-all-current-sources"),
  }),
]);

export type PortalProviderApplicationRequest = z.infer<
  typeof portalProviderApplicationRequestSchema
>;

export const portalProviderConditionSchema = z.enum([
  "baseline-missing",
  "provider-auth",
  "provider-rate-limit",
  "provider-network",
  "provider-unavailable",
  "storage-recovery-required",
  "need-update",
  "removal-required",
]);

const observationSchema = z.strictObject({
  scope: nativeReferenceSchema,
  disposition: z.enum(["captured", "retained-after-failure", "unavailable"]),
  observedAt: z.iso.datetime({ offset: true }).optional(),
});

const diagnosticSchema = z.strictObject({
  reference: z.string().min(1),
  summary: z.string().min(1),
});

const baseResponseSchema = z.strictObject({
  version: z.literal(1),
  action: z.enum(["item-refresh", "source-load", "all-sources-refresh"]),
  acquisitionCount: z.number().int().nonnegative(),
  observations: z.array(observationSchema),
  diagnostics: z.array(diagnosticSchema),
});

export const portalProviderApplicationResponseSchema = z.discriminatedUnion("state", [
  baseResponseSchema.extend({ state: z.literal("completed") }),
  baseResponseSchema.extend({
    state: z.literal("attention"),
    condition: portalProviderConditionSchema,
    explanation: z.string().min(1),
    nextAction: z.string().min(1),
  }),
]);

export type PortalProviderApplicationResponse = z.infer<
  typeof portalProviderApplicationResponseSchema
>;
