import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanningLineagePage } from "../src/portal-ui/planning-lineage-page";
import { portalRowsToProjectData } from "../src/portal-ui/project-row-adapter";
import { queryPortalProjectRows } from "../src/project-read-model/portal";
import { captureProjectProviderScopes } from "../src/project-read-model/provider-operations";
import { projectReadModelPath } from "../src/project-read-model/store";
import { createValidBearingRepo, writeFixture } from "../tests/helpers";

test("Spec document structure survives capture, SQLite publication, typed query, and Portal markup", async () => {
  const root = await createValidBearingRepo();
  try {
    await writeFixture(
      root,
      ".scratch/work/PRD.md",
      `# Reference Spec

Status: ready-for-agent

## Problem Statement

The current path loses document structure.

## Solution

Publish one **provider-neutral** document contract.

## User Stories

### Reading order

7. Preserve the first outcome.
8. Preserve the second outcome with *supporting detail* and \`inline code\`.
   - Keep one nested bullet.
     - Keep the deeper bullet and a [safe link](https://example.com/spec).

## Compatibility Notes

This additive section needs no Portal-specific renderer.

## Implementation Decisions

The provider owns source-schema adaptation.

## Testing Decisions

Test the highest stable product seam.

## Out of Scope

Do not parse raw Markdown in Portal.

## Further Notes

Gate Passage remains human-owned.
`,
    );

    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(captured.outcome, "complete");

    const target = { kind: "native-subject" as const, id: ".scratch/work/PRD.md" };
    const rows = await queryPortalProjectRows(root, "lineage", target);
    const snapshot = portalRowsToProjectData(rows);
    if (snapshot.section !== "lineage") throw new Error("Expected typed Portal lineage rows.");
    const observation = snapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/work",
    );
    if (
      observation === undefined ||
      (observation.state !== "available" && observation.state !== "partial") ||
      observation.projection.spec === undefined
    ) {
      throw new Error("Expected the typed Spec provider observation.");
    }
    const spec = observation.projection.spec;
    assert.equal(spec.document.version, 1);
    assert.equal("sections" in spec, false);
    assert.equal(
      spec.native.rawFacets.some((facet) => facet.key === "markdown"),
      false,
    );

    const html = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: {
          validity: "valid",
          value: target,
        },
        snapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    assert.match(html, /<h1>Reference Spec<\/h1>/u);
    assert.match(html, /<h2>User Stories<\/h2>/u);
    assert.match(html, /<h3>Reading order<\/h3>/u);
    assert.match(html, /<ol start="7">/u);
    assert.match(html, /<ul><li>Keep one nested bullet\.<ul>/u);
    assert.match(html, /<strong>provider-neutral<\/strong>/u);
    assert.match(html, /<em>supporting detail<\/em>/u);
    assert.match(html, /<code>inline code<\/code>/u);
    assert.match(
      html,
      /<a href="https:\/\/example\.com\/spec" rel="noopener noreferrer" target="_blank">safe link<\/a>/u,
    );
    assert.match(html, /<h2>Compatibility Notes<\/h2>/u);
    assert.doesNotMatch(html, /<h[12]>Reading order<\/h[12]>/u);
    assert.doesNotMatch(html, /\*\*provider-neutral\*\*/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the self-host Architecture Contraction PRD retains its authored reading structure", async () => {
  const root = await createValidBearingRepo();
  try {
    const source = await readFile(
      join(process.cwd(), ".scratch/bearing-architecture-contraction/PRD.md"),
      "utf8",
    );
    await writeFixture(root, ".scratch/work/PRD.md", source);
    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(captured.outcome, "complete");

    const target = { kind: "native-subject" as const, id: ".scratch/work/PRD.md" };
    const rows = await queryPortalProjectRows(root, "lineage", target);
    const snapshot = portalRowsToProjectData(rows);
    if (snapshot.section !== "lineage") throw new Error("Expected typed Portal lineage rows.");
    const observation = snapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/work",
    );
    if (
      observation === undefined ||
      (observation.state !== "available" && observation.state !== "partial") ||
      observation.projection.spec === undefined
    ) {
      throw new Error("Expected the self-host Spec provider observation.");
    }
    const userStories = observation.projection.spec.document.sections.find(
      (section) => section.semanticRole === "spec.user-stories",
    );
    assert.equal(userStories?.availability, "available");
    assert.equal(
      userStories?.blocks.some(
        (block) => block.kind === "list" && block.style === "ordered" && block.items.length >= 125,
      ),
      true,
    );

    const html = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: { validity: "valid", value: target },
        snapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    assert.match(html, /<h2>User Stories<\/h2>/u);
    assert.match(html, /<h3>Provider-neutral document reading and Project Brief refinement<\/h3>/u);
    assert.match(html, /<li>As a Portal reader, I want ordered lists to remain ordered/u);
    assert.match(html, /<code>effortIds<\/code>/u);
    assert.match(html, /<strong>AC-DR-01<\/strong>/u);
    assert.doesNotMatch(html, /## Provider-neutral document reading/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsafe authored content and incompatible stored documents fail closed before Portal query", async () => {
  const root = await createValidBearingRepo();
  try {
    await writeFixture(
      root,
      ".scratch/work/PRD.md",
      `# Unsafe Spec

Status: ready-for-agent

## Problem Statement

Safe context remains available.

## Solution

<script>alert("unsafe")</script>

## User Stories

[unsafe link](javascript:alert(1))
`,
    );
    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(captured.outcome, "unfulfilled");

    const target = { kind: "native-subject" as const, id: ".scratch/work/PRD.md" };
    const unsafeRows = await queryPortalProjectRows(root, "lineage", target);
    const unsafeSnapshot = portalRowsToProjectData(unsafeRows);
    if (unsafeSnapshot.section !== "lineage") {
      throw new Error("Expected typed Portal lineage rows.");
    }
    assert.equal(
      unsafeSnapshot.providerObservations.some(
        (observation) => observation.binding.nativeScope === ".scratch/work",
      ),
      false,
    );
    await writeFixture(
      root,
      ".scratch/work/PRD.md",
      `# Safe Spec

Status: ready-for-agent

## Problem Statement

Safe context remains available.
`,
    );
    const safeCapture = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:01:00.000Z",
    });
    assert.equal(safeCapture.outcome, "complete");
    const safeRows = await queryPortalProjectRows(root, "lineage", target);
    const evidence = safeRows.objects.find(
      (object) =>
        object.kind === "portal-native-evidence" &&
        object.value.role === "bound" &&
        object.value.observation?.binding.nativeScope === ".scratch/work",
    );
    if (
      evidence?.kind !== "portal-native-evidence" ||
      evidence.value.observation === undefined ||
      (evidence.value.observation.state !== "available" &&
        evidence.value.observation.state !== "partial") ||
      evidence.value.observation.projection.spec === undefined
    ) {
      throw new Error("Expected a stored Portal-native Spec observation.");
    }

    const database = new DatabaseSync(projectReadModelPath(root));
    try {
      const stored = evidence.value.observation;
      const storedSpec = stored.projection.spec;
      if (storedSpec === undefined) throw new Error("Expected stored Spec content.");
      const incompatibleDocuments = [
        { ...storedSpec.document, version: 2 },
        {
          ...storedSpec.document,
          sections: storedSpec.document.sections.map((section, index) =>
            index === 0
              ? {
                  ...section,
                  availability: "available",
                  blocks: [{ kind: "html", value: '<script>alert("unsafe")</script>' }],
                }
              : section,
          ),
        },
      ];
      for (const document of incompatibleDocuments) {
        const tampered = {
          ...evidence.value,
          observation: {
            ...stored,
            projection: {
              ...stored.projection,
              spec: { ...storedSpec, document },
            },
          },
        };
        database
          .prepare(
            "UPDATE project_objects SET payload_json = ? WHERE reference = ? AND kind = 'portal-native-evidence'",
          )
          .run(JSON.stringify(tampered), evidence.value.id);
        await assert.rejects(queryPortalProjectRows(root, "lineage", target));
      }
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
