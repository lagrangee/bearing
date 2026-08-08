import { z } from "zod";
import { assetSourceLocatorSchema } from "../reference-schema";
import { bearingSourceEventTimeSchema } from "../source-event-time";
import { uniqueIdentityArraySchema } from "./projection-identity";
import { titledSourceShape } from "./schema-node";
import {
  assetIdSchema,
  authorityIdSchema,
  effortIdSchema,
  planningReferenceSchema,
  roadmapIdSchema,
  semanticPlainTextSchema,
} from "./schema-primitives";
import { sourceReferenceSchema } from "./source-schema";

const reverseCitationSchema = z.strictObject({
  assetId: assetIdSchema,
  note: semanticPlainTextSchema,
  citingReference: planningReferenceSchema,
  source: sourceReferenceSchema,
});

const reverseAuthorityBaselineSchema = z.strictObject({
  authorityId: authorityIdSchema,
  source: sourceReferenceSchema,
});

export const assetProjectionSchema = z
  .strictObject({
    id: assetIdSchema,
    ...titledSourceShape,
    purpose: semanticPlainTextSchema,
    kind: z.enum([
      "specification",
      "prototype",
      "design",
      "research",
      "baseline",
      "reference",
      "runbook",
    ]),
    sourceLocator: assetSourceLocatorSchema,
    owner: z.union([
      z.literal("project-summary:current"),
      roadmapIdSchema,
      effortIdSchema,
      authorityIdSchema,
    ]),
    addedAt: bearingSourceEventTimeSchema,
    disposition: z.enum(["active", "superseded", "archived"]),
    supersededBy: assetIdSchema.optional(),
    supersededAt: bearingSourceEventTimeSchema.optional(),
    archivedAt: bearingSourceEventTimeSchema.optional(),
    origin: semanticPlainTextSchema.optional(),
    citations: uniqueIdentityArraySchema(
      reverseCitationSchema,
      (citation) => `${citation.citingReference}\0${citation.note}\0${citation.source}`,
    ),
    authorityBaselines: uniqueIdentityArraySchema(
      reverseAuthorityBaselineSchema,
      (baseline) => baseline.authorityId,
    ),
  })
  .superRefine((asset, context) => {
    if (asset.disposition === "superseded") {
      if (asset.supersededBy === undefined || asset.supersededAt === undefined) {
        context.addIssue({
          code: "custom",
          path: ["supersededBy"],
          message: "A superseded Asset requires its active replacement and event time.",
        });
      }
      if (asset.archivedAt !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["archivedAt"],
          message: "A superseded Asset cannot have an archive event.",
        });
      }
    } else if (asset.disposition === "archived") {
      if (
        asset.archivedAt === undefined ||
        asset.supersededBy !== undefined ||
        asset.supersededAt !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["archivedAt"],
          message: "An archived Asset requires only its archive event.",
        });
      }
    } else if (
      asset.supersededBy !== undefined ||
      asset.supersededAt !== undefined ||
      asset.archivedAt !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["disposition"],
        message: "An active Asset cannot carry terminal lifecycle fields.",
      });
    }
    if (asset.supersededBy === asset.id) {
      context.addIssue({
        code: "custom",
        path: ["supersededBy"],
        message: "An Asset cannot supersede itself.",
      });
    }
  });
