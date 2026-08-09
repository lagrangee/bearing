import { z } from "zod";
import { nativeReferenceSchema } from "../native-reconciliation-contract";
import { planningLineageSubjectSchema } from "../planning-lineage-route";
import {
  authoritySchema,
  effortSchema,
  gateSchema,
  planningReviewSchema,
  roadmapSchema,
  structuralDiagnosticSchema,
} from "../project-generation/schema";
import { assetProjectionSchema } from "../project-generation/schema-asset";
import { planningAuditSchema } from "../project-generation/schema-audit";
import { projectBriefSchema } from "../project-generation/schema-brief";
import {
  planningLineageParentPathSchema,
  planningLineageRelationSchema,
  planningLineageSemanticSectionSchema,
} from "../project-generation/schema-planning-lineage";
import {
  projectionIssueSchema,
  singletonProjectionSchema,
} from "../project-generation/schema-projection";
import { roadmapIndexSchema } from "../project-generation/schema-roadmap-index";
import { projectSummarySchema } from "../project-generation/schema-summary";
import { sourceRecordSchema } from "../project-generation/source-schema";
import {
  providerObservationSelectionFreshnessIsCoherent,
  providerObservationSelectionSchema,
} from "../provider-evidence-contract";
import {
  mattNativeObjectForSubject,
  mattNativeScopeKey,
  mattNativeScopeSubject,
  sameMattNativeBindingDefinition,
} from "../providers/matt-skills-v1/native-subject";
import { mattSkillsV1ProviderObservationSchema } from "../providers/matt-skills-v1/schema";

export const PROJECT_READ_MODEL_STORAGE_VERSION = 1 as const;
export const PROJECT_READ_MODEL_PROJECTION_VERSION = 7 as const;
export const PROJECT_INSPECT_ENVELOPE_VERSION = 1 as const;

export const projectReadModelReceiptSchema = z.strictObject({
  basisFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  publishedAt: z.string().datetime({ offset: true }),
  publicationCount: z.number().int().positive(),
});

export type ProjectReadModelReceipt = Readonly<z.infer<typeof projectReadModelReceiptSchema>>;

