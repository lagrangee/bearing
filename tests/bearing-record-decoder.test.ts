import { expect, test } from "bun:test";
import { decodeBearingRecordGeneration } from "../src/bearing-record-decoder";
import { discoverProjectSitemapInputs } from "../src/sitemap-discovery";
import { captureSyncInputGeneration } from "../src/sync-input-generation";
import { createValidBearingRepo, writeFixture } from "./helpers";

const fingerprint = `sha256:${"a".repeat(64)}`;

test("decodes every owned Bearing Record once behind one generation interface", async () => {
  const root = await createValidBearingRepo();
  await addRemainingRecordTypes(root);
  const discovery = await discoverProjectSitemapInputs(root);
  const generation = await captureSyncInputGeneration(root, discovery.inputs);

  const decoded = decodeBearingRecordGeneration(generation);

  expect(decoded.records.map((record) => record.type)).toEqual([
    "alignment-check",
    "asset-registry",
    "authority",
    "effort",
    "milestone-gate",
    "next-work-guidance",
    "planning-audit",
    "planning-review",
    "project-summary",
    "roadmap-index",
    "roadmap",
  ]);
  expect(decoded.records.every((record) => record.trust === "available")).toBe(true);
  expect(decoded.metrics).toEqual({
    capturedInputCount: generation.records.length,
    bearingRecordCount: 11,
    decodeCount: 11,
  });
  expect(decoded.records.some((record) => record.locator.endsWith("/map.md"))).toBe(false);
  expect(decoded.records.some((record) => record.locator.endsWith("/issues/01-finish.md"))).toBe(
    false,
  );
  expect(JSON.stringify(decoded)).not.toContain("# Project Summary: Test Project");
});

test("represents invalid source as data for every Bearing Record type", async () => {
  const root = await createValidBearingRepo();
  await addRemainingRecordTypes(root);
  const discovery = await discoverProjectSitemapInputs(root);
  const generation = await captureSyncInputGeneration(root, discovery.inputs);
  const owned = decodeBearingRecordGeneration(generation).records;

  for (const record of owned) {
    const captured = generation.records.find((candidate) => candidate.locator === record.locator);
    if (captured === undefined) throw new Error(`Missing captured fixture: ${record.locator}`);
    const invalid = {
      ...captured,
      source: "not frontmatter",
      bytes: Buffer.from("not frontmatter"),
    };
    const decoded = decodeBearingRecordGeneration({
      fingerprint: generation.fingerprint,
      records: [invalid],
    });
    expect(decoded.records).toHaveLength(1);
    expect(decoded.records[0]).toMatchObject({ type: record.type, trust: "invalid" });
  }
});

test("isolates valid Planning Audit findings and Asset entries as partial records", async () => {
  const root = await createValidBearingRepo();
  await addRemainingRecordTypes(root);
  await writeFixture(root, ".bearing/state/planning-audit.md", partialAudit());
  await writeFixture(root, ".bearing/state/assets.md", partialAssets());
  await writeFixture(
    root,
    ".bearing/state/efforts/test.md",
    `---
Type: effort
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities:
  - authority:architecture
Citations:
  - Asset: asset:healthy
    Note: Preserve the healthy partial member.
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/work
---

# Effort: Test

## Intent

Exercise the sync contract.

## Work

- [Map](map.md)
`,
  );
  await writeFixture(
    root,
    ".bearing/state/authorities/architecture.md",
    `---
Type: authority
ID: authority:architecture
Title: Architecture
Baseline:
  - asset:healthy
---

# Architecture Authority

## Scope

Current architecture decisions.

## Current Baseline

The healthy partial Asset remains trustworthy.
`,
  );
  const discovery = await discoverProjectSitemapInputs(root);
  const generation = await captureSyncInputGeneration(root, discovery.inputs);

  const decoded = decodeBearingRecordGeneration(generation);
  const audit = decoded.records.find((record) => record.type === "planning-audit");
  const assets = decoded.records.find((record) => record.type === "asset-registry");

  expect(audit).toMatchObject({ trust: "partial", content: { kind: "planning-audit" } });
  if (audit?.content.kind !== "planning-audit" || !audit.content.result.ok) {
    throw new Error("Expected a partially decoded Planning Audit.");
  }
  expect(audit.content.result.value.findings.map((finding) => finding.title)).toEqual([
    "Trusted finding",
  ]);
  expect(audit.content.result.value.invalidFindings).toEqual([
    { ordinal: 2, fragment: "finding-2" },
  ]);
  expect(assets).toMatchObject({ trust: "partial", content: { kind: "asset-registry" } });
  if (assets?.content.kind !== "asset-registry") {
    throw new Error("Expected a partially decoded Asset Registry.");
  }
  expect(assets.content.assets.map((asset) => asset.ID)).toEqual(["asset:healthy"]);
  expect(assets.content.invalidEntries).toEqual([{ key: "asset:broken", title: "Broken Asset" }]);
  expect(
    decoded.diagnostics.filter((diagnostic) => diagnostic.code === "broken-canonical-reference"),
  ).toEqual([]);
});

