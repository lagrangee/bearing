import { describe, expect, test } from "bun:test";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { assetProjectionSchema } from "../src/project-snapshot/schema-asset";
import { assetSchema, bearingSchema } from "../src/schema-definitions";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { withRebuiltPlanningLineage } from "./planning-lineage-fixture";

const activeAsset = {
  ID: "asset:architecture-contract",
  Title: "Architecture Contract",
  Purpose: "Keeps the accepted architecture available for future planning decisions.",
  Kind: "specification",
  Source: ".scratch/architecture/PRD.md",
  Owner: "project-summary:current",
  "Added at": "2026-08-08T12:00:00Z",
  Disposition: "active",
} as const;

describe("KISS Asset canonical contract", () => {
  test("accepts the minimal closed Asset schema and safe local or HTTPS sources", () => {
    expect(assetSchema.parse(activeAsset)).toEqual(activeAsset);
    expect(
      assetSchema.parse({
        ...activeAsset,
        ID: "asset:external-reference",
        Kind: "reference",
        Source: "https://example.com/reference?v=1",
        Owner: "authority:architecture",
        Origin: "External standards body",
      }),
    ).toMatchObject({ Source: "https://example.com/reference?v=1" });
  });

  test("rejects legacy inventory fields, open kinds, unsafe sources, and ineligible owners", () => {
    for (const candidate of [
      { ...activeAsset, Kind: "verification-report" },
      { ...activeAsset, Source: "http://example.com/reference" },
      { ...activeAsset, Source: "file:///tmp/reference.md" },
      { ...activeAsset, Source: "../outside.md" },
      { ...activeAsset, Owner: "gate:release" },
      { ...activeAsset, Location: activeAsset.Source },
      { ...activeAsset, Producer: { Kind: "executor-profile", Name: "implement" } },
      { ...activeAsset, "Produced for": ".scratch/issues/01.md" },
    ]) {
      expect(assetSchema.safeParse(candidate).success).toBe(false);
    }
    const normalizedAsset = {
      id: "asset:architecture-contract",
      title: "Architecture Contract",
      source: `source:${"0".repeat(64)}`,
      purpose: "Keeps the accepted architecture available for future planning decisions.",
      kind: "specification",
      sourceLocator: ".scratch/architecture/PRD.md",
      owner: "project-summary:current",
      addedAt: {
        availability: "available",
        value: "2026-08-08T12:00:00Z",
        precision: "second",
      },
      disposition: "active",
      citations: [],
      authorityBaselines: [],
    } as const;
    expect(assetProjectionSchema.safeParse(normalizedAsset).success).toBe(true);
    expect(
      assetProjectionSchema.safeParse({ ...normalizedAsset, owner: "gate:release" }).success,
    ).toBe(false);
  });

  test("requires an active replacement for supersession and no invented archive replacement", () => {
    expect(
      assetSchema.safeParse({
        ...activeAsset,
        Disposition: "superseded",
        "Superseded by": "asset:replacement",
        "Superseded at": "2026-08-08T13:00:00Z",
      }).success,
    ).toBe(true);
    expect(assetSchema.safeParse({ ...activeAsset, Disposition: "superseded" }).success).toBe(
      false,
    );
    expect(
      assetSchema.safeParse({
        ...activeAsset,
        Disposition: "archived",
        "Archived at": "2026-08-08T13:00:00Z",
        "Superseded by": "asset:replacement",
      }).success,
    ).toBe(false);
  });

  test("requires active Assets to leave a concluded Effort owner", () => {
    const snapshot = createProjectOverviewFixture();
    if (snapshot.assets.validity !== "available") throw new Error("Expected Asset fixture.");
    const candidate = withRebuiltPlanningLineage({
      ...snapshot,
      assets: {
        validity: "available" as const,
        items: snapshot.assets.items.map((asset) => ({ ...asset, owner: "effort:model" as const })),
      },
    });
    const result = projectSnapshotSchema.safeParse(candidate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        "A concluded Effort cannot own an active Asset; transfer, supersede, or archive it.",
      );
    }
  });
});

describe("Gate-owned Passage evidence", () => {
  test("accepts concise durable locators with relevance notes and rejects Asset reverse proof", () => {
    const gate = {
      Type: "milestone-gate",
      ID: "gate:release",
      Title: "Release",
      Roadmap: "roadmap:product",
      Status: "passed",
      "Effort order": [],
      Passage: {
        "Accepted decision": "Pass the Gate.",
        "Accepted at": "2026-08-08T13:00:00Z",
        Rationale: "The user accepted the evidence and exceptions.",
        Evidence: [
          {
            Locator: ".scratch/release/evidence/final-review.md",
            Relevance: "Records the fixed candidate review used for this Passage decision.",
          },
        ],
        Exceptions: [],
      },
    } as const;
    expect(bearingSchema.safeParse(gate).success).toBe(true);
    expect(
      bearingSchema.safeParse({
        ...gate,
        Passage: { ...gate.Passage, Evidence: ["asset:release-proof"] },
      }).success,
    ).toBe(false);
  });
});
