import { expect, test } from "bun:test";
import { catalogAvailabilitySchema } from "../src/catalog/availability";
import { catalogEntryIdSchema } from "../src/catalog/entry-id";

test("accepts only the five Catalog Availability values", () => {
  expect(catalogAvailabilitySchema.options).toEqual([
    "available",
    "missing",
    "unreadable",
    "manifest-missing",
    "invalid-manifest",
  ]);
  expect(catalogAvailabilitySchema.safeParse("unknown").success).toBe(false);
});

test("accepts only the Catalog Entry identity grammar", () => {
  expect(catalogEntryIdSchema.safeParse("a").success).toBe(true);
  expect(catalogEntryIdSchema.safeParse("A_1-entry").success).toBe(true);
  expect(catalogEntryIdSchema.safeParse("a".repeat(128)).success).toBe(true);
  expect(catalogEntryIdSchema.safeParse("").success).toBe(false);
  expect(catalogEntryIdSchema.safeParse("a".repeat(129)).success).toBe(false);
  expect(catalogEntryIdSchema.safeParse("entry id").success).toBe(false);
  expect(catalogEntryIdSchema.safeParse("entrée").success).toBe(false);
});
