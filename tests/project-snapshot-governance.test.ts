import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildGovernanceProjection } from "../src/project-snapshot/governance";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { captureDecodedInputs } from "./project-snapshot-fixture";

const prepare = async (root: string) => {
  const sync = await runSync(root);
  const captured = await captureDecodedInputs(root, sync.inputs);
  const records = captured.decoded.records;
  return { sync, records };
};

test("projects exact governance prose without owning planning derivation", async () => {
  const root = await createValidBearingRepo();
  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });
  expect(projected.summary).toMatchObject({
    validity: "available",
    value: {
      id: "project-summary:current",
      purpose: "Exercise the fixture.",
      currentDesign: "One local Markdown planning loop.",
      boundaries: ["Keep native work native."],
    },
  });
  if (projected.summary.validity !== "available") throw new Error("Expected Summary.");
  expect(projected.summary.value.languages).toBeUndefined();
  expect(projected.roadmaps).toMatchObject({
    validity: "available",
    items: [
      {
        id: "roadmap:test",
        horizon: "unknown",
        gateOrder: ["gate:test"],
        effortIds: [],
      },
    ],
  });
  expect(projected.gates).toMatchObject({
    validity: "available",
    items: [
      {
        id: "gate:test",
        exitCriteria: ["All fixture work resolves."],
        readiness: "unknown",
        horizonState: "unknown",
        effortIds: ["effort:test"],
      },
    ],
  });
  expect(projected.efforts).toMatchObject({
    validity: "available",
    items: [
      {
        id: "effort:test",
        lifecycle: "active",
      },
    ],
  });
});

test("leaves horizon derivation to the Planning Graph owner", async () => {
  const root = await createValidBearingRepo();
  const roadmapPath = join(root, ".bearing/state/roadmaps/test.md");
  const roadmap = await readFile(roadmapPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    roadmap.replace("Focused gate: gate:test", "Focused gate: null"),
  );
  const gatePath = join(root, ".bearing/state/milestone-gates/test.md");
  const gate = await readFile(gatePath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    gate.replace(
      "Status: active",
      `Status: passed
Passage:
  Accepted decision: Pass the final declared Gate.
  Rationale: The accepted outcome horizon is exhausted.
  Evidence: []
  Exceptions: []`,
    ),
  );

  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });

  expect(projected.roadmaps).toMatchObject({
    validity: "available",
    items: [{ id: "roadmap:test", focusedGateId: null, horizon: "unknown" }],
  });
  expect(projected.gates).toMatchObject({
    validity: "available",
    items: [{ id: "gate:test", lifecycle: "passed", horizonState: "unknown" }],
  });
});

test("projects explicit per-part language metadata without inventing a missing language", async () => {
  // Given: only the authored Purpose declares a BCP-47 language tag.
  const root = await createValidBearingRepo();
  const path = join(root, ".bearing/state/project-summary.md");
  const summary = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    summary.replace("Title: Test Project", "Title: Test Project\nLanguages:\n  Purpose: zh-cn"),
  );

  // When: the canonical Summary crosses the normalized projection boundary.
  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });

  // Then: the declared tag is canonicalized and the undeclared part stays undeclared.
  expect(projected.summary).toMatchObject({
    validity: "available",
    value: { languages: { purpose: "zh-CN" } },
  });
  if (projected.summary.validity !== "available") throw new Error("Expected Summary.");
  expect(projected.summary.value.languages?.currentDesign).toBeUndefined();
});

test("projects independent Summary revision and Brief generation provenance", async () => {
  // Given: a revised canonical Summary and an independently generated derived Brief.
  const root = await createValidBearingRepo();
  const summaryPath = join(root, ".bearing/state/project-summary.md");
  const summary = await readFile(summaryPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    summary.replace("Title: Test Project", "Title: Test Project\nUpdated at: 2026-08-03T01:02:03Z"),
  );
  await writeFixture(
    root,
    ".bearing/state/project-brief.md",
    `---
Type: project-brief
ID: project-brief:current
Generated at: 2026-08-03T02:03:04Z
Languages:
  Project Purpose: zh-CN
---

# Project Brief

## Project Purpose

帮助用户保持长期项目方向。

## Current Stage

当前正在验证 revised G3 reading contract。

## Material Achieved State

已建立 managed planning lineage 与 read-only Portal baseline。
`,
  );

  // When: both records cross the normalized governance projection boundary.
  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });

  // Then: identity, prose, language, and time provenance remain independently typed.
  expect(projected.summary).toMatchObject({
    validity: "available",
    value: { id: "project-summary:current", updatedAt: "2026-08-03T01:02:03Z" },
  });
  expect(projected.brief).toMatchObject({
    validity: "available",
    value: {
      id: "project-brief:current",
      generatedAt: "2026-08-03T02:03:04Z",
      projectPurpose: "帮助用户保持长期项目方向。",
      currentStage: "当前正在验证 revised G3 reading contract。",
      materialAchievedState: "已建立 managed planning lineage 与 read-only Portal baseline。",
      languages: { projectPurpose: "zh-CN" },
    },
  });
});

test("keeps an absent Brief distinct from a legacy Summary without revision time", async () => {
  // Given: the legacy valid repository fixture has only a Summary and no authored time.
  const root = await createValidBearingRepo();

  // When: it crosses the same typed projection boundary.
  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });

  // Then: no time or Brief is inferred from file metadata, Summary prose, or projection time.
  expect(projected.summary).toMatchObject({ validity: "available" });
  if (projected.summary.validity !== "available") throw new Error("Expected Summary.");
  expect(projected.summary.value.updatedAt).toBeUndefined();
  expect(projected.brief).toEqual({ validity: "absent" });
});

