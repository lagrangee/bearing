import { describe, expect, test } from "bun:test";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

describe("bearing sync", () => {
  test("diagnoses exact Citation, evidence provenance, and fingerprint contracts", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".scratch/work/effort.md",
      `---
Type: effort
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations:
  - Asset: asset:evidence
    Note: Relevant evidence.
    Extra: forbidden
---

# Effort: Test

## Intent

Exercise strict citations.

## Work

- [Map](map.md)
`,
    );
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:evidence
    Title: Evidence
    Kind: execution-evidence
    Location: .scratch/work/issues/01-finish.md
    Owner: effort:test
    Producer:
      Kind: executor-profile
      Name: generic-agent
    Lifecycle source: native
---

# Asset Registry
`,
    );
    await writeFixture(
      root,
      ".bearing/state/planning-reviews/bad.md",
      `---
Type: planning-review
ID: planning-review:bad
Title: Bad Fingerprint
Status: pending
Scope: project
Inputs: []
Input fingerprint: sha256:x
---

# Planning Review
`,
    );

    const result = await runSync(root);
    const invalidTargets = result.diagnostics
      .filter((item) => item.code === "invalid-bearing-schema")
      .map((item) => item.target);

    expect(invalidTargets).toContain(".scratch/work/effort.md");
    expect(invalidTargets).toContain(".bearing/state/planning-reviews/bad.md");
    expect(result.diagnostics).toContainEqual({
      code: "invalid-asset-schema",
      impact: "blocking",
      target: ".bearing/state/assets.md#asset:evidence",
      message: "Asset entry does not match its package-owned schema.",
    });
  });

  test("requires executor-profile provenance for Execution Evidence", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:evidence
    Title: Evidence
    Kind: execution-evidence
    Location: .scratch/work/issues/01-finish.md
    Owner: effort:test
    Producer:
      Kind: agent-surface
      Name: codex
    Produced for: .scratch/work/issues/01-finish.md
    Lifecycle source: native
---

# Asset Registry
`,
    );

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-asset-schema",
      impact: "blocking",
      target: ".bearing/state/assets.md#asset:evidence",
      message: "Asset entry does not match its package-owned schema.",
    });
  });

  test("diagnoses an Authority baseline that adopts an archived Asset", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:archived
    Title: Archived Baseline
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: planning-skill
      Name: prototype
    Lifecycle source: registry
    Disposition: archived
---

# Asset Registry
`,
    );
    await writeFixture(
      root,
      ".bearing/state/authorities/design.md",
      `---
Type: authority
ID: authority:design
Title: Design
Baseline:
  - asset:archived
---

# Design Authority

## Scope

Current design baseline.

## Current Baseline

Archived artifact.
`,
    );

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "authority-baseline-unavailable-asset",
      impact: "blocking",
      target: ".bearing/state/authorities/design.md",
      message: "Authority baseline references a non-available Asset: asset:archived.",
    });
  });

  test("diagnoses lifecycle ownership and replacement contradictions", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:native
    Title: Native Asset
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
    Disposition: available
  - ID: asset:available
    Title: Available Asset
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: registry
    Disposition: available
    Superseded by: asset:native
  - ID: asset:self
    Title: Self-superseding Asset
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: registry
    Disposition: superseded
    Superseded by: asset:self
---

# Asset Registry
`,
    );

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "native-asset-has-registry-disposition",
      impact: "blocking",
      target: "asset:native",
      message: "Native Asset lifecycle cannot be overridden by registry Disposition.",
    });
    expect(result.diagnostics).toContainEqual({
      code: "asset-replacement-without-superseded-disposition",
      impact: "blocking",
      target: "asset:available",
      message: "Only a superseded Asset can name a replacement.",
    });
    expect(result.diagnostics).toContainEqual({
      code: "self-superseding-asset",
      impact: "blocking",
      target: "asset:self",
      message: "An Asset cannot supersede itself.",
    });
  });

  test("diagnoses each cross-Asset supersession cycle exactly once", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:b
    Title: Cycle B
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: registry
    Disposition: superseded
    Superseded by: asset:a
  - ID: asset:a
    Title: Cycle A
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: registry
    Disposition: superseded
    Superseded by: asset:b
  - ID: asset:long-c
    Title: Long Cycle C
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: registry
    Disposition: superseded
    Superseded by: asset:long-a
  - ID: asset:long-a
    Title: Long Cycle A
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: registry
    Disposition: superseded
    Superseded by: asset:long-b
  - ID: asset:long-b
    Title: Long Cycle B
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: registry
    Disposition: superseded
    Superseded by: asset:long-c
---

# Asset Registry
`,
    );

    const result = await runSync(root);

    expect(result.diagnostics.filter((item) => item.code === "asset-supersession-cycle")).toEqual([
      {
        code: "asset-supersession-cycle",
        impact: "blocking",
        target: "asset:a",
        message: "Asset supersession cannot form a cycle.",
      },
      {
        code: "asset-supersession-cycle",
        impact: "blocking",
        target: "asset:long-a",
        message: "Asset supersession cannot form a cycle.",
      },
    ]);
  });
});
