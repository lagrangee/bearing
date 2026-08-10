import { expect, test } from "bun:test";
import { bearingSchema } from "../src/schema-definitions";
import {
  bearingOwnedEventTimeSchema,
  projectExpectedNativeSourceEventTime,
  projectExpectedSourceEventTime,
  projectedNativeTimeSchema,
  projectInferredSourceMetadataTime,
  projectOptionalSourceEventTime,
  sourceEventTimeSchema,
  sourceOwnedEventTimeValueSchema,
} from "../src/source-event-time";

const INSTANT = "2026-07-31T08:09:10.123Z";

test("projects expected, unavailable, inapplicable, instant, and date-only source time exactly", () => {
  expect(projectExpectedSourceEventTime(INSTANT)).toEqual({
    availability: "available",
    value: INSTANT,
    precision: "fractional-second",
  });
  expect(projectExpectedSourceEventTime("2026-07-31T08:09:10+08:00")).toEqual({
    availability: "available",
    value: "2026-07-31T08:09:10+08:00",
    precision: "second",
  });
  expect(projectExpectedSourceEventTime("2026-07-31")).toEqual({
    availability: "available",
    value: "2026-07-31",
    precision: "date",
  });
  expect(projectExpectedSourceEventTime(null)).toEqual({ availability: "unavailable" });
  expect(projectExpectedSourceEventTime(undefined)).toEqual({ availability: "unavailable" });
  expect(projectOptionalSourceEventTime(undefined)).toBeUndefined();
  expect(projectOptionalSourceEventTime(null)).toEqual({ availability: "unavailable" });
});

test("keeps Bearing-owned UTC and generic source-owned date precision separate", () => {
  expect(bearingOwnedEventTimeSchema.safeParse(INSTANT).success).toBe(true);
  expect(bearingOwnedEventTimeSchema.safeParse(null).success).toBe(true);
  expect(bearingOwnedEventTimeSchema.safeParse("2026-07-31T08:09:10+08:00").success).toBe(false);
  expect(sourceOwnedEventTimeValueSchema.safeParse("2026-07-31").success).toBe(true);
  expect(sourceOwnedEventTimeValueSchema.safeParse("2026-07-31T08:09:10+08:00").success).toBe(true);
  expect(sourceOwnedEventTimeValueSchema.safeParse("2026-07-31T08:09").success).toBe(false);
  expect(
    sourceEventTimeSchema.safeParse({
      availability: "available",
      value: INSTANT,
      precision: "second",
    }).success,
  ).toBe(false);
});

test("marks projected native exact and inferred times with their provider-neutral basis", () => {
  expect(projectExpectedNativeSourceEventTime(INSTANT)).toEqual({
    availability: "available",
    value: INSTANT,
    precision: "fractional-second",
    basis: "source-event",
  });
  expect(projectExpectedNativeSourceEventTime(null)).toEqual({ availability: "unavailable" });
  expect(projectInferredSourceMetadataTime(INSTANT)).toEqual({
    availability: "available",
    value: INSTANT,
    precision: "fractional-second",
    basis: "inferred-source-metadata",
  });
  expect(
    projectedNativeTimeSchema.safeParse({
      availability: "available",
      value: INSTANT,
      precision: "fractional-second",
    }).success,
  ).toBe(false);
});

test("accepts legacy Roadmap time gaps but rejects inapplicable or non-UTC event fields", () => {
  const base = {
    Type: "roadmap",
    ID: "roadmap:test",
    Title: "Test",
    Status: "active",
    "Focused gate": null,
    "Gate order": [],
  } as const;
  expect(bearingSchema.safeParse(base).success).toBe(true);
  expect(
    bearingSchema.safeParse({
      ...base,
      "Started at": INSTANT,
    }).success,
  ).toBe(true);
  expect(
    bearingSchema.safeParse({
      ...base,
      "Completed at": INSTANT,
    }).success,
  ).toBe(false);
  expect(
    bearingSchema.safeParse({
      ...base,
      "Started at": "2026-07-31T08:09:10+08:00",
    }).success,
  ).toBe(false);
  expect(
    bearingSchema.safeParse({
      ...base,
      Status: "completed",
      "Started at": null,
      "Completed at": null,
    }).success,
  ).toBe(true);
});

test("models Gate planning, activation, Passage acceptance, and supersession as distinct roles", () => {
  const base = {
    Type: "milestone-gate",
    ID: "gate:test",
    Title: "Test",
    Roadmap: "roadmap:test",
    Status: "passed",
    "Effort order": [],
    "Planned at": INSTANT,
    "Activated at": "2026-07-31T09:09:10.123Z",
    Passage: {
      "Accepted decision": "Accept the Gate.",
      "Accepted at": "2026-07-31T10:09:10.123Z",
      Rationale: "The criteria are met.",
      Evidence: [],
      Exceptions: [],
    },
  } as const;
  expect(bearingSchema.safeParse(base).success).toBe(true);
  expect(
    bearingSchema.safeParse({
      ...base,
      Status: "active",
    }).success,
  ).toBe(true);
  expect(
    bearingSchema.safeParse({
      ...base,
      Status: "active",
      Passage: undefined,
      "Superseded at": INSTANT,
    }).success,
  ).toBe(false);
  expect(
    bearingSchema.safeParse({
      ...base,
      Status: "superseded",
      Passage: undefined,
      "Superseded at": null,
    }).success,
  ).toBe(true);
});
