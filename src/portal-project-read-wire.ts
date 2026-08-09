import { z } from "zod";
import { catalogAvailabilitySchema } from "./catalog/availability";
import { planningLineageSubjectSchema } from "./planning-lineage-route";
import { attentionItemSchema, structuralDiagnosticSchema } from "./project-generation/schema";
import { planningLineageSubjectProjectionSchema } from "./project-generation/schema-planning-lineage";
import { sourceRecordSchema } from "./project-generation/source-schema";
import { projectReadModelObjectSchema } from "./project-read-model/contract";

const diagnosticSchema = z.strictObject({ code: z.string().min(1), message: z.string().min(1) });

export const portalProjectSectionSchema = z.enum([
  "overview",
  "roadmaps",
  "assets",
  "audit",
  "lineage",
]);

export type PortalProjectSection = z.infer<typeof portalProjectSectionSchema>;

const projectIdentitySchema = z.strictObject({
  entryId: z.string().min(1),
  displayName: z.string().min(1),
  availability: catalogAvailabilitySchema.extract(["available"]),
});

const projectUnavailableSchema = z.strictObject({
  entryId: z.string().min(1),
  displayName: z.string().min(1),
  availability: catalogAvailabilitySchema,
});

export const portalProjectRowsSchema = z.strictObject({
  section: portalProjectSectionSchema,
  target: planningLineageSubjectSchema.optional(),
  nativeTargetState: z.enum(["covered-missing", "unavailable"]).optional(),
  assetSourceProbe: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("external"),
        href: z.string().url().startsWith("https://"),
        verification: z.literal("unverified"),
      }),
      z.strictObject({
        kind: z.literal("local"),
        locator: z.string().min(1),
        availability: z.enum(["file", "directory", "missing", "unreadable", "unsafe"]),
      }),
    ])
    .optional(),
  objects: z.array(projectReadModelObjectSchema).max(500),
  lineage: z.array(planningLineageSubjectProjectionSchema).max(500),
  attentionCount: z.number().int().nonnegative(),
  attention: z.array(attentionItemSchema).max(500),
  diagnostics: z.array(structuralDiagnosticSchema).max(500),
  sources: z.array(sourceRecordSchema).max(500),
  renderedMarkdown: z.array(
    z.strictObject({
      markdown: z.string(),
      html: z.string(),
      presentation: z.enum(["rendered", "fallback"]),
    }),
  ),
});

export const portalProjectReadEnvelopeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    version: z.literal(1),
    state: z.literal("ready"),
    project: projectIdentitySchema,
    rows: portalProjectRowsSchema,
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
    error: diagnosticSchema,
    session: z.strictObject({ csrfToken: z.string().min(1) }),
  }),
]);

export const portalProjectFindEnvelopeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    version: z.literal(1),
    state: z.literal("ready"),
    results: z
      .array(
        z.strictObject({
          subject: z.strictObject({ kind: z.string().min(1), id: z.string().min(1) }),
          subjectType: z.string().min(1),
          title: z.string().min(1),
          excerpt: z.string(),
          parentPath: z.array(z.string()).max(20),
          href: z.string().startsWith("/projects/"),
          score: z.number(),
        }),
      )
      .max(20),
    scopeState: z.union([
      z.strictObject({ state: z.literal("available") }),
      z.strictObject({
        state: z.enum(["invalid", "partial", "stale", "unavailable"]),
        cause: z.string(),
        impact: z.string(),
        nextStep: z.string(),
      }),
    ]),
  }),
  z.strictObject({
    version: z.literal(1),
    state: z.literal("failed"),
    error: diagnosticSchema,
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
  : Value extends readonly unknown[]
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

export type PortalProjectRows = DeepReadonly<z.infer<typeof portalProjectRowsSchema>>;
export type PortalProjectReadEnvelope = DeepReadonly<
  z.infer<typeof portalProjectReadEnvelopeSchema>
>;
export type PortalProjectFindEnvelope = DeepReadonly<
  z.infer<typeof portalProjectFindEnvelopeSchema>
>;
