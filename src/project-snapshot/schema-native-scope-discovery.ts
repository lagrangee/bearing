import { z } from "zod";
import {
  discoveredNativeScopeSchema,
  NATIVE_SCOPE_DISCOVERY_PROVIDER,
} from "../native-scope-discovery-contract";
import { uniqueIdentityArraySchema } from "./projection-identity";
import { effortIdSchema, nonEmptyStringSchema } from "./schema-primitives";

const discoveryDiagnosticSchema = z.strictObject({
  code: nonEmptyStringSchema,
  class: z.enum([
    "source",
    "contract",
    "mapping",
    "permission",
    "acquisition",
    "network",
    "pagination",
    "format",
    "identity",
    "concurrency",
  ]),
  impact: z.enum(["blocking", "non-blocking"]),
  target: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
});

const latestAttemptSchema = z.strictObject({
  observationId: nonEmptyStringSchema,
  state: z.enum(["partial", "unavailable", "invalid", "unsupported"]),
  observedAt: z.iso.datetime({ offset: true }),
  diagnostics: z.array(discoveryDiagnosticSchema),
});

export const discoveredScopeProjectionSchema = z.strictObject({
  summary: discoveredNativeScopeSchema,
  bindingContext: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("unbound"),
      effortIds: z.array(effortIdSchema).length(0),
    }),
    z.strictObject({
      state: z.literal("bound"),
      effortIds: z.array(effortIdSchema).length(1),
    }),
    z.strictObject({
      state: z.literal("binding-conflict"),
      effortIds: uniqueIdentityArraySchema(effortIdSchema, (effortId) => effortId).min(2),
    }),
    z.strictObject({
      state: z.literal("bound-unresolved"),
      effortIds: uniqueIdentityArraySchema(effortIdSchema, (effortId) => effortId).max(1),
    }),
    z.strictObject({
      state: z.literal("identity-mismatch"),
      effortIds: uniqueIdentityArraySchema(effortIdSchema, (effortId) => effortId).min(1),
    }),
    z.strictObject({
      state: z.literal("root-kind-conflict"),
      effortIds: uniqueIdentityArraySchema(effortIdSchema, (effortId) => effortId).min(1),
    }),
  ]),
  detailAvailability: z.enum(["summary-only", "details-inspected"]),
});

const observedShape = {
  provider: z.literal(NATIVE_SCOPE_DISCOVERY_PROVIDER),
  observationId: nonEmptyStringSchema,
  observedAt: z.iso.datetime({ offset: true }),
  sourceRevision: nonEmptyStringSchema.optional(),
  freshness: z.enum(["current", "stale", "undetermined"]),
  coverage: z.enum(["complete", "incomplete"]),
  scopes: uniqueIdentityArraySchema(
    discoveredScopeProjectionSchema,
    (scope) => scope.summary.identity,
  ),
  count: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("exact"), value: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("at-least"), value: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal("unavailable") }),
  ]),
  confirmedUnboundEmpty: z.boolean(),
  diagnostics: z.array(discoveryDiagnosticSchema),
  latestAttempt: latestAttemptSchema.nullable(),
};

export const nativeScopeDiscoveryProjectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("never-run") }),
  z.strictObject({ state: z.literal("available"), ...observedShape }),
  z.strictObject({ state: z.literal("partial"), ...observedShape }),
  z.strictObject({ state: z.literal("unavailable"), ...observedShape }),
  z.strictObject({ state: z.literal("invalid"), ...observedShape }),
  z.strictObject({ state: z.literal("unsupported"), ...observedShape }),
]);
