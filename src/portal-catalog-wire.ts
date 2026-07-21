import { z } from "zod";
import { catalogAvailabilitySchema } from "./catalog/availability";
import { catalogEntryIdSchema } from "./catalog/entry-id";

export const portalCatalogEntrySchema = z.strictObject({
  entryId: catalogEntryIdSchema,
  displayName: z.string().min(1),
  repoRoot: z.string().min(1),
  availability: catalogAvailabilitySchema,
  detail: z.string().min(1).optional(),
});

const portalSessionSchema = z.strictObject({ csrfToken: z.string().min(1) });
const portalCatalogDiagnosticSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
});

const portalCatalogEnvelopeBase = {
  version: z.literal(1),
  entries: z.array(portalCatalogEntrySchema),
  session: portalSessionSchema,
};

export const portalCatalogEnvelopeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    ...portalCatalogEnvelopeBase,
    state: z.literal("ready"),
  }),
  z.strictObject({
    ...portalCatalogEnvelopeBase,
    state: z.literal("degraded"),
    diagnostic: portalCatalogDiagnosticSchema,
  }),
  z.strictObject({
    ...portalCatalogEnvelopeBase,
    state: z.literal("failed"),
    entries: z.tuple([]),
    diagnostic: portalCatalogDiagnosticSchema,
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

export type PortalCatalogEntry = DeepReadonly<z.infer<typeof portalCatalogEntrySchema>>;
export type PortalCatalogEnvelope = DeepReadonly<z.infer<typeof portalCatalogEnvelopeSchema>>;
