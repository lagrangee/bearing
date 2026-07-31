import { z } from "zod";
import type { NativeWorkAffectedRelation, NativeWorkAffectedSet } from "./native-work-provider";
import type { MattSkillsV1WorkBinding } from "./providers/matt-skills-v1/capture";
import { sha256Hex } from "./sha256";

const MAXIMUM_AFFECTED_SUBJECTS = 256;
const MAXIMUM_AFFECTED_RELATIONS = 512;
const MAXIMUM_REFERENCE_BYTES = 4096;

const nativeReferenceSchema = z
  .string()
  .min(1)
  .max(MAXIMUM_REFERENCE_BYTES)
  .refine(
    (value) => /^[^\uD800-\uDFFF]*$/u.test(value),
    "Native references must contain well-formed Unicode.",
  )
  .refine(
    (value) => new TextEncoder().encode(value).length <= MAXIMUM_REFERENCE_BYTES,
    `Native references cannot exceed ${MAXIMUM_REFERENCE_BYTES} UTF-8 bytes.`,
  )
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
      }),
    "Native references cannot contain control characters.",
  );

export const nativeWorkAffectedRelationSchema = z.strictObject({
  kind: z.enum(["parent-child", "blocked-by"]),
  source: nativeReferenceSchema,
  target: nativeReferenceSchema,
});

export const nativeReconciliationRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    binding: z.strictObject({
      provider: z.literal("matt-skills/v1"),
      nativeScope: nativeReferenceSchema,
    }),
    subjects: z.array(nativeReferenceSchema).max(MAXIMUM_AFFECTED_SUBJECTS),
    relations: z.array(nativeWorkAffectedRelationSchema).max(MAXIMUM_AFFECTED_RELATIONS),
  })
  .superRefine((request, context) => {
    if (request.subjects.length === 0 && request.relations.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["subjects"],
        message: "Targeted reconciliation requires at least one affected subject or relation.",
      });
    }
  });

export type NativeReconciliationRequest = Readonly<
  z.infer<typeof nativeReconciliationRequestSchema>
>;

export type NativeReconciliationIntent =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "reconcile";
      request: NativeReconciliationRequest;
    }>;

const utf8Compare = (left: string, right: string): number => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
};

const relationKey = (relation: NativeWorkAffectedRelation): string =>
  `${relation.kind}\0${relation.source}\0${relation.target}`;

export const normalizeNativeReconciliationRequest = (
  input: Readonly<{
    binding: MattSkillsV1WorkBinding;
    subjects?: readonly string[];
    relations?: readonly NativeWorkAffectedRelation[];
  }>,
): NativeReconciliationRequest =>
  nativeReconciliationRequestSchema.parse({
    schemaVersion: 1,
    binding: input.binding,
    subjects: [...new Set(input.subjects ?? [])].sort(utf8Compare),
    relations: [
      ...new Map(
        (input.relations ?? []).map((relation) => [relationKey(relation), relation]),
      ).values(),
    ].sort((left, right) => utf8Compare(relationKey(left), relationKey(right))),
  });

export const affectedSetFor = (request: NativeReconciliationRequest): NativeWorkAffectedSet => ({
  subjects: request.subjects,
  relations: request.relations,
});

export const nativeReconciliationRequestFingerprint = (
  request: NativeReconciliationRequest,
): string => {
  const normalized = normalizeNativeReconciliationRequest(request);
  return `sha256:${sha256Hex(
    `bearing-native-reconciliation-request-v1\n${JSON.stringify(normalized)}`,
  )}`;
};

export const affectedReadReferences = (affected: NativeWorkAffectedSet): readonly string[] =>
  [
    ...new Set([
      ...affected.subjects,
      ...affected.relations.flatMap((relation) => [relation.source, relation.target]),
    ]),
  ].sort(utf8Compare);
