import { z } from "zod";
import { catalogEntryIdSchema } from "./catalog/entry-id";
import {
  assetIdSchema,
  authorityIdSchema,
  checkIdSchema,
  effortIdSchema,
  gateIdSchema,
  reviewIdSchema,
  roadmapIdSchema,
} from "./project-snapshot/schema-primitives";

export const planningLineageSubjectKindSchema = z.enum([
  "roadmap",
  "gate",
  "effort",
  "authority",
  "alignment-check",
  "planning-review",
  "asset",
  "native-scope",
  "native-subject",
]);
export type PlanningLineageSubjectKind = z.infer<typeof planningLineageSubjectKindSchema>;

const unbrandedId = <Schema extends z.ZodType>(schema: Schema) =>
  schema.transform((value) => String(value));
export const nativeSubjectIdSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) =>
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
    }),
  );

export const nativeScopeInspectionSubjectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("native-scope"), id: nativeSubjectIdSchema }),
  z.strictObject({ kind: z.literal("native-subject"), id: nativeSubjectIdSchema }),
]);

export const planningLineageSubjectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("roadmap"), id: unbrandedId(roadmapIdSchema) }),
  z.strictObject({ kind: z.literal("gate"), id: unbrandedId(gateIdSchema) }),
  z.strictObject({ kind: z.literal("effort"), id: unbrandedId(effortIdSchema) }),
  z.strictObject({ kind: z.literal("authority"), id: unbrandedId(authorityIdSchema) }),
  z.strictObject({ kind: z.literal("alignment-check"), id: unbrandedId(checkIdSchema) }),
  z.strictObject({ kind: z.literal("planning-review"), id: unbrandedId(reviewIdSchema) }),
  z.strictObject({ kind: z.literal("asset"), id: unbrandedId(assetIdSchema) }),
  ...nativeScopeInspectionSubjectSchema.options,
]);
export type PlanningLineageSubject = z.infer<typeof planningLineageSubjectSchema>;

export const planningLineageRelationKeySchema = z.enum([
  "outcome.roadmap",
  "outcome.ordered-gates",
  "outcome.contributing-efforts",
  "outcome.target-gate",
  "governance.authorities",
  "governance.target",
  "governance.changed-references",
  "native-work.binding",
  "native-work.scope",
  "native-work.members",
  "native-work.parent",
  "native-work.children",
  "native-work.blocked-by",
  "native-work.blocks",
  "production.owned-assets",
  "production.owner",
  "production.producer",
  "production.produced-for",
  "planning-use.citations",
  "planning-use.cited-by",
  "adoption.current-baseline",
  "adoption.used-by",
  "passage.evidence",
  "passage.used-by",
  "asset.replacement",
]);
export type PlanningLineageRelationKey = z.infer<typeof planningLineageRelationKeySchema>;
const relationPathTokenByKey = new Map<PlanningLineageRelationKey, string>(
  planningLineageRelationKeySchema.options.map((key) => [key, key.replaceAll(".", "_")]),
);
const relationKeyByPathToken = new Map<string, PlanningLineageRelationKey>(
  [...relationPathTokenByKey].map(([key, token]) => [token, key]),
);

export const planningLineageRelationFilterSchema = z.enum(["all", "available", "unavailable"]);
export type PlanningLineageRelationFilter = z.infer<typeof planningLineageRelationFilterSchema>;

const semanticAnchorSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u);

const idSchemaFor = (kind: PlanningLineageSubjectKind) => {
  switch (kind) {
    case "roadmap":
      return roadmapIdSchema;
    case "gate":
      return gateIdSchema;
    case "effort":
      return effortIdSchema;
    case "authority":
      return authorityIdSchema;
    case "alignment-check":
      return checkIdSchema;
    case "planning-review":
      return reviewIdSchema;
    case "asset":
      return assetIdSchema;
    case "native-scope":
    case "native-subject":
      return nativeSubjectIdSchema;
  }
};

export type RequestedPlanningLineageSubject =
  | Readonly<{ validity: "valid"; value: PlanningLineageSubject }>
  | Readonly<{
      validity: "invalid";
      kind: PlanningLineageSubjectKind;
      requestedId: string;
    }>;

export type RequestedPlanningLineageFilteredView =
  | Readonly<{
      validity: "valid";
      relation: PlanningLineageRelationKey;
      filter: PlanningLineageRelationFilter;
      order: "canonical";
    }>
  | Readonly<{ validity: "invalid"; reason: string }>;