export const planningReferenceSchema = z
  .string()
  .refine(
    (reference) =>
      /^(?:roadmap|gate|effort|asset|authority|planning-review):[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(
        reference,
      ) ||
      reference === "project-summary:current" ||
      reference === "project-brief:current",
    { message: "Expected one supported stable planning reference." },
  );

export type ProjectInspectRequest =
  | Readonly<{ kind: "project" }>
  | Readonly<{ kind: "planning-reference"; reference: string }>
  | Readonly<{ kind: "native-reference"; reference: string }>
  | Readonly<{ kind: "diagnostics" }>;

export type ProjectInspectOutcome =
  | "complete"
  | "partial"
  | "unfulfilled"
  | "recovery-required"
  | "need-update";

export type ProjectInspectEnvelope = Readonly<{
  schemaVersion: typeof PROJECT_INSPECT_ENVELOPE_VERSION;
  command: "inspect";
  outcome: ProjectInspectOutcome;
  request: ProjectInspectRequest;
  generation?: ProjectReadModelReceipt;
  result?: ProjectInspectResult;
  diagnostics: readonly z.infer<typeof structuralDiagnosticSchema>[];
}>;

export const projectContextResultSchema = z.strictObject({
  basis: z.strictObject({
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    publicationCount: z.number().int().positive(),
    publishedAt: z.string().datetime({ offset: true }),
  }),
  summary: z.union([
    z.strictObject({ validity: z.literal("available"), value: projectSummarySchema }),
    z.strictObject({ validity: z.enum(["absent", "invalid"]) }),
  ]),
  brief: z.union([
    z.strictObject({ validity: z.literal("available"), value: projectBriefSchema }),
    z.strictObject({ validity: z.enum(["absent", "invalid"]) }),
  ]),
  sources: z.array(sourceRecordSchema).max(100),
  roadmapFocus: z
    .array(
      z.strictObject({
        roadmap: z.strictObject({
          id: z.string(),
          title: z.string(),
          lifecycle: z.string(),
        }),
        focusedGate: z
          .strictObject({
            id: z.string(),
            title: z.string(),
            lifecycle: z.string(),
            readiness: z.string(),
          })
          .optional(),
      }),
    )
    .max(50),
  scopeOutline: z
    .array(
      z.strictObject({
        effortId: z.string(),
        title: z.string(),
        lifecycle: z.string(),
        targetGateId: z.string(),
        binding: z.union([
          z.strictObject({ state: z.literal("bound"), nativeScope: z.string() }),
          z.strictObject({ state: z.literal("attention"), reason: z.string() }),
        ]),
      }),
    )
    .max(100),
  attentionCount: z.number().int().nonnegative(),
  diagnosticCounts: z.strictObject({
    blocking: z.number().int().nonnegative(),
    nonBlocking: z.number().int().nonnegative(),
  }),
  deeperReads: z.array(planningReferenceSchema),
});

export const projectReadModelObjectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project-summary"), value: projectSummarySchema }),
  z.strictObject({ kind: z.literal("project-brief"), value: projectBriefSchema }),
  z.strictObject({ kind: z.literal("roadmap"), value: roadmapSchema }),
  z.strictObject({ kind: z.literal("gate"), value: gateSchema }),
  z.strictObject({ kind: z.literal("effort"), value: effortSchema }),
  z.strictObject({ kind: z.literal("authority"), value: authoritySchema }),
  z.strictObject({ kind: z.literal("asset"), value: assetProjectionSchema }),
  z.strictObject({ kind: z.literal("planning-review"), value: planningReviewSchema }),
  z.strictObject({
    kind: z.literal("portal-native-evidence"),
    value: z.strictObject({
      id: z.string().startsWith("portal-native-evidence:"),
      subjectReference: z.string().min(1),
      role: z.enum(["bound", "detail"]),
      selection: providerObservationSelectionSchema,
      observation: mattSkillsV1ProviderObservationSchema.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("portal-reference-title"),
    value: z.strictObject({
      id: z.string().startsWith("portal-reference-title:"),
      reference: z.string().min(1),
      title: z.string().min(1),
    }),
  }),
  z.strictObject({
    kind: z.literal("portal-find-document"),
    value: z.strictObject({
      id: z.string().startsWith("portal-find-document:"),
      document: z.strictObject({
        id: z.string().min(1),
        subject: z.union([
          planningLineageSubjectSchema,
          z.strictObject({ kind: z.literal("audit"), id: z.literal("planning-audit:current") }),
        ]),
        subjectType: z.string().min(1),
        title: z.string().min(1),
        parentPath: z.array(z.string()).max(20),
        fields: z
          .array(
            z.strictObject({
              key: z.enum([
                "identity",
                "title",
                "intent",
                "criteria",
                "passage",
                "decision",
                "nativeBody",
                "summary",
              ]),
              label: z.string().min(1),
              text: z.string().max(16_384),
              anchor: z.string().optional(),
              anchorAvailable: z.boolean().optional(),
            }),
          )
          .max(40),
        fallbackExcerpt: z.string(),
      }),
    }),
  }),
  z.strictObject({
    kind: z.literal("portal-find-state"),
    value: z.strictObject({
      id: z.literal("portal-find-state:current"),
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
  }),
  z.strictObject({
    kind: z.literal("portal-projection-state"),
    value: z.strictObject({
      id: z.string().startsWith("portal-projection:"),
      projection: z.enum([
        "summary",
        "brief",
        "roadmaps",
        "gates",
        "efforts",
        "authorities",
        "assets",
        "reviews",
      ]),
      validity: z.enum(["available", "absent", "partial", "invalid"]),
      issues: z.array(projectionIssueSchema).max(100).optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("portal-roadmap-index"),
    value: z.strictObject({
      id: z.literal("portal-projection:roadmap-index"),
      projection: singletonProjectionSchema(roadmapIndexSchema),
    }),
  }),
  z.strictObject({
    kind: z.literal("portal-audit"),
    value: z.strictObject({
      id: z.literal("portal-projection:audit"),
      projection: singletonProjectionSchema(planningAuditSchema),
    }),
  }),
]);

export type ProjectReadModelObject = z.infer<typeof projectReadModelObjectSchema>;
export type ProjectReadModelProjectionName = Extract<
  ProjectReadModelObject,
  { kind: "portal-projection-state" }
>["value"]["projection"];

export const assertProjectReadModelObjectIdentity = (
  reference: string,
  object: ProjectReadModelObject,
): void => {
  if (object.value.id !== reference) {
    throw new Error("Project Read Model object identity is inconsistent.");
  }
  const expectedReference = (() => {
    switch (object.kind) {
      case "portal-native-evidence":
        return `portal-native-evidence:${object.value.role}:${object.value.subjectReference}`;
      case "portal-reference-title":
        return `portal-reference-title:${object.value.reference}`;
      case "portal-find-document":
        return `portal-find-document:${object.value.document.id}`;
      case "portal-projection-state":
        return `portal-projection:${object.value.projection}`;
      default:
        return object.value.id;
    }
  })();
  if (reference !== expectedReference) {
    throw new Error("Project Read Model object identity is inconsistent.");
  }
  if (object.kind !== "portal-native-evidence") return;
  const { observation, selection, subjectReference } = object.value;
  if (
    selection.observationId !== (observation?.id ?? null) ||
    (observation !== undefined &&
      (!sameMattNativeBindingDefinition(selection, observation.binding) ||
        !providerObservationSelectionFreshnessIsCoherent(selection, observation)))
  ) {
    throw new Error("Project Read Model native evidence identity is inconsistent.");
  }
  if (subjectReference.startsWith("native-scope:")) {
    if (subjectReference !== `native-scope:${mattNativeScopeSubject({ binding: selection }).id}`) {
      throw new Error("Project Read Model native evidence subject is inconsistent.");
    }
    return;
  }
  if (subjectReference.startsWith("native-subject:")) {
    const subjectId = subjectReference.slice("native-subject:".length);
    if (
      observation === undefined ||
      mattNativeObjectForSubject([observation], { kind: "native-subject", id: subjectId }) ===
        undefined
    ) {
      throw new Error("Project Read Model native evidence subject is inconsistent.");
    }
    return;
  }
  if (!/^effort:[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(subjectReference)) {
    throw new Error("Project Read Model native evidence subject is inconsistent.");
  }
};

export const assertProjectReadModelObjectRelationships = (
  objects: readonly ProjectReadModelObject[],
  options: Readonly<{
    requiredProjections?: readonly ProjectReadModelProjectionName[];
    completeProjections?: readonly ProjectReadModelProjectionName[];
  }> = {},
): void => {
  const efforts = new Map<string, Extract<ProjectReadModelObject, { kind: "effort" }>["value"]>(
    objects.flatMap((object) =>
      object.kind === "effort" ? [[object.value.id, object.value] as const] : [],
    ),
  );
  for (const object of objects) {
    if (
      object.kind !== "portal-native-evidence" ||
      !object.value.subjectReference.startsWith("effort:")
    ) {
      continue;
    }
    const effort = efforts.get(object.value.subjectReference);
    if (
      effort?.workBinding === undefined ||
      mattNativeScopeKey(effort.workBinding) !== mattNativeScopeKey(object.value.selection)
    ) {
      throw new Error("Project Read Model native evidence subject is inconsistent.");
    }
  }
  const projectionKinds = {
    summary: "project-summary",
    brief: "project-brief",
    roadmaps: "roadmap",
    gates: "gate",
    efforts: "effort",
    authorities: "authority",
    assets: "asset",
    reviews: "planning-review",
  } as const satisfies Readonly<Record<ProjectReadModelProjectionName, string>>;
  const allProjections = Object.keys(projectionKinds) as ProjectReadModelProjectionName[];
  const requiredProjections = options.requiredProjections ?? allProjections;
  const completeProjections = new Set(options.completeProjections ?? allProjections);
  for (const projection of requiredProjections) {
    const state = objects.find(
      (object) =>
        object.kind === "portal-projection-state" && object.value.projection === projection,
    );
    if (state?.kind !== "portal-projection-state") {
      throw new Error("Project Read Model projection state is missing.");
    }
    const count = objects.filter((object) => object.kind === projectionKinds[projection]).length;
    const singleton = projection === "summary" || projection === "brief";
    if (singleton) {
      const expectsValue =
        state.value.validity === "available" || state.value.validity === "partial";
      if (count !== (expectsValue ? 1 : 0)) {
        throw new Error("Project Read Model singleton projection cardinality is inconsistent.");
      }
      continue;
    }
    if (state.value.validity === "absent") {
      throw new Error("Project Read Model collection projection state is inconsistent.");
    }
    if (state.value.validity === "invalid" && count !== 0) {
      throw new Error("Project Read Model collection projection cardinality is inconsistent.");
    }
    if (completeProjections.has(projection) && state.value.validity === "partial" && count === 0) {
      throw new Error("Project Read Model collection projection cardinality is inconsistent.");
    }
  }
  if (options.requiredProjections === undefined) {
    for (const kind of ["portal-find-state", "portal-roadmap-index", "portal-audit"] as const) {
      if (objects.filter((object) => object.kind === kind).length !== 1) {
        throw new Error("Project Read Model singleton Portal object is missing.");
      }
    }
  }
};

export const planningInspectResultSchema = z.strictObject({
  target: projectReadModelObjectSchema,
  directRelations: z.array(planningLineageRelationSchema),
  coverage: z.union([
    z.strictObject({ state: z.literal("unavailable") }),
    z.strictObject({
      state: z.literal("available"),
      parentPath: planningLineageParentPathSchema,
      semanticSections: z.array(planningLineageSemanticSectionSchema),
    }),
  ]),
  diagnostics: z.array(structuralDiagnosticSchema),
  revision: z.strictObject({
    generationFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    source: sourceRecordSchema.optional(),
  }),
});

export const nativeInspectResultSchema = z.strictObject({
  reference: nativeReferenceSchema,
  binding: z.union([
    z.strictObject({ state: z.literal("unbound") }),
    z.strictObject({
      state: z.literal("bound"),
      provider: z.literal("matt-skills/v1"),
      nativeScope: z.string().min(1),
      role: z.literal("bound"),
      observationId: z.string().nullable(),
      effectiveFreshness: z.enum(["current", "stale", "undetermined"]),
      planningReferences: z.array(planningReferenceSchema),
    }),
  ]),
  coverage: z.union([
    z.strictObject({ state: z.literal("unavailable") }),
    z.strictObject({
      state: z.literal("available"),
      assessment: z.enum(["complete", "incomplete"]),
      completion: z.enum(["complete", "incomplete", "undetermined"]),
    }),
  ]),
  generationFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});

export type ProjectContextResult = Readonly<z.infer<typeof projectContextResultSchema>>;
export type PlanningInspectResult = Readonly<z.infer<typeof planningInspectResultSchema>>;
export type NativeInspectResult = Readonly<z.infer<typeof nativeInspectResultSchema>>;
export type ProjectInspectResult =
  | ProjectContextResult
  | PlanningInspectResult
  | NativeInspectResult
  | readonly z.infer<typeof structuralDiagnosticSchema>[]
  | Readonly<{ reason: string }>;
