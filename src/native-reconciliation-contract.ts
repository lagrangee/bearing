import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import type { NativeWorkAffectedSet } from "./native-work-provider";
import type { MattSkillsV1WorkBinding } from "./providers/matt-skills-v1/capture";

const MAXIMUM_AFFECTED_SUBJECTS = 256;
const MAXIMUM_REFERENCE_BYTES = 4096;

export const nativeReferenceSchema = z
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

export const nativeReconciliationRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    binding: z.strictObject({
      provider: z.literal("matt-skills/v1"),
      nativeScope: nativeReferenceSchema,
    }),
    subjects: z.array(nativeReferenceSchema).min(1).max(MAXIMUM_AFFECTED_SUBJECTS),
  })
  .readonly();

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

export const normalizeNativeReconciliationRequest = (
  input: Readonly<{
    binding: MattSkillsV1WorkBinding;
    subjects?: readonly string[];
  }>,
): NativeReconciliationRequest =>
  nativeReconciliationRequestSchema.parse({
    schemaVersion: 2,
    binding: input.binding,
    subjects: [...new Set(input.subjects ?? [])].sort(utf8Compare),
  });

export const affectedSetFor = (request: NativeReconciliationRequest): NativeWorkAffectedSet => ({
  subjects: request.subjects,
});

export const nativeReconciliationRequestFingerprint = (
  request: NativeReconciliationRequest,
): string => {
  const normalized = normalizeNativeReconciliationRequest(request);
  const payload = `bearing-native-reconciliation-request-v2\n${JSON.stringify(normalized)}`;
  return `sha256:${bytesToHex(sha256(utf8ToBytes(payload)))}`;
};

export const affectedReadReferences = (affected: NativeWorkAffectedSet): readonly string[] =>
  [...new Set(affected.subjects)].sort(utf8Compare);