test("checks generation-wide Bearing Record identity, singleton, and reference invariants", async () => {
  const root = await createValidBearingRepo();
  await addRemainingRecordTypes(root);
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/missing.md",
    `---
Type: alignment-check
ID: alignment-check:missing
Title: Missing target
Status: open
Target: effort:missing
Inputs: []
Input fingerprint: ${fingerprint}
---
`,
  );
  const discovery = await discoverProjectSitemapInputs(root);
  const generation = await captureSyncInputGeneration(root, discovery.inputs);
  const roadmap = generation.records.find(
    (record) => record.locator === ".bearing/state/roadmaps/test.md",
  );
  const summary = generation.records.find(
    (record) => record.locator === ".bearing/state/project-summary.md",
  );
  if (roadmap === undefined || summary === undefined)
    throw new Error("Missing invariant fixtures.");
  const duplicateRoadmap = {
    ...roadmap,
    locator: ".bearing/state/roadmaps/duplicate.md",
  };
  const records = [...generation.records, duplicateRoadmap, summary];

  const decoded = decodeBearingRecordGeneration({
    fingerprint: generation.fingerprint,
    records,
  });

  expect(decoded.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
    expect.arrayContaining([
      "duplicate-stable-id",
      "singleton-bearing-record-conflict",
      "broken-canonical-reference",
    ]),
  );
});

test("rejects a schema-valid Record whose type does not match its locator", async () => {
  const root = await createValidBearingRepo();
  await addRemainingRecordTypes(root);
  const discovery = await discoverProjectSitemapInputs(root);
  const generation = await captureSyncInputGeneration(root, discovery.inputs);
  const roadmap = generation.records.find(
    (record) => record.locator === ".bearing/state/roadmaps/test.md",
  );
  const authority = generation.records.find(
    (record) => record.locator === ".bearing/state/authorities/architecture.md",
  );
  if (roadmap === undefined || authority === undefined)
    throw new Error("Missing mismatch fixtures.");
  const mismatch = { ...authority, source: roadmap.source, bytes: roadmap.bytes };

  const decoded = decodeBearingRecordGeneration({
    fingerprint: generation.fingerprint,
    records: [mismatch],
  });

  expect(decoded.records[0]).toMatchObject({ type: "authority", trust: "invalid" });
  expect(decoded.diagnostics).toContainEqual({
    code: "unexpected-bearing-type",
    impact: "blocking",
    target: ".bearing/state/authorities/architecture.md",
    message: "Expected Type: authority.",
  });
});

test("strips unknown frontmatter fields from normalized Decoder output", async () => {
  const root = await createValidBearingRepo();
  const locator = ".bearing/state/roadmaps/test.md";
  const discovery = await discoverProjectSitemapInputs(root);
  const generation = await captureSyncInputGeneration(root, discovery.inputs);
  const roadmap = generation.records.find((record) => record.locator === locator);
  if (roadmap === undefined) throw new Error("Missing Roadmap fixture.");
  const source = roadmap.source.replace(
    "Status: active",
    "Status: active\nUnnormalized extra: leak",
  );
  const record = { ...roadmap, source, bytes: Buffer.from(source, "utf8") };

  const decoded = decodeBearingRecordGeneration({
    fingerprint: generation.fingerprint,
    records: [record],
  });

  expect(decoded.records[0]?.trust).toBe("available");
  expect(decoded.records[0]?.data).not.toHaveProperty("Unnormalized extra");
  expect(JSON.stringify(decoded.records[0])).not.toContain("leak");
});

