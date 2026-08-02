import { z } from "zod";
import {
  planningLineageRelationKeySchema,
  planningLineageSubjectSchema,
} from "../planning-lineage-route";
import { uniqueIdentityArraySchema } from "./projection-identity";
import { nonEmptyStringSchema, semanticPlainTextSchema } from "./schema-primitives";
import { sourceReferenceSchema } from "./source-schema";

const relationBaseShape = {
  key: planningLineageRelationKeySchema,
  label: semanticPlainTextSchema,
  direction: semanticPlainTextSchema,
  cardinality: z.enum(["one", "many"]),
  inParentPath: z.boolean(),
};

export const planningLineageRelationTargetSchema = z
  .strictObject({
    reference: nonEmptyStringSchema,
    label: semanticPlainTextSchema,
    availability: z.enum(["available", "unavailable"]),
    subject: planningLineageSubjectSchema.optional(),
    note: semanticPlainTextSchema.optional(),
  })
  .superRefine((target, context) => {
    if (target.availability === "unavailable" && target.note === undefined) {
      context.addIssue({
        code: "custom",
        path: ["note"],
        message: "An unavailable Planning Lineage target requires a scoped explanation.",
      });
    }
  });

const planningLineagePresentRelationSchema = z
  .strictObject({
    ...relationBaseShape,
    state: z.literal("present"),
    targets: z.array(planningLineageRelationTargetSchema).min(1),
    total: z.strictObject({
      count: z.number().int().positive(),
      coverage: z.enum(["complete", "at-least"]),
    }),
  })
  .superRefine((relation, context) => {
    if (relation.total.count !== relation.targets.length) {
      context.addIssue({
        code: "custom",
        path: ["total", "count"],
        message: "Planning Lineage relation total must match its materialized targets.",
      });
    }
    if (relation.cardinality === "one" && relation.targets.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["targets"],
        message: "A cardinality-one relation must contain exactly one target.",
      });
    }
  });

const unavailableRelationVariant = (state: "confirmed-none" | "unknown" | "unavailable") =>
  z.strictObject({
    ...relationBaseShape,
    state: z.literal(state),
    reason: semanticPlainTextSchema,
  });

export const planningLineageRelationSchema = z.union([
  planningLineagePresentRelationSchema,
  unavailableRelationVariant("confirmed-none"),
  unavailableRelationVariant("unknown"),
  unavailableRelationVariant("unavailable"),
]);

export const planningLineageParentPathSchema = z
  .strictObject({
    state: z.enum(["complete", "truncated-unknown", "truncated-unavailable"]),
    ancestors: uniqueIdentityArraySchema(
      planningLineageSubjectSchema,
      (subject) => `${subject.kind}:${subject.id}`,
    ),
    reason: semanticPlainTextSchema.optional(),
  })
  .superRefine((path, context) => {
    if (path.state === "complete" && path.reason !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A complete Canonical Parent Path cannot carry a truncation reason.",
      });
    }
    if (path.state !== "complete" && path.reason === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A truncated Canonical Parent Path requires a reason.",
      });
    }
  });

export const planningLineageSemanticSectionSchema = z.strictObject({
  role: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u),
  availability: z.enum(["available", "confirmed-empty", "unavailable", "unsupported"]),
});

const readingAvailabilitySchema = z.union([
  z.strictObject({ availability: z.literal("available"), value: nonEmptyStringSchema }),
  z.strictObject({ availability: z.literal("unavailable") }),
]);

export const nativeWorkReadingStateSchema = z.strictObject({
  conclusion: z.enum(["Complete", "Open work remains", "Can't verify", "Binding needs attention"]),
  impact: semanticPlainTextSchema,
  action: semanticPlainTextSchema,
  binding: z.union([
    z.strictObject({
      state: z.literal("bound"),
      effortIds: uniqueIdentityArraySchema(nonEmptyStringSchema, (id) => id),
    }),
    z.strictObject({
      state: z.literal("attention"),
      reason: z.enum([
        "binding-conflict",
        "bound-unresolved",
        "identity-mismatch",
        "root-kind-conflict",
      ]),
      effortIds: uniqueIdentityArraySchema(nonEmptyStringSchema, (id) => id),
    }),
  ]),
  why: z.strictObject({
    projectionState: z.enum(["available", "partial", "absent", "invalid", "missing"]),
    freshness: z.enum(["current", "stale", "undetermined"]),
    coverage: z.enum(["complete", "incomplete", "undetermined"]),
    completion: z.enum(["complete", "incomplete", "undetermined"]),
    blockingDiagnosticCount: z.number().int().nonnegative(),
    causes: z.array(semanticPlainTextSchema),
  }),
  observation: z.strictObject({
    sourceRevision: readingAvailabilitySchema,
    observedAt: readingAvailabilitySchema,
    sourceObservedAt: readingAvailabilitySchema,
    coverageDimensions: uniqueIdentityArraySchema(
      z.strictObject({
        key: nonEmptyStringSchema,
        state: z.enum(["covered", "excluded", "gap", "conflict"]),
        detail: nonEmptyStringSchema.optional(),
      }),
      (dimension) => dimension.key,
    ),
    validators: z.array(
      z.strictObject({ kind: nonEmptyStringSchema, value: nonEmptyStringSchema }),
    ),
    provenance: z.array(
      z.strictObject({ kind: nonEmptyStringSchema, value: nonEmptyStringSchema }),
    ),
    diagnostics: z.array(
      z.strictObject({
        origin: z.enum(["observation", "latest-attempt"]),
        code: nonEmptyStringSchema,
        impact: z.enum(["blocking", "non-blocking"]),
        target: nonEmptyStringSchema,
        message: nonEmptyStringSchema,
      }),
    ),
  }),
});

export const planningLineageSubjectProjectionSchema = z
  .strictObject({
    identity: planningLineageSubjectSchema,
    source: sourceReferenceSchema,
    parentPath: planningLineageParentPathSchema,
    semanticSections: uniqueIdentityArraySchema(
      planningLineageSemanticSectionSchema,
      (section) => section.role,
    ),
    nativeWorkReadingState: nativeWorkReadingStateSchema.optional(),
    relations: uniqueIdentityArraySchema(planningLineageRelationSchema, (relation) => relation.key),
  })
  .superRefine((subject, context) => {
    if (
      subject.parentPath.ancestors.some(
        (ancestor) =>
          ancestor.kind === subject.identity.kind && ancestor.id === subject.identity.id,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["parentPath", "ancestors"],
        message: "A Canonical Parent Path cannot contain its current subject.",
      });
    }
    if (subject.identity.kind === "native-scope" && subject.nativeWorkReadingState === undefined) {
      context.addIssue({
        code: "custom",
        path: ["nativeWorkReadingState"],
        message: "A native scope requires its generation-bound Native Work Reading State.",
      });
    }
    if (
      subject.identity.kind !== "native-scope" &&
      subject.identity.kind !== "effort" &&
      subject.nativeWorkReadingState !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["nativeWorkReadingState"],
        message: "Only an Effort or native scope may carry a Native Work Reading State.",
      });
    }
  });

export const planningLineageProjectionSchema = z.strictObject({
  subjects: uniqueIdentityArraySchema(
    planningLineageSubjectProjectionSchema,
    (subject) => `${subject.identity.kind}:${subject.identity.id}`,
  ),
});