export const parsePlanningLineageSubject = (
  kindInput: string,
  id: string,
): RequestedPlanningLineageSubject | undefined => {
  const kind = planningLineageSubjectKindSchema.safeParse(kindInput);
  if (!kind.success) return undefined;
  const parsedId = idSchemaFor(kind.data).safeParse(id);
  return parsedId.success
    ? {
        validity: "valid",
        value: { kind: kind.data, id: parsedId.data } as PlanningLineageSubject,
      }
    : { validity: "invalid", kind: kind.data, requestedId: id };
};

export const parsePlanningLineageFilteredView = (
  relationInput: string,
  search: string,
): RequestedPlanningLineageFilteredView => {
  const relation = planningLineageRelationKeySchema.safeParse(relationInput);
  const params = new URLSearchParams(search);
  const filters = params.getAll("filter");
  const orders = params.getAll("order");
  const filter = planningLineageRelationFilterSchema.safeParse(filters[0]);
  const order = orders[0];
  const unexpected = [...params.keys()].filter((key) => key !== "filter" && key !== "order");
  if (
    !relation.success ||
    filters.length !== 1 ||
    orders.length !== 1 ||
    !filter.success ||
    order !== "canonical" ||
    unexpected.length > 0
  ) {
    return { validity: "invalid", reason: "Filtered view parameters are invalid." };
  }
  return {
    validity: "valid",
    relation: relation.data,
    filter: filter.data,
    order: "canonical",
  };
};

export const parsePlanningLineageRelationPathToken = (
  input: string,
): PlanningLineageRelationKey | undefined => relationKeyByPathToken.get(input);

export const parsePlanningLineageSemanticAnchor = (hash: string): string | undefined => {
  if (hash === "") return undefined;
  let value: string;
  try {
    value = decodeURIComponent(hash.startsWith("#") ? hash.slice(1) : hash);
  } catch {
    return undefined;
  }
  const parsed = semanticAnchorSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const validatedSubject = (subject: PlanningLineageSubject): PlanningLineageSubject => {
  const parsed = parsePlanningLineageSubject(subject.kind, subject.id);
  if (parsed?.validity !== "valid")
    throw new Error("Planning Lineage subject identity is invalid.");
  return parsed.value;
};

const baseHref = (entryId: string, subject: PlanningLineageSubject): string => {
  const entry = catalogEntryIdSchema.parse(entryId);
  const valid = validatedSubject(subject);
  return `/projects/${encodeURIComponent(entry)}/lineage/${valid.kind}/${encodeURIComponent(
    valid.id,
  )}`;
};

export const planningLineageSubjectHref = (
  entryId: string,
  subject: PlanningLineageSubject,
  semanticAnchor?: string,
): string => {
  const href = baseHref(entryId, subject);
  if (semanticAnchor === undefined) return href;
  return `${href}#${semanticAnchorSchema.parse(semanticAnchor)}`;
};

export const planningLineageFilteredViewHref = (
  entryId: string,
  subject: PlanningLineageSubject,
  relation: PlanningLineageRelationKey,
  filter: PlanningLineageRelationFilter = "all",
): string => {
  const relationKey = planningLineageRelationKeySchema.parse(relation);
  const relationFilter = planningLineageRelationFilterSchema.parse(filter);
  const relationToken = relationPathTokenByKey.get(relationKey);
  if (relationToken === undefined)
    throw new Error("Planning Lineage relation token is unavailable.");
  return `${baseHref(entryId, subject)}/relations/${relationToken}?filter=${relationFilter}&order=canonical`;
};

export const planningLineageSubjectForReference = (
  reference: string,
): PlanningLineageSubject | undefined => {
  const separator = reference.indexOf(":");
  if (separator <= 0) return undefined;
  const prefix = reference.slice(0, separator);
  const kind =
    prefix === "roadmap" ||
    prefix === "gate" ||
    prefix === "effort" ||
    prefix === "authority" ||
    prefix === "alignment-check" ||
    prefix === "planning-review" ||
    prefix === "asset"
      ? prefix
      : undefined;
  if (kind === undefined) return undefined;
  const parsed = parsePlanningLineageSubject(kind, reference);
  return parsed?.validity === "valid" ? parsed.value : undefined;
};
