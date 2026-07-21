import { expect, test } from "bun:test";
import { assetSchema, bearingSchema } from "../src/schema-definitions";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;

test("canonical source schemas reject formatting in Overview-facing titles and citation notes", () => {
  // Given: otherwise-valid canonical records with formatted semantic text.
  const summary = {
    Type: "project-summary",
    ID: "project-summary:current",
    Title: "**Formatted Summary**",
  };
  const roadmap = {
    Type: "roadmap",
    ID: "roadmap:test",
    Title: "[Formatted Roadmap](https://example.test)",
    Status: "active",
    "Focused gate": "gate:test",
    "Gate order": ["gate:test"],
  };
  const gate = {
    Type: "milestone-gate",
    ID: "gate:test",
    Title: "`Formatted Gate`",
    Roadmap: "roadmap:test",
    Status: "active",
  };
  const citedRoadmap = {
    ...roadmap,
    Title: "Plain Roadmap",
    Citations: [{ Asset: "asset:test", Note: "Use **formatted** evidence." }],
  };
  const effort = {
    Type: "effort",
    ID: "effort:test",
    Title: "`Formatted Effort`",
    Roadmap: "roadmap:test",
    "Target gate": "gate:test",
    Authorities: [],
    Citations: [],
  };
  const authority = {
    Type: "authority",
    ID: "authority:test",
    Title: "<strong>Formatted Authority</strong>",
    Baseline: [],
  };

  // When / Then: source parsing fails before formatted text reaches the normalized model.
  expect(bearingSchema.safeParse(summary).success).toBe(false);
  expect(bearingSchema.safeParse({ ...summary, Title: "   " }).success).toBe(false);
  expect(bearingSchema.safeParse({ ...summary, Title: "<div\nclass=note>" }).success).toBe(false);
  expect(bearingSchema.safeParse({ ...summary, Title: "**Split\nSummary**" }).success).toBe(false);
  expect(bearingSchema.safeParse({ ...summary, Title: "[Split\nSummary](source)" }).success).toBe(
    false,
  );
  expect(bearingSchema.safeParse(roadmap).success).toBe(false);
  expect(bearingSchema.safeParse(gate).success).toBe(false);
  expect(bearingSchema.safeParse(citedRoadmap).success).toBe(false);
  expect(bearingSchema.safeParse(effort).success).toBe(false);
  expect(bearingSchema.safeParse(authority).success).toBe(false);
});

test("Gate Passage and decision schemas reject formatted normalized prose", () => {
  // Given: valid relations with formatting syntax only in projected prose fields.
  const gate = {
    Type: "milestone-gate",
    ID: "gate:test",
    Title: "Test Gate",
    Roadmap: "roadmap:test",
    Status: "passed",
    Passage: {
      "Accepted decision": "Pass the Gate.",
      Rationale: "Use [the evidence][evidence].",
      Evidence: ["asset:test"],
      Exceptions: [],
    },
  };
  const check = {
    Type: "alignment-check",
    ID: "alignment-check:test",
    Title: "Confirm alignment",
    Status: "resolved",
    Target: "effort:test",
    Inputs: [],
    "Input fingerprint": FINGERPRINT,
    Resolution: {
      "Accepted decision": "Continue.",
      Rationale: "<!-- hidden rationale -->",
      "Changed references": ["roadmap:test"],
    },
  };
  const review = {
    Type: "planning-review",
    ID: "planning-review:test",
    Title: "Review sequence",
    Status: "pending",
    Scope: "> Entire project",
    Inputs: [],
    "Input fingerprint": FINGERPRINT,
  };

  // When / Then: each owning canonical record is invalid at its source boundary.
  expect(bearingSchema.safeParse(gate).success).toBe(false);
  expect(bearingSchema.safeParse(check).success).toBe(false);
  expect(bearingSchema.safeParse(review).success).toBe(false);
});

test("Asset source schema rejects formatted metadata without treating opaque references as prose", () => {
  // Given: one valid Asset and variants with formatting in projected metadata.
  const asset = {
    ID: "asset:test",
    Title: "Test Asset",
    Kind: "verification-report",
    Location: ".scratch/evidence/report.md",
    Owner: "effort:test",
    Producer: {
      Kind: "executor-profile",
      Name: "generic-agent",
      Reference: "native:<opaque-reference>",
    },
    "Lifecycle source": "native",
  };

  // When / Then: Title, Kind, and producer identity are plain; Reference stays opaque.
  expect(assetSchema.safeParse(asset).success).toBe(true);
  expect(assetSchema.safeParse({ ...asset, Title: "**Test Asset**" }).success).toBe(false);
  expect(assetSchema.safeParse({ ...asset, Kind: "`report`" }).success).toBe(false);
  expect(
    assetSchema.safeParse({ ...asset, Producer: { ...asset.Producer, Name: "<em>agent</em>" } })
      .success,
  ).toBe(false);
});

test("source schemas reject structures that cannot enter the normalized Snapshot", () => {
  // Given: structurally unsafe fields that older source schemas accepted as arbitrary strings.
  const asset = {
    ID: "asset:test",
    Title: "Test Asset",
    Kind: "verification-report",
    Location: "evidence/report.md",
    Owner: "effort:test",
    Producer: {
      Kind: "executor-profile",
      Name: "generic-agent",
      Reference: "native:opaque",
    },
    "Lifecycle source": "native",
    "Produced for": ".scratch/work/issues/01-work.md",
  };
  const check = {
    Type: "alignment-check",
    ID: "alignment-check:test",
    Title: "Confirm alignment",
    Status: "open",
    Target: "effort:test",
    Inputs: [],
    "Input fingerprint": FINGERPRINT,
  };
  const review = {
    Type: "planning-review",
    ID: "planning-review:test",
    Title: "Review sequence",
    Status: "completed",
    Scope: "Entire project",
    Inputs: [],
    "Input fingerprint": FINGERPRINT,
    Resolution: {
      "Accepted decision": "Continue.",
      Rationale: "The sequence remains sound.",
      "Changed references": ["roadmap:test"],
    },
  };
  const audit = {
    Type: "planning-audit",
    ID: "planning-audit:current",
    "Generated at": "2026-07-13T20:00:00+0800",
    Inputs: [],
    "Input fingerprint": FINGERPRINT,
    Coverage: "complete",
    "Skipped targets": [],
  };

  // When / Then: traversal, absolute paths, and blank opaque values fail at the source boundary.
  expect(assetSchema.safeParse({ ...asset, Location: "../outside.md" }).success).toBe(false);
  expect(assetSchema.safeParse({ ...asset, Owner: "/tmp/owner" }).success).toBe(false);
  expect(assetSchema.safeParse({ ...asset, "Produced for": "../outside.md" }).success).toBe(false);
  expect(
    assetSchema.safeParse({ ...asset, Producer: { ...asset.Producer, Reference: " " } }).success,
  ).toBe(false);
  expect(bearingSchema.safeParse({ ...check, Target: "/tmp/source.md" }).success).toBe(false);
  expect(bearingSchema.safeParse({ ...check, Target: "asset:**bad**" }).success).toBe(false);
  expect(
    bearingSchema.safeParse({
      ...review,
      Resolution: { ...review.Resolution, "Changed references": ["../outside.md"] },
    }).success,
  ).toBe(false);
  expect(bearingSchema.safeParse({ ...audit, "Skipped targets": ["../outside.md"] }).success).toBe(
    false,
  );
  expect(bearingSchema.safeParse({ ...audit, "Generated at": " " }).success).toBe(false);
});
