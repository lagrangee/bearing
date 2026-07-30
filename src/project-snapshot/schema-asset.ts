import { z } from "zod";
import { bearingSourceEventTimeSchema, sourceEventTimeSchema } from "../source-event-time";
import { uniqueIdentityArraySchema } from "./projection-identity";
import { titledSourceShape } from "./schema-node";
import {
  assetIdSchema,
  authorityIdSchema,
  checkIdSchema,
  effortIdSchema,
  gateIdSchema,
  nonEmptyStringSchema,
  planningReferenceSchema,
  reviewIdSchema,
  roadmapIdSchema,
  semanticPlainTextSchema,
} from "./schema-primitives";
import { displayAssetLocatorSchema, sourceReferenceSchema } from "./source-schema";

const producerSchema = z.strictObject({
  kind: semanticPlainTextSchema,
  name: semanticPlainTextSchema,
  reference: nonEmptyStringSchema.optional(),
});

const citingReferenceSchema = z.union([
  roadmapIdSchema,
  gateIdSchema,
  effortIdSchema,
  authorityIdSchema,
  checkIdSchema,
  reviewIdSchema,
]);

const reverseCitationSchema = z.strictObject({
  assetId: assetIdSchema,
  note: semanticPlainTextSchema,
  citingReference: citingReferenceSchema,
  source: sourceReferenceSchema,
});

export const assetProjectionSchema = z
  .strictObject({
    id: assetIdSchema,
    ...titledSourceShape,
    citations: z.array(reverseCitationSchema),
    kind: semanticPlainTextSchema,
    owner: planningReferenceSchema,
    producer: producerSchema,
    lifecycleSource: z.enum(["native", "registry"]),
    registeredAt: bearingSourceEventTimeSchema,
    producedAt: sourceEventTimeSchema.optional(),
    disposition: z.enum(["available", "superseded", "archived"]).optional(),
    supersededBy: assetIdSchema.optional(),
    supersededAt: bearingSourceEventTimeSchema.optional(),
    archivedAt: bearingSourceEventTimeSchema.optional(),
    producedFor: planningReferenceSchema.optional(),
    displayLocation: displayAssetLocatorSchema,
    contentAvailability: z.enum(["available", "missing", "unreadable"]),
    adoptedByAuthorityIds: uniqueIdentityArraySchema(
      authorityIdSchema,
      (authorityId) => authorityId,
    ),
    gatePassageEvidenceFor: uniqueIdentityArraySchema(gateIdSchema, (gateId) => gateId),
    citationCount: z.number().int().nonnegative(),
  })
  .superRefine((asset, context) => {
    if (asset.kind === "execution-evidence" && asset.producedFor === undefined) {
      context.addIssue({
        code: "custom",
        path: ["producedFor"],
        message: "Execution Evidence requires Produced for.",
      });
    }
    if (asset.kind === "execution-evidence" && asset.producer.kind !== "executor-profile") {
      context.addIssue({
        code: "custom",
        path: ["producer", "kind"],
        message: "Execution Evidence requires executor-profile Producer provenance.",
      });
    }
    if (asset.lifecycleSource === "registry" && asset.disposition === undefined) {
      context.addIssue({
        code: "custom",
        path: ["disposition"],
        message: "Registry-managed Asset requires Disposition.",
      });
    }
    if (asset.lifecycleSource === "native" && asset.disposition !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["disposition"],
        message: "Native Asset lifecycle cannot be overridden by registry Disposition.",
      });
    }
    if (asset.disposition === "superseded" && asset.supersededBy === undefined) {
      context.addIssue({
        code: "custom",
        path: ["supersededBy"],
        message: "Superseded Asset requires its replacement.",
      });
    }
    if (asset.disposition !== "superseded" && asset.supersededBy !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["supersededBy"],
        message: "Only a superseded Asset can name a replacement.",
      });
    }
    if (asset.supersededBy === asset.id) {
      context.addIssue({
        code: "custom",
        path: ["supersededBy"],
        message: "An Asset cannot supersede itself.",
      });
    }
    if (
      (asset.lifecycleSource === "registry" && asset.disposition === "superseded") !==
      (asset.supersededAt !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["supersededAt"],
        message: "Asset supersession time applicability must match registry disposition.",
      });
    }
    if (
      (asset.lifecycleSource === "registry" && asset.disposition === "archived") !==
      (asset.archivedAt !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["archivedAt"],
        message: "Asset archive time applicability must match registry disposition.",
      });
    }
  });
