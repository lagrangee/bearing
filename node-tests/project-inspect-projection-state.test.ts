import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { buildProjectOverviewModel } from "../src/portal-ui/project-overview-model";
import { portalRowsToProjectData } from "../src/portal-ui/project-row-adapter";
import {
  type ProjectInspectEnvelope,
  projectContextResultSchema,
} from "../src/project-read-model/contract";
import { inspectProject } from "../src/project-read-model/inspect";
import { queryPortalProjectRowsWithGeneration } from "../src/project-read-model/portal";
import { createValidBearingRepo } from "../tests/helpers";

const readMatchingPortalOverview = async (
  root: string,
  inspected: ProjectInspectEnvelope,
  diagnostics: ProjectInspectEnvelope["diagnostics"],
) => {
  const portal = await queryPortalProjectRowsWithGeneration(root, "overview");
  assert.equal(portal.generation.basisFingerprint, inspected.generation?.basisFingerprint);
  assert.equal(portal.generation.publicationCount, inspected.generation?.publicationCount);
  assert.deepEqual(portal.rows.diagnostics, diagnostics);
  const data = portalRowsToProjectData({ ...portal.rows, renderedMarkdown: [] });
  assert.equal(data.section, "overview");
  if (data.section !== "overview") throw new Error("Expected Overview project data.");
  return { data, overview: buildProjectOverviewModel(data) };
};

test("Inspect and Portal retain an invalid Summary and its blocking diagnostic", async () => {
  const root = await createValidBearingRepo();
  try {
    const summaryPath = join(root, ".bearing/state/project-summary.md");
    await writeFile(
      summaryPath,
      (await readFile(summaryPath, "utf8")).replace("## Purpose\n\nExercise the fixture.\n\n", ""),
    );

    const inspected = await inspectProject(root, { kind: "project" });
    const context = projectContextResultSchema.parse(inspected.result);
    assert.deepEqual(context.summary, { validity: "invalid" });
    assert.equal(inspected.outcome, "partial");
    const diagnostic = inspected.diagnostics.find(
      (item) => item.target === ".bearing/state/project-summary.md",
    );
    assert.ok(diagnostic);
    assert.equal(diagnostic.code, "missing-required-section");
    assert.equal(diagnostic.impact, "blocking");
    assert.equal(diagnostic.message, "Bearing artifact is missing ## Purpose.");
    assert.ok(context.diagnosticCounts.blocking > 0);

    const { data, overview } = await readMatchingPortalOverview(root, inspected, [diagnostic]);
    assert.equal(data.summary.validity, "invalid");
    assert.equal(overview.summary.state, "invalid");
    assert.ok(overview.attention.some((item) => item.key === diagnostic.reference));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Inspect and Portal retain an invalid Brief and its blocking diagnostic", async () => {
  const root = await createValidBearingRepo();
  try {
    await writeFile(
      join(root, ".bearing/state/project-brief.md"),
      `---
Type: project-brief
ID: project-brief:current
Generated at: 2026-08-09T13:00:00.000Z
---

# Project Brief

## Current Position

The fixture Roadmap is active.

## Established Baseline

- Portal and Inspect read the same committed project.
`,
    );

    const inspected = await inspectProject(root, { kind: "project" });
    const context = projectContextResultSchema.parse(inspected.result);
    assert.deepEqual(context.brief, { validity: "invalid" });
    assert.equal(inspected.outcome, "partial");
    const diagnostic = inspected.diagnostics.find(
      (item) => item.target === ".bearing/state/project-brief.md",
    );
    assert.ok(diagnostic);
    assert.equal(diagnostic.code, "missing-required-section");
    assert.equal(diagnostic.impact, "blocking");
    assert.equal(diagnostic.message, "Bearing artifact is missing ## At a Glance.");
    assert.ok(context.diagnosticCounts.blocking > 0);

    const { data, overview } = await readMatchingPortalOverview(root, inspected, [diagnostic]);
    assert.equal(data.brief.validity, "invalid");
    assert.equal(overview.brief.state, "invalid");
    assert.ok(overview.attention.some((item) => item.key === diagnostic.reference));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const validity of ["available", "absent"] as const) {
  test(`Inspect and Portal agree when Summary and Brief are ${validity}`, async () => {
    const root = await createValidBearingRepo();
    try {
      await rm(join(root, ".bearing/state/efforts/test.md"));
      const gatePath = join(root, ".bearing/state/milestone-gates/test.md");
      await writeFile(
        gatePath,
        (await readFile(gatePath, "utf8")).replace(
          "Effort order:\n  - effort:test",
          "Effort order: []",
        ),
      );
      if (validity === "available") {
        await writeFile(
          join(root, ".bearing/state/project-brief.md"),
          `---
Type: project-brief
ID: project-brief:current
Generated at: 2026-08-09T13:00:00.000Z
---

# Project Brief

## At a Glance

Keep the accepted project decisions visible.

## Current Position

The fixture Roadmap is active.

## Established Baseline

- Portal and Inspect read the same committed project.
`,
        );
      } else {
        await rm(join(root, ".bearing/state/project-summary.md"));
      }

      const inspected = await inspectProject(root, { kind: "project" });
      const context = projectContextResultSchema.parse(inspected.result);
      assert.equal(inspected.outcome, "complete", JSON.stringify(inspected.diagnostics));
      assert.deepEqual(inspected.diagnostics, []);
      assert.deepEqual(context.diagnosticCounts, { blocking: 0, nonBlocking: 0 });
      assert.equal(context.summary.validity, validity);
      assert.equal(context.brief.validity, validity);
      if (validity === "available") {
        assert.ok(context.summary.validity === "available");
        assert.ok(context.brief.validity === "available");
        assert.equal(context.summary.value.purpose, "Exercise the fixture.");
        assert.equal(context.brief.value.atAGlance, "Keep the accepted project decisions visible.");
      }

      const { data, overview } = await readMatchingPortalOverview(root, inspected, []);
      assert.deepEqual(data.summary, context.summary);
      assert.deepEqual(data.brief, context.brief);
      assert.equal(overview.summary.state, validity);
      assert.equal(overview.brief.state, validity);
      assert.deepEqual(overview.attention, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
