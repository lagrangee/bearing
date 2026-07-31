import { z } from "zod";
import { catalogAvailabilitySchema } from "./catalog/availability";
import { nativeReconciliationRequestSchema } from "./native-reconciliation-contract";
import {
  nativeScopeInspectionSubjectSchema,
  nativeSubjectIdSchema,
} from "./planning-lineage-route";
import { projectSnapshotSchema } from "./project-snapshot/schema";
import { syncReceiptSchema } from "./sync-receipt-schema";

const diagnosticSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const projectValidationSchema = z.strictObject({
  due: z.boolean(),
  cooldownRemainingMs: z.number().nonnegative(),
  inFlight: z.boolean(),
});

const projectIdentitySchema = z.strictObject({
  entryId: z.string().min(1),
  displayName: z.string().min(1),
  availability: catalogAvailabilitySchema.extract(["available"]),
});

export const projectUnavailableSchema = z.strictObject({
  entryId: z.string().min(1),
  displayName: z.string().min(1),
  availability: catalogAvailabilitySchema,
});

export const snapshotCacheSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), snapshot: projectSnapshotSchema }),
  z.strictObject({ state: z.literal("behind"), snapshot: projectSnapshotSchema }),
  z.strictObject({ state: z.literal("missing") }),
  z.strictObject({ state: z.literal("malformed"), diagnostic: diagnosticSchema }),
  z.strictObject({ state: z.literal("version-mismatch"), diagnostic: diagnosticSchema }),
]);

export const projectViewSchema = z.strictObject({
  project: projectIdentitySchema,
  cache: z.strictObject({
    snapshot: snapshotCacheSchema,
    receipt: syncReceiptSchema.nullable(),
    retained: z.boolean(),
  }),
  diagnosticCounts: z
    .strictObject({
      blocking: z.number().int().nonnegative(),
      nonBlocking: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .nullable(),
});

export const projectOperationErrorSchema = z.strictObject({
  code: z.enum([
    "request-failed",
    "project-unavailable",
    "unsafe-project-cache",
    "input-validation-failed",
    "sync-failed",
    "snapshot-materialization-failed",
    "snapshot-write-failed",
  ]),
  message: z.string().min(1),
});

export const projectSyncRequestSchema = z.strictObject({
  version: z.literal(1),
  mode: z.enum(["ensure-current", "force"]),
});

export const projectDiscoveryRequestSchema = z.strictObject({
  version: z.literal(1),
});

export const projectNativeScopeInspectionRequestSchema = z.strictObject({
  version: z.literal(1),
  subject: nativeScopeInspectionSubjectSchema,
  target: z.strictObject({
    provider: z.literal("matt-skills/v1"),
    nativeScope: nativeSubjectIdSchema,
  }),
  refresh: z.boolean(),
});

export const projectNativeReconciliationRequestSchema = nativeReconciliationRequestSchema;

export const projectSnapshotEnvelopeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    version: z.literal(1),
    state: z.literal("ready"),
    view: projectViewSchema,
    validation: projectValidationSchema,
    session: z.strictObject({ csrfToken: z.string().min(1) }),
  }),
  z.strictObject({
    version: z.literal(1),
    state: z.literal("unavailable"),
    project: projectUnavailableSchema,
    diagnostic: diagnosticSchema,
    session: z.strictObject({ csrfToken: z.string().min(1) }),
  }),
  z.strictObject({
    version: z.literal(1),
    state: z.literal("failed"),
    error: projectOperationErrorSchema,
    session: z.strictObject({ csrfToken: z.string().min(1) }),
  }),
]);

const completedShape = {
  version: z.literal(1),
  state: z.literal("completed"),
  reconciliation: z.enum(["applied", "no-op"]).optional(),
  snapshotDisposition: z.enum(["reused", "materialized"]),
  view: projectViewSchema,
  validation: projectValidationSchema,
};

const failedShape = {
  version: z.literal(1),
  state: z.literal("failed"),
  mode: z.enum(["ensure-current", "force"]),
  outcome: z.literal("failed"),
  error: projectOperationErrorSchema,
  validation: projectValidationSchema,
};

const failedSchema = z.union([
  z.strictObject({
    ...failedShape,
    view: projectViewSchema,
    viewDisposition: z.never().optional(),
  }),
  z.strictObject({
    ...failedShape,
    view: z.never().optional(),
    viewDisposition: z.literal("discard"),
  }),
  z.strictObject({
    ...failedShape,
    view: z.never().optional(),
    viewDisposition: z.never().optional(),
  }),
]);

export const projectSyncEnvelopeSchema = z.union([
  z.strictObject({
    ...completedShape,
    mode: z.literal("ensure-current"),
    outcome: z.enum(["checked", "materialized", "synced"]),
  }),
  z.strictObject({
    ...completedShape,
    mode: z.literal("force"),
    outcome: z.enum(["applied", "no-op"]),
  }),
  z.strictObject({
    version: z.literal(1),
    state: z.literal("cooldown"),
    mode: z.literal("ensure-current"),
    outcome: z.literal("cooldown"),
    view: projectViewSchema,
    validation: projectValidationSchema,
  }),
  failedSchema,
  z.strictObject({
    version: z.literal(1),
    state: z.literal("unavailable"),
    project: projectUnavailableSchema,
    diagnostic: diagnosticSchema,
  }),
]);

type DeepReadonly<Value> = Value extends
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  ? Value
  : Value extends (...arguments_: never[]) => unknown
    ? Value
    : Value extends readonly unknown[]
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;

export type ProjectSyncRequest = DeepReadonly<z.infer<typeof projectSyncRequestSchema>>;
export type ProjectDiscoveryRequest = DeepReadonly<z.infer<typeof projectDiscoveryRequestSchema>>;
export type ProjectValidation = DeepReadonly<z.infer<typeof projectValidationSchema>>;
export type SnapshotCacheView = DeepReadonly<z.infer<typeof snapshotCacheSchema>>;
export type ProjectView = DeepReadonly<z.infer<typeof projectViewSchema>>;
export type ProjectUnavailableView = DeepReadonly<z.infer<typeof projectUnavailableSchema>>;
export type ProjectOperationError = DeepReadonly<z.infer<typeof projectOperationErrorSchema>>;
export type ProjectSnapshotApiResponse = DeepReadonly<
  z.infer<typeof projectSnapshotEnvelopeSchema>
>;
export type ProjectSnapshotEnvelope = Exclude<
  ProjectSnapshotApiResponse,
  Readonly<{ state: "failed" }>
>;
export type ProjectSyncApiResponse = DeepReadonly<z.infer<typeof projectSyncEnvelopeSchema>>;
export type ProjectSyncEnvelope = ProjectSyncApiResponse;
export type ProjectFailureView =
  | Readonly<{ view: ProjectView; viewDisposition?: never }>
  | Readonly<{ view?: never; viewDisposition: "discard" }>
  | Readonly<{ view?: never; viewDisposition?: never }>;
