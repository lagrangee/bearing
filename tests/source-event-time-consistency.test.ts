import { expect, test } from "bun:test";
import { z } from "zod";
import {
  type EventTimeConsistencySnapshot,
  validateEventTimeConsistency,
} from "../src/project-snapshot/schema-event-time-consistency";

const validate = (snapshot: EventTimeConsistencySnapshot) =>
  z
    .unknown()
    .superRefine((_value, context) => {
      validateEventTimeConsistency(snapshot, context);
    })
    .safeParse(null);

const snapshot = (
  reviews: EventTimeConsistencySnapshot["reviews"],
): EventTimeConsistencySnapshot => ({
  authorities: {
    validity: "available",
    items: [
      {
        baselineAssetIds: ["asset:test"],
        adoptions: [
          {
            assetId: "asset:test",
            decisionReference: "planning-review:test",
          },
        ],
      },
    ],
  },
  checks: { validity: "available", items: [] },
  reviews,
});

test("accepts only an adoption whose referenced decision owns an accepted time role", () => {
  expect(
    validate(
      snapshot({
        validity: "available",
        items: [
          {
            id: "planning-review:test",
            resolution: { acceptedAt: { availability: "unavailable" } },
          },
        ],
      }),
    ).success,
  ).toBe(true);
  const unresolved = validate(
    snapshot({
      validity: "available",
      items: [{ id: "planning-review:test" }],
    }),
  );
  expect(unresolved.success).toBe(false);
  expect(unresolved.success ? [] : unresolved.error.issues.map((issue) => issue.message)).toContain(
    "Authority Adoption must cite an Accepted Decision that owns its Source Event Time.",
  );
});

test("distinguishes complete missing decisions from partial unknown coverage", () => {
  expect(validate(snapshot({ validity: "available", items: [] })).success).toBe(false);
  expect(validate(snapshot({ validity: "partial", items: [] })).success).toBe(true);
});
