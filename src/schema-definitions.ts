import { z } from "zod";
import { isPlanningAuditCoverageConsistent } from "./audit-coverage";
import { languageTagSchema } from "./language-tag";
import { isPlainText } from "./plain-text";
import {
  displayAssetLocatorSchema,
  displaySourceLocatorSchema,
  nonBlankStringSchema,
  planningReferenceSchema,
} from "./reference-schema";

const uniqueArray = <T>(schema: z.ZodType<T>) =>
  z.array(schema).refine((items) => new Set(items).size === items.length, {
    message: "Entries must be unique.",
  });
const stableIdSchema = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}:[a-z0-9]+(?:-[a-z0-9]+)*$`, "u"));
const roadmapIdSchema = stableIdSchema("roadmap");
const gateIdSchema = stableIdSchema("gate");
const effortIdSchema = stableIdSchema("effort");
const authorityIdSchema = stableIdSchema("authority");
const assetIdSchema = stableIdSchema("asset");
const alignmentCheckIdSchema = stableIdSchema("alignment-check");
const planningReviewIdSchema = stableIdSchema("planning-review");
const PLANNING_AUDIT_INPUT = ".bearing/state/planning-audit.md";
const requiredPlainTextSchema = z
  .string()
  .refine((value) => value.trim().length > 0 && isPlainText(value), {
    message: "Semantic text must be non-empty plain UTF-8 text.",
  });

export const citationSchema = z.strictObject({
  Asset: assetIdSchema,
  Note: requiredPlainTextSchema,
});
export type Citation = z.infer<typeof citationSchema>;

const citationsSchema = z.array(citationSchema).optional();
const passageSchema = z.looseObject({
  "Accepted decision": requiredPlainTextSchema,
  Rationale: requiredPlainTextSchema,
  Evidence: uniqueArray(assetIdSchema),
  Exceptions: z.array(requiredPlainTextSchema),
});
const resolutionSchema = z.looseObject({
  "Accepted decision": requiredPlainTextSchema,
  Rationale: requiredPlainTextSchema,
  "Changed references": z.array(planningReferenceSchema),
});
const producerSchema = z.looseObject({
  Kind: requiredPlainTextSchema,
  Name: requiredPlainTextSchema,
  Reference: nonBlankStringSchema.optional(),
});
const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const advisoryInputsSchema = uniqueArray(displaySourceLocatorSchema);
const utcSourceEventTimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), {
    message: "Bearing-owned Source Event Time must be UTC.",
  })
  .nullable();
const effortConclusionSchema = z
  .looseObject({
    Disposition: z.enum(["completed", "withdrawn", "superseded"]),
    Rationale: requiredPlainTextSchema,
    "Concluded at": utcSourceEventTimeSchema,
    "Replacement effort": effortIdSchema.optional(),
  })
  .superRefine((conclusion, context) => {
    const replacement = conclusion["Replacement effort"];
    if (conclusion.Disposition === "superseded" && replacement === undefined) {
      context.addIssue({
        code: "custom",
        path: ["Replacement effort"],
        message: "A superseded Effort conclusion requires its replacement Effort.",
      });
    }
    if (conclusion.Disposition !== "superseded" && replacement !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["Replacement effort"],
        message: "Only a superseded Effort conclusion may name a replacement Effort.",
      });
    }
  });
const planningAuditSchema = z
  .strictObject({
    Type: z.literal("planning-audit"),
    ID: z.literal("planning-audit:current"),
    Title: z.string().min(1).optional(),
    "Generated at": nonBlankStringSchema,
    Inputs: advisoryInputsSchema,
    "Input fingerprint": fingerprintSchema,
    Coverage: z.enum(["complete", "incomplete"]),
    "Skipped targets": uniqueArray(planningReferenceSchema),
  })
  .superRefine((audit, context) => {
    if (isPlanningAuditCoverageConsistent(audit.Coverage, audit["Skipped targets"])) return;
    context.addIssue({
      code: "custom",
      path: ["Skipped targets"],
      message: "Audit coverage must match its skipped targets.",
    });
  });
const nextWorkGuidanceSchema = z
  .strictObject({
    Type: z.literal("next-work-guidance"),
    ID: z.literal("next-work-guidance:current"),
    Title: z.string().min(1).optional(),
    "Generated at": nonBlankStringSchema,
    Inputs: advisoryInputsSchema,
    "Input fingerprint": fingerprintSchema,
    "Semantic coverage": z.enum(["absent", "partial", "complete"]),
    "Based on audit": z.literal("planning-audit:current").optional(),
  })
  .superRefine((guidance, context) => {
    const basedOnAudit = guidance["Based on audit"];
    const includesAudit = guidance.Inputs.includes(PLANNING_AUDIT_INPUT);
    if (guidance["Semantic coverage"] === "absent" && basedOnAudit !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["Based on audit"],
        message: "Absent semantic coverage cannot reference an Audit.",
      });
    }
    if (guidance["Semantic coverage"] !== "absent" && basedOnAudit === undefined) {
      context.addIssue({
        code: "custom",
        path: ["Based on audit"],
        message: "Partial or complete semantic coverage requires the current Audit.",
      });
    }
    if (guidance["Semantic coverage"] === "absent" && includesAudit) {
      context.addIssue({
        code: "custom",
        path: ["Inputs"],
        message: "Absent semantic coverage cannot include the current Audit input.",
      });
    }
    if (guidance["Semantic coverage"] !== "absent" && !includesAudit) {
      context.addIssue({
        code: "custom",
        path: ["Inputs"],
        message: "Partial or complete semantic coverage requires the current Audit input.",
      });
    }
  });
export const assetSchema = z
  .looseObject({
    ID: assetIdSchema,
    Title: requiredPlainTextSchema,
    Kind: requiredPlainTextSchema,
    Location: displayAssetLocatorSchema,
    Owner: planningReferenceSchema,
    Producer: producerSchema,
    "Lifecycle source": z.enum(["native", "registry"]),
    Disposition: z.enum(["available", "superseded", "archived"]).optional(),
    "Superseded by": assetIdSchema.optional(),
    "Produced for": planningReferenceSchema.optional(),
  })
  .superRefine((asset, context) => {
    if (asset.Kind === "execution-evidence" && asset["Produced for"] === undefined) {
      context.addIssue({
        code: "custom",
        path: ["Produced for"],
        message: "Execution Evidence requires Produced for.",
      });
    }
    if (asset.Kind === "execution-evidence" && asset.Producer.Kind !== "executor-profile") {
      context.addIssue({
        code: "custom",
        path: ["Producer", "Kind"],
        message: "Execution Evidence requires executor-profile Producer provenance.",
      });
    }
  });

export const bearingSchema = z.discriminatedUnion("Type", [
  z.strictObject({
    Type: z.literal("project-summary"),
    ID: z.literal("project-summary:current"),
    Title: requiredPlainTextSchema,
    Languages: z
      .strictObject({
        Purpose: languageTagSchema.optional(),
        "Current Design": languageTagSchema.optional(),
      })
      .optional(),
  }),
  z.looseObject({
    Type: z.literal("roadmap-index"),
    Roadmaps: uniqueArray(roadmapIdSchema),
  }),
  z.looseObject({
    Type: z.literal("roadmap"),
    ID: roadmapIdSchema,
    Title: requiredPlainTextSchema,
    Status: z.enum(["active", "completed", "superseded"]),
    "Focused gate": gateIdSchema.nullable(),
    "Gate order": uniqueArray(gateIdSchema),
    Citations: citationsSchema,
  }),
  z.looseObject({
    Type: z.literal("milestone-gate"),
    ID: gateIdSchema,
    Title: requiredPlainTextSchema,
    Roadmap: roadmapIdSchema,
    Status: z.enum(["planned", "active", "passed", "superseded"]),
    Passage: passageSchema.optional(),
    Citations: citationsSchema,
  }),
  z
    .looseObject({
      Type: z.literal("effort"),
      ID: effortIdSchema,
      Title: requiredPlainTextSchema,
      Roadmap: roadmapIdSchema,
      "Target gate": gateIdSchema,
      Authorities: uniqueArray(authorityIdSchema),
      Citations: z.array(citationSchema),
      Lifecycle: z.enum(["planned", "active", "concluded"]),
      "Planned at": utcSourceEventTimeSchema,
      "Activated at": utcSourceEventTimeSchema.optional(),
      Conclusion: effortConclusionSchema.optional(),
      "Work binding": z
        .strictObject({
          Provider: z.literal("matt-skills/v1"),
          "Native scope": displaySourceLocatorSchema,
        })
        .optional(),
    })
    .superRefine((effort, context) => {
      if (effort.Lifecycle === "planned") {
        if (effort["Activated at"] !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["Activated at"],
            message: "A planned Effort cannot have an activation event.",
          });
        }
        if (effort.Conclusion !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["Conclusion"],
            message: "A planned Effort cannot have a conclusion.",
          });
        }
        return;
      }
      if (effort["Activated at"] === undefined) {
        context.addIssue({
          code: "custom",
          path: ["Activated at"],
          message: "An active or concluded Effort requires its activation event.",
        });
      }
      if (effort.Lifecycle === "active" && effort.Conclusion !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["Conclusion"],
          message: "An active Effort cannot have a conclusion.",
        });
      }
      if (effort.Lifecycle === "concluded" && effort.Conclusion === undefined) {
        context.addIssue({
          code: "custom",
          path: ["Conclusion"],
          message: "A concluded Effort requires its explicit conclusion.",
        });
      }
    }),
  z.looseObject({
    Type: z.literal("authority"),
    ID: authorityIdSchema,
    Title: requiredPlainTextSchema,
    Baseline: uniqueArray(assetIdSchema),
    Citations: citationsSchema,
  }),
  z.looseObject({
    Type: z.literal("asset-registry"),
    Assets: z.array(assetSchema),
  }),
  z.looseObject({
    Type: z.literal("alignment-check"),
    ID: alignmentCheckIdSchema,
    Title: requiredPlainTextSchema,
    Status: z.enum(["open", "resolved"]),
    Target: planningReferenceSchema,
    Inputs: z.array(z.string()),
    "Input fingerprint": fingerprintSchema,
    Resolution: resolutionSchema.optional(),
    Citations: citationsSchema,
  }),
  z.looseObject({
    Type: z.literal("planning-review"),
    ID: planningReviewIdSchema,
    Title: requiredPlainTextSchema,
    Status: z.enum(["pending", "completed"]),
    Scope: requiredPlainTextSchema,
    Inputs: z.array(z.string()),
    "Input fingerprint": fingerprintSchema,
    Resolution: resolutionSchema.optional(),
    Citations: citationsSchema,
  }),
  planningAuditSchema,
  nextWorkGuidanceSchema,
]);

export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packageVersion: z.string().min(1),
  status: z.enum(["active", "deactivated"]).optional(),
  surfaces: uniqueArray(z.enum(["agent-skills", "claude"])).refine(
    (surfaces) => surfaces.length > 0,
    { message: "Select at least one Agent Surface." },
  ),
  executorProfiles: uniqueArray(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
});

export const repositoryManifestSchema = manifestSchema.extend({
  status: z.enum(["active", "deactivated"]),
});