test("isolates a malformed Brief without falling back to Summary prose", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/project-brief.md",
    `---
Type: project-brief
ID: project-brief:current
Generated at: 2026-08-03T02:03:04Z
---

# Project Brief

## Project Purpose

Exercise the fixture.

## Current Stage

The project is proving scoped invalidity.
`,
  );

  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });

  expect(projected.brief).toMatchObject({
    validity: "invalid",
    issues: [{ code: "missing-required-section", target: ".bearing/state/project-brief.md" }],
  });
  expect(projected.summary).toMatchObject({
    validity: "available",
    value: { purpose: "Exercise the fixture." },
  });
  expect(projected.roadmaps.validity).toBe("available");
});

test("isolates a Summary with invalid language metadata", async () => {
  // Given: an authored language tag is not valid BCP-47 metadata.
  const root = await createValidBearingRepo();
  const path = join(root, ".bearing/state/project-summary.md");
  const summary = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    summary.replace("Title: Test Project", "Title: Test Project\nLanguages:\n  Purpose: zh_CN"),
  );

  // When: the canonical Summary crosses the normalized projection boundary.
  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });

  // Then: the Summary is scoped invalid instead of receiving a guessed language.
  expect(projected.summary).toMatchObject({
    validity: "invalid",
    issues: [{ code: "invalid-bearing-schema" }],
  });
  expect(projected.roadmaps.validity).toBe("available");
});

test("isolates invalid Summary without blanking valid Roadmaps", async () => {
  const root = await createValidBearingRepo();
  const path = join(root, ".bearing/state/project-summary.md");
  const summary = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    summary.replace("## Purpose", "## Goal"),
  );
  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });
  expect(projected.summary.validity).toBe("invalid");
  expect(projected.roadmaps.validity).toBe("available");
  expect(
    projected.sources.some((source) => source.displayLocator.endsWith("project-summary.md")),
  ).toBe(true);
});

test("isolates plain-text contract failures to their governance projections", async () => {
  // Given: Summary prose and Gate intent contain authored formatting syntax.
  const root = await createValidBearingRepo();
  const summaryPath = join(root, ".bearing/state/project-summary.md");
  const summary = await readFile(summaryPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    summary.replace("Exercise the fixture.", "> Exercise the fixture."),
  );
  const gatePath = join(root, ".bearing/state/milestone-gates/test.md");
  const gate = await readFile(gatePath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    gate.replace("Reach the fixture boundary.", "Reach the **fixture** boundary."),
  );

  // When: the repository is projected into the normalized governance model.
  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });

  // Then: only the owning Summary and Gate projections become invalid.
  expect(projected.summary.validity).toBe("invalid");
  expect(projected.gates.validity).toBe("invalid");
  expect(projected.roadmaps.validity).toBe("available");
  expect(projected.efforts.validity).toBe("available");
});

test("isolates formatted Summary and Gate titles before they reach Overview", async () => {
  // Given: Overview-facing canonical titles contain formatting syntax.
  const root = await createValidBearingRepo();
  const summaryPath = join(root, ".bearing/state/project-summary.md");
  const summary = await readFile(summaryPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    summary.replace("Title: Test Project", "Title: '**Test Project**'"),
  );
  const gatePath = join(root, ".bearing/state/milestone-gates/test.md");
  const gate = await readFile(gatePath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    gate.replace("Title: Test Gate", "Title: '`Test Gate`'"),
  );

  // When: the repository is projected into the normalized governance model.
  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });

  // Then: each invalid title and the Roadmap relation that depends on the Gate are isolated.
  expect(projected.summary.validity).toBe("invalid");
  expect(projected.gates.validity).toBe("invalid");
  expect(projected.roadmaps.validity).toBe("invalid");
});

test("isolates prose whose formatting appears only after line normalization", async () => {
  // Given: Summary and Roadmap prose hide formatting delimiters across authored lines.
  const root = await createValidBearingRepo();
  const summaryPath = join(root, ".bearing/state/project-summary.md");
  const summary = await readFile(summaryPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    summary.replace("Exercise the fixture.", "**Exercise the\nfixture.**"),
  );
  const roadmapPath = join(root, ".bearing/state/roadmaps/test.md");
  const roadmap = await readFile(roadmapPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    roadmap.replace("Prove the fixture.", "Prove **the\nfixture**."),
  );

  // When: paragraphs cross the normalized governance projection boundary.
  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });

  // Then: each owning projection is scoped invalid and independent peers survive.
  expect(projected.summary.validity).toBe("invalid");
  expect(projected.roadmaps.validity).toBe("invalid");
  expect(projected.gates.validity).toBe("available");
  expect(projected.efforts.validity).toBe("available");
});

test("projects empty Summary list sections without inventing placeholder prose", async () => {
  // Given: optional synthesis lists have no current entries but retain their exact headings.
  const root = await createValidBearingRepo();
  const summaryPath = join(root, ".bearing/state/project-summary.md");
  const summary = await readFile(summaryPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    summary.replace("- Add another adapter after the MVP.", "").replace("- None yet.", ""),
  );

  // When: the Summary crosses the normalized projection boundary.
  const { sync, records } = await prepare(root);
  const projected = buildGovernanceProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
  });

  // Then: empty means no entries; it is not malformed and needs no sentinel text.
  expect(projected.summary.validity).toBe("available");
  if (projected.summary.validity !== "available") return;
  expect(projected.summary.value.futureCandidates).toEqual([]);
  expect(projected.summary.value.materialRevisions).toEqual([]);
});
