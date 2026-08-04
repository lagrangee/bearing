import { expect, test } from "bun:test";
import { portalCatalogEnvelopeSchema } from "../src/portal-catalog-wire";

const validEntry = {
  entryId: "entry-Bearing_1",
  displayName: "Bearing",
  repoRoot: "/Users/example/Bearing",
  availability: "available",
} as const;

const validSession = { csrfToken: "csrf-token" } as const;

test("accepts a ready Catalog v1 envelope", () => {
  expect(
    portalCatalogEnvelopeSchema.parse({
      version: 1,
      state: "ready",
      entries: [validEntry],
      session: validSession,
    }),
  ).toEqual({
    version: 1,
    state: "ready",
    entries: [
      {
        entryId: "entry-Bearing_1",
        displayName: "Bearing",
        repoRoot: "/Users/example/Bearing",
        availability: "available",
      },
    ],
    session: { csrfToken: "csrf-token" },
  });
});

test("accepts a degraded Catalog v1 envelope with trustworthy entries", () => {
  expect(
    portalCatalogEnvelopeSchema.safeParse({
      version: 1,
      state: "degraded",
      entries: [
        {
          entryId: "entry-backup",
          displayName: "Backup",
          repoRoot: "/Users/example/Backup",
          availability: "manifest-missing",
          detail: "Bearing manifest is missing.",
        },
      ],
      diagnostic: {
        code: "catalog-current-invalid",
        message: "Only previously trusted entries are shown.",
      },
      session: { csrfToken: "csrf-token" },
    }).success,
  ).toBe(true);
});

test("accepts a failed Catalog v1 envelope only with no entries", () => {
  expect(
    portalCatalogEnvelopeSchema.safeParse({
      version: 1,
      state: "failed",
      entries: [],
      diagnostic: {
        code: "catalog-unusable",
        message: "No trustworthy Project Catalog is available.",
      },
      session: { csrfToken: "csrf-token" },
    }).success,
  ).toBe(true);
});

test("rejects values outside the strict Catalog v1 contract", () => {
  const invalidEnvelopes: readonly unknown[] = [
    { version: 2, state: "ready", entries: [validEntry], session: validSession },
    { version: 1, state: "unknown", entries: [validEntry], session: validSession },
    {
      version: 1,
      state: "ready",
      entries: [validEntry],
      session: validSession,
      extra: true,
    },
    {
      version: 1,
      state: "ready",
      entries: [{ ...validEntry, entryId: "invalid entry" }],
      session: validSession,
    },
    {
      version: 1,
      state: "ready",
      entries: [{ ...validEntry, availability: "unknown" }],
      session: validSession,
    },
    {
      version: 1,
      state: "ready",
      entries: [{ ...validEntry, displayName: "" }],
      session: validSession,
    },
    {
      version: 1,
      state: "ready",
      entries: [
        {
          entryId: validEntry.entryId,
          repoRoot: validEntry.repoRoot,
          availability: validEntry.availability,
        },
      ],
      session: validSession,
    },
    {
      version: 1,
      state: "ready",
      entries: [{ ...validEntry, repoRoot: "" }],
      session: validSession,
    },
    {
      version: 1,
      state: "ready",
      entries: [{ ...validEntry, detail: "" }],
      session: validSession,
    },
    { version: 1, state: "ready", entries: [validEntry], session: { csrfToken: "" } },
    { version: 1, state: "ready", entries: [validEntry], session: {} },
    {
      version: 1,
      state: "ready",
      entries: [validEntry],
      diagnostic: { code: "unexpected", message: "Ready cannot be diagnostic." },
      session: validSession,
    },
    {
      version: 1,
      state: "degraded",
      entries: [validEntry],
      diagnostic: { code: "catalog-current-invalid" },
      session: validSession,
    },
    { version: 1, state: "degraded", entries: [validEntry], session: validSession },
    {
      version: 1,
      state: "degraded",
      entries: [validEntry],
      diagnostic: { code: "", message: "Diagnostic codes are required." },
      session: validSession,
    },
    {
      version: 1,
      state: "failed",
      entries: [validEntry],
      diagnostic: { code: "catalog-unusable", message: "No trustworthy Catalog." },
      session: validSession,
    },
  ];

  for (const envelope of invalidEnvelopes) {
    expect(portalCatalogEnvelopeSchema.safeParse(envelope).success).toBe(false);
  }
});
