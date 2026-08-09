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
    "Effort order": [],
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
  const markdownHardBreak = "  ";
  expect(
    bearingSchema.safeParse({
      ...summary,
      Title: `Hard break${markdownHardBreak}\nSummary`,
    }).success,
  ).toBe(false);
  expect(bearingSchema.safeParse({ ...summary, Title: "Hard break\\\nSummary" }).success).toBe(
    false,
  );
  expect(bearingSchema.safeParse({ ...summary, Title: "[Split\nSummary](source)" }).success).toBe(
    false,
  );
  expect(bearingSchema.safeParse(roadmap).success).toBe(false);
  expect(bearingSchema.safeParse(gate).success).toBe(false);
  const { "Effort order": _effortOrder, ...gateWithoutEffortOrder } = {
    ...gate,
    Title: "Plain Gate",
  };
  expect(bearingSchema.safeParse(gateWithoutEffortOrder).success).toBe(false);
  expect(bearingSchema.safeParse(citedRoadmap).success).toBe(false);
  expect(bearingSchema.safeParse(effort).success).toBe(false);
  expect(bearingSchema.safeParse(authority).success).toBe(false);
});

test("Gate Passage and Planning Review schemas reject formatted normalized prose", () => {
  // Given: valid relations with formatting syntax only in projected prose fields.
  const gate = {
    Type: "milestone-gate",
    ID: "gate:test",
    Title: "Test Gate",
    Roadmap: "roadmap:test",
    Status: "passed",
    "Effort order": [],
    Passage: {
      "Accepted decision": "Pass the Gate.",
      Rationale: "Use [the evidence][evidence].",
      Evidence: ["asset:test"],
      Exceptions: [],
    },
  };
  const review = {
    Type: "planning-review",
    ID: "planning-review:test",
    Title: "Review sequence",
    Status: "completed",
    Question: "Should the sequence change?",
    Scope: "project",
    Inputs: [],
    "Input fingerprint": FINGERPRINT,
    Resolution: {
      "Accepted decision": "Continue.",
      "Accepted at": "2026-08-08T00:00:00.000Z",
      Rationale: "The sequence remains sound.",
      "Changed references": ["roadmap:test"],
    },
  };

  // When / Then: each otherwise-valid owner rejects formatting at the exact prose field.
  expect(bearingSchema.safeParse(gate).success).toBe(false);
  expect(bearingSchema.safeParse(review).success).toBe(true);
  expect(
    bearingSchema.safeParse({ ...review, Question: "Should **formatted** work continue?" }).success,
  ).toBe(false);
  expect(
    bearingSchema.safeParse({
      ...review,
      Resolution: { ...review.Resolution, Rationale: "<!-- hidden rationale -->" },
    }).success,
  ).toBe(false);
});

test("Asset source schema rejects formatted semantic metadata without treating Source as prose", () => {
  // Given: one valid Asset and variants with formatting in projected metadata.
  const asset = {
    ID: "asset:test",
    Title: "Test Asset",
    Purpose: "Keep the test reference available.",
    Kind: "reference",
    Source: "https://example.com/reference?v=%2A%2Aopaque%2A%2A",
    Owner: "effort:test",
    "Added at": null,
    Disposition: "active",
    Origin: "External reference",
  };

  // When / Then: semantic prose is plain; Source stays opaque.
  expect(assetSchema.safeParse(asset).success).toBe(true);
  expect(assetSchema.safeParse({ ...asset, Title: "**Test Asset**" }).success).toBe(false);
  expect(assetSchema.safeParse({ ...asset, Kind: "`report`" }).success).toBe(false);
  expect(assetSchema.safeParse({ ...asset, Origin: "<em>external</em>" }).success).toBe(false);
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
  const review = {
    Type: "planning-review",
    ID: "planning-review:test",
    Title: "Review sequence",
    Status: "completed",
    Question: "Should the sequence change?",
    Scope: "project",
    Inputs: [],
    "Input fingerprint": FINGERPRINT,
    Resolution: {
      "Accepted decision": "Continue.",
      "Accepted at": "2026-08-08T00:00:00.000Z",
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
  expect(
    bearingSchema.safeParse({ ...review, Scope: "exact-target", Target: "/tmp/source.md" }).success,
  ).toBe(false);
  expect(
    bearingSchema.safeParse({ ...review, Scope: "exact-target", Target: "asset:**bad**" }).success,
  ).toBe(false);
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
