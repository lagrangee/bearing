import { z } from "zod";

const sourceEventDateSchema = z.iso.date();
const sourceEventInstantSchema = z.iso.datetime({ offset: true });

export const bearingOwnedEventTimeSchema = sourceEventInstantSchema
  .refine((value) => value.endsWith("Z"), {
    message: "Bearing-owned Source Event Time must be UTC.",
  })
  .nullable();

export const sourceOwnedEventTimeValueSchema = z.union([
  sourceEventDateSchema,
  sourceEventInstantSchema,
]);

export const sourceEventTimePrecision = (
  value: z.infer<typeof sourceOwnedEventTimeValueSchema>,
): "date" | "second" | "fractional-second" => {
  if (sourceEventDateSchema.safeParse(value).success) return "date";
  return /\.\d+(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ? "fractional-second" : "second";
};

export const sourceEventTimeSchema = z.discriminatedUnion("availability", [
  z
    .strictObject({
      availability: z.literal("available"),
      value: sourceOwnedEventTimeValueSchema,
      precision: z.enum(["date", "second", "fractional-second"]),
    })
    .superRefine((time, context) => {
      if (time.precision === sourceEventTimePrecision(time.value)) return;
      context.addIssue({
        code: "custom",
        path: ["precision"],
        message: "Source Event Time precision must describe the exact source value.",
      });
    }),
  z.strictObject({ availability: z.literal("unavailable") }),
]);

export const bearingSourceEventTimeSchema = sourceEventTimeSchema.superRefine((time, context) => {
  if (
    time.availability === "unavailable" ||
    (time.precision !== "date" && time.value.endsWith("Z"))
  ) {
    return;
  }
  context.addIssue({
    code: "custom",
    path: ["value"],
    message: "Bearing-owned projected Source Event Time must preserve a UTC instant.",
  });
});

export type SourceEventTime = z.infer<typeof sourceEventTimeSchema>;
type SourceEventTimeValue = z.infer<typeof sourceOwnedEventTimeValueSchema>;

const availableSourceEventTime = (value: SourceEventTimeValue): SourceEventTime => ({
  availability: "available",
  value,
  precision: sourceEventTimePrecision(value),
});

export const projectExpectedSourceEventTime = (
  value: SourceEventTimeValue | null | undefined,
): SourceEventTime =>
  value === null || value === undefined
    ? { availability: "unavailable" }
    : availableSourceEventTime(value);

export const projectOptionalSourceEventTime = (
  value: SourceEventTimeValue | null | undefined,
): SourceEventTime | undefined =>
  value === undefined
    ? undefined
    : value === null
      ? { availability: "unavailable" }
      : availableSourceEventTime(value);
