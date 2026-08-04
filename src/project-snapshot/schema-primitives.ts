import { z } from "zod";
import { markdownPlainText } from "../markdown-document";
import { displaySourceLocatorSchema, nonBlankStringSchema } from "../reference-schema";

const brandedStringSchema = <Brand extends string>(pattern: RegExp, brand: Brand) =>
  z.string().regex(pattern).brand(brand);
const stableIdSchema = <Brand extends string>(prefix: string, brand: Brand) =>
  brandedStringSchema(new RegExp(`^${prefix}:[a-z0-9]+(?:-[a-z0-9]+)*$`, "u"), brand);

export const fingerprintSchema = brandedStringSchema(/^sha256:[0-9a-f]{64}$/u, "Fingerprint");
export const roadmapIdSchema = stableIdSchema("roadmap", "RoadmapId");
export const gateIdSchema = stableIdSchema("gate", "GateId");
export const effortIdSchema = stableIdSchema("effort", "EffortId");
export const authorityIdSchema = stableIdSchema("authority", "AuthorityId");
export const assetIdSchema = stableIdSchema("asset", "AssetId");
export const checkIdSchema = stableIdSchema("alignment-check", "AlignmentCheckId");
export const reviewIdSchema = stableIdSchema("planning-review", "PlanningReviewId");
export const trackerReferenceSchema = displaySourceLocatorSchema.brand("TrackerReference");
export const diagnosticReferenceSchema = brandedStringSchema(
  /^diagnostic:[0-9a-f]{64}$/u,
  "DiagnosticRef",
);
export const auditFindingIdSchema = brandedStringSchema(
  /^audit-finding:[0-9a-f]{64}$/u,
  "AuditFindingId",
);
export const nonEmptyStringSchema = nonBlankStringSchema;
export const semanticPlainTextSchema = nonEmptyStringSchema.refine(
  (value) => markdownPlainText(value) !== undefined,
);
export { planningReferenceSchema } from "../reference-schema";
export const semanticFreshnessSchema = z.enum(["current", "stale", "unknown"]);