test("checks stable references decoded from Guidance body content", async () => {
  const root = await createValidBearingRepo();
  await addRemainingRecordTypes(root);
  const locator = ".bearing/state/next-work-guidance.md";
  const discovery = await discoverProjectSitemapInputs(root);
  const generation = await captureSyncInputGeneration(root, discovery.inputs);
  const guidance = generation.records.find((record) => record.locator === locator);
  if (guidance === undefined) throw new Error("Missing Guidance fixture.");
  const source = guidance.source
    .replace("roadmap:test", "roadmap:missing")
    .replace("gate:test", "gate:missing")
    .replace("effort:test", "effort:missing");
  const record = { ...guidance, source, bytes: Buffer.from(source, "utf8") };

  const decoded = decodeBearingRecordGeneration({
    fingerprint: generation.fingerprint,
    records: [record],
  });

  expect(decoded.records[0]?.trust).toBe("available");
  expect(
    decoded.diagnostics.filter((entry) => entry.code === "broken-canonical-reference"),
  ).toHaveLength(3);
});

test("checks every stable ID prefix carried by Asset references", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:review
    Title: Review evidence
    Kind: verification-report
    Location: evidence/review.md
    Owner: planning-review:missing
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
    Produced for: next-work-guidance:missing
---

# Asset Registry
`,
  );
  const discovery = await discoverProjectSitemapInputs(root);
  const generation = await captureSyncInputGeneration(root, discovery.inputs);

  const decoded = decodeBearingRecordGeneration(generation);

  expect(
    decoded.diagnostics.filter((entry) => entry.code === "broken-canonical-reference"),
  ).toHaveLength(2);
});

const addRemainingRecordTypes = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/state/authorities/architecture.md",
    `---
Type: authority
ID: authority:architecture
Title: Architecture
Baseline: []
---

# Architecture Authority

## Scope

Current architecture decisions.

## Current Baseline

No additional baseline is adopted.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/test.md",
    `---
Type: alignment-check
ID: alignment-check:test
Title: Confirm the test
Status: open
Target: effort:test
Inputs: []
Input fingerprint: ${fingerprint}
---

# Alignment Check
`,
  );
  await writeFixture(
    root,
    ".bearing/state/planning-reviews/test.md",
    `---
Type: planning-review
ID: planning-review:test
Title: Review the test
Status: pending
Scope: Entire test project
Inputs: []
Input fingerprint: ${fingerprint}
---

# Planning Review
`,
  );
  await writeFixture(
    root,
    ".bearing/state/planning-audit.md",
    `---
Type: planning-audit
ID: planning-audit:current
Title: Current Audit
Generated at: 2026-07-18T00:00:00Z
Inputs: []
Input fingerprint: ${fingerprint}
Coverage: complete
Skipped targets: []
---

# Planning Audit

## Findings

No material findings.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    `---
Type: next-work-guidance
ID: next-work-guidance:current
Title: Current Guidance
Generated at: 2026-07-18T00:00:00Z
Inputs: []
Input fingerprint: ${fingerprint}
Semantic coverage: absent
---

# Next Work Guidance

## Primary Recommendation

### Continue the test

Keep the current fixture coherent.

#### Supporting References

- \`roadmap:test\`

## Alternatives

### Review the Gate

Inspect the active decision boundary.

#### Supporting References

- \`gate:test\`

### Review the Effort

Inspect the current native work scope.

#### Supporting References

- \`effort:test\`
`,
  );
};

const partialAudit = (): string => `---
Type: planning-audit
ID: planning-audit:current
Title: Current Audit
Generated at: 2026-07-18T00:00:00Z
Inputs: []
Input fingerprint: ${fingerprint}
Coverage: complete
Skipped targets: []
---

# Planning Audit

## Findings

### Trusted finding

The trusted member remains available.

#### Affected References

- \`gate:test\`

#### Evidence Sources

- \`.bearing/state/milestone-gates/test.md\`

#### Consequence

The valid member must survive.

#### Confidence Boundary

The decoder does not infer more meaning.

### Broken finding

This member omits the exact required structure.
`;

const partialAssets = (): string => `---
Type: asset-registry
Assets:
  - ID: asset:healthy
    Title: Healthy Asset
    Kind: verification-report
    Location: evidence/healthy.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
  - ID: asset:broken
    Title: Broken Asset
---

# Asset Registry
`;
