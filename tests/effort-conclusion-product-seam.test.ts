import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json";
import { compileProjectGeneration } from "../src/project-compilation";
import { findPlanningLineageSubjectProjection } from "../src/project-generation/planning-lineage";
import { buildSnapshotForProjectCompilation, writeFixture } from "./helpers";
import { installPackedProduct } from "./product-seams/installed-product";

const fixtures = join(process.cwd(), "validation/live-journey/fixtures");

const createConclusionFixture = async (root: string) => {
  await mkdir(join(root, ".bearing"), { recursive: true });
  await cp(join(fixtures, "conclusion-state"), join(root, ".bearing/state"), { recursive: true });
  await cp(join(fixtures, "completed-delivery"), root, { recursive: true });
  await writeFixture(
    root,
    ".bearing/manifest.json",
    JSON.stringify({
      schemaVersion: 2,
      packageVersion: packageMetadata.version,
      status: "active",
      runtime: "stable",
      surfaces: ["agent-skills"],
      executorProfiles: [],
    }),
  );
  await writeFixture(
    root,
    ".bearing/provider.json",
    JSON.stringify({
      schemaVersion: 1,
      provider: "matt-skills/v1",
      contractLocator: "docs/agents/issue-tracker.md",
    }),
  );
};

test("conclusion fixture exposes every owned Asset and both independent Authority adoptions", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-conclusion-fixture-"));
  try {
    await createConclusionFixture(root);
    const compilation = await compileProjectGeneration(root, {
      providerObservationIntent: "all-scope-verification",
    });
    expect(compilation.diagnostics).toEqual([]);
    const generation = await buildSnapshotForProjectCompilation(
      root,
      packageMetadata.version,
      compilation,
    );
    expect(generation.efforts).toMatchObject({
      validity: "available",
      items: [
        {
          id: "effort:label-delivery",
          lifecycle: "active",
          authorityIds: ["authority:label-behavior"],
        },
      ],
    });
    const effort = findPlanningLineageSubjectProjection(generation.lineage, {
      kind: "effort",
      id: "effort:label-delivery",
    });
    expect(
      effort?.relations.find((relation) => relation.key === "production.owned-assets"),
    ).toMatchObject({
      state: "present",
      total: { count: 3, coverage: "complete" },
      targets: expect.arrayContaining([
        expect.objectContaining({ reference: "asset:label-maintenance" }),
        expect.objectContaining({ reference: "asset:secondary-label-draft" }),
        expect.objectContaining({ reference: "asset:label-case-research" }),
      ]),
    });
    const draft = findPlanningLineageSubjectProjection(generation.lineage, {
      kind: "asset",
      id: "asset:secondary-label-draft",
    });
    expect(
      draft?.relations.find((relation) => relation.key === "adoption.current-baseline"),
    ).toMatchObject({
      state: "present",
      total: { count: 2, coverage: "complete" },
      targets: expect.arrayContaining([
        expect.objectContaining({ reference: "authority:label-behavior" }),
        expect.objectContaining({ reference: "authority:consumer-compatibility" }),
      ]),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("conclusion needs no Asset changes when ownership is empty or only historical", async () => {
  for (const historyOnly of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), "bearing-conclusion-minimal-"));
    try {
      await createConclusionFixture(root);
      for (const authority of ["label-behavior", "consumer-compatibility"]) {
        const path = `.bearing/state/authorities/${authority}.md`;
        const original = await readFile(join(root, path), "utf8");
        await writeFixture(
          root,
          path,
          original.replace("Baseline:\n  - asset:secondary-label-draft", "Baseline: []"),
        );
      }
      const assets = historyOnly
        ? `---
Type: asset-registry
Assets:
  - ID: asset:label-case-research
    Title: Label casing research
    Purpose: Retain the historical comparison behind the chosen casing conventions.
    Kind: research
    Source: docs/label-case-research.md
    Owner: effort:label-delivery
    Added at: 2026-08-16T00:10:00Z
    Disposition: archived
    Archived at: 2026-08-17T09:00:00Z
---
`
        : "---\nType: asset-registry\nAssets: []\n---\n";
      await writeFixture(root, ".bearing/state/assets.md", assets);
      const effortPath = ".bearing/state/efforts/label-delivery.md";
      const effort = await readFile(join(root, effortPath), "utf8");
      await writeFixture(
        root,
        effortPath,
        effort.replace("Lifecycle: active", "Lifecycle: concluded").replace(
          "Work binding:",
          `Conclusion:
  Disposition: completed
  Rationale: The accepted secondary formatter delivery is complete.
  Concluded at: 2026-08-18T09:00:00Z
Work binding:`,
        ),
      );
      const compilation = await compileProjectGeneration(root, {
        providerObservationIntent: "all-scope-verification",
      });
      expect(compilation.diagnostics).toEqual([]);
      const generation = await buildSnapshotForProjectCompilation(
        root,
        packageMetadata.version,
        compilation,
      );
      expect(generation.efforts).toMatchObject({
        validity: "available",
        items: [
          { lifecycle: "concluded", workBinding: { nativeScope: ".scratch/label-delivery" } },
        ],
      });
      const projection = findPlanningLineageSubjectProjection(generation.lineage, {
        kind: "effort",
        id: "effort:label-delivery",
      });
      expect(
        projection?.relations.find((relation) => relation.key === "production.owned-assets"),
      ).toMatchObject(
        historyOnly
          ? { state: "present", total: { count: 1, coverage: "complete" } }
          : { state: "confirmed-none" },
      );
      expect(await readFile(join(root, ".bearing/state/assets.md"), "utf8")).toBe(assets);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("incomplete Asset and Authority sources retain uncertainty in conclusion relations", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-conclusion-coverage-"));
  const readGeneration = async () => {
    const compilation = await compileProjectGeneration(root, {
      providerObservationIntent: "all-scope-verification",
    });
    return buildSnapshotForProjectCompilation(root, packageMetadata.version, compilation);
  };
  try {
    await createConclusionFixture(root);
    const assetPath = ".bearing/state/assets.md";
    const assets = await readFile(join(root, assetPath), "utf8");
    await writeFixture(root, assetPath, assets.replace("Kind: research", "Kind: unknown"));
    let generation = await readGeneration();
    let effort = findPlanningLineageSubjectProjection(generation.lineage, {
      kind: "effort",
      id: "effort:label-delivery",
    });
    expect(
      effort?.relations.find((relation) => relation.key === "production.owned-assets"),
    ).toMatchObject({ state: "present", total: { count: 2, coverage: "at-least" } });

    await writeFixture(
      root,
      assetPath,
      assets.replaceAll("Owner: effort:label-delivery", "Owner: gate:stable-label-output"),
    );
    generation = await readGeneration();
    effort = findPlanningLineageSubjectProjection(generation.lineage, {
      kind: "effort",
      id: "effort:label-delivery",
    });
    expect(
      effort?.relations.find((relation) => relation.key === "production.owned-assets"),
    ).toMatchObject({ state: "unknown" });

    await writeFixture(root, assetPath, "---\nType: asset-registry\nAssets: invalid\n---\n");
    generation = await readGeneration();
    effort = findPlanningLineageSubjectProjection(generation.lineage, {
      kind: "effort",
      id: "effort:label-delivery",
    });
    expect(
      effort?.relations.find((relation) => relation.key === "production.owned-assets"),
    ).toMatchObject({ state: "unavailable" });

    await writeFixture(root, assetPath, assets);
    const authorityPath = ".bearing/state/authorities/consumer-compatibility.md";
    const authority = await readFile(join(root, authorityPath), "utf8");
    await writeFixture(root, authorityPath, authority.replace("## Scope", "## Missing scope"));
    generation = await readGeneration();
    const draft = findPlanningLineageSubjectProjection(generation.lineage, {
      kind: "asset",
      id: "asset:secondary-label-draft",
    });
    expect(
      draft?.relations.find((relation) => relation.key === "adoption.current-baseline"),
    ).toMatchObject({ state: "present", total: { coverage: "at-least" } });
    let contract = findPlanningLineageSubjectProjection(generation.lineage, {
      kind: "asset",
      id: "asset:label-contract",
    });
    expect(
      contract?.relations.find((relation) => relation.key === "adoption.current-baseline"),
    ).toMatchObject({ state: "unknown" });

    const behaviorPath = ".bearing/state/authorities/label-behavior.md";
    const behavior = await readFile(join(root, behaviorPath), "utf8");
    await writeFixture(root, behaviorPath, behavior.replace("## Scope", "## Missing scope"));
    generation = await readGeneration();
    contract = findPlanningLineageSubjectProjection(generation.lineage, {
      kind: "asset",
      id: "asset:label-contract",
    });
    expect(
      contract?.relations.find((relation) => relation.key === "adoption.current-baseline"),
    ).toMatchObject({ state: "unavailable" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed CLI validates a complete conclusion and rejects inactive Authority Baselines", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "conclusion");
  try {
    await createConclusionFixture(root);
    const captured = await product.run([
      "provider",
      "capture",
      "--scope",
      ".scratch/label-delivery",
      "--repo",
      root,
    ]);
    expect(captured.exitClass).toBe("success");
    const inspect = async (reference: string) =>
      JSON.parse((await product.run(["inspect", reference, "--repo", root])).stdout);
    const beforeGate = await inspect("gate:stable-label-output");
    expect(beforeGate.result.target.value).toMatchObject({
      lifecycle: "active",
      readiness: "not-ready",
    });
    const preservedPaths = [
      ".bearing/state/project-summary.md",
      ".bearing/state/roadmap-index.md",
      ".bearing/state/roadmaps/label-formatting.md",
      ".bearing/state/milestone-gates/stable-label-output.md",
      ".scratch/label-delivery/PRD.md",
      ".scratch/label-delivery/issues/04-complete-secondary-format.md",
      "src/format-label.ts",
      "tests/format-label.test.ts",
      "docs/label-maintenance.md",
      "docs/secondary-label-draft.md",
      "docs/label-contract.md",
      "docs/label-case-research.md",
    ];
    const preserved = await Promise.all(
      preservedPaths.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const),
    );
    const assetPath = ".bearing/state/assets.md";
    const originalAssets = await readFile(join(root, assetPath), "utf8");
    const transferred = originalAssets.replace(
      "Source: docs/label-maintenance.md\n    Owner: effort:label-delivery",
      "Source: docs/label-maintenance.md\n    Owner: roadmap:label-formatting",
    );
    await writeFixture(root, assetPath, transferred);
    expect(await inspect("asset:label-maintenance")).toMatchObject({
      outcome: "complete",
      result: {
        target: {
          value: {
            id: "asset:label-maintenance",
            owner: "roadmap:label-formatting",
            sourceLocator: "docs/label-maintenance.md",
            disposition: "active",
          },
        },
      },
    });
    for (const authority of ["label-behavior", "consumer-compatibility"]) {
      expect(await inspect(`authority:${authority}`)).toMatchObject({
        outcome: "complete",
        result: { target: { value: { baselineAssetIds: ["asset:secondary-label-draft"] } } },
      });
    }

    const disposed = transferred.replace(
      "    Disposition: active\n  - ID: asset:label-contract",
      `    Disposition: superseded
    Superseded by: asset:label-contract
    Superseded at: 2026-08-18T09:00:00Z
  - ID: asset:label-contract`,
    );
    await writeFixture(root, assetPath, disposed);
    for (const authority of ["label-behavior", "consumer-compatibility"]) {
      expect((await inspect(`authority:${authority}`)).outcome).not.toBe("complete");
    }
    expect((await inspect("diagnostics")).result).toEqual(
      expect.arrayContaining(
        ["label-behavior", "consumer-compatibility"].map((authority) =>
          expect.objectContaining({
            code: "authority-baseline-unavailable-asset",
            target: `.bearing/state/authorities/${authority}.md`,
            impact: "blocking",
          }),
        ),
      ),
    );
    expect(await readFile(join(root, assetPath), "utf8")).toBe(disposed);

    for (const authority of ["label-behavior", "consumer-compatibility"]) {
      const path = `.bearing/state/authorities/${authority}.md`;
      const original = await readFile(join(root, path), "utf8");
      await writeFixture(
        root,
        path,
        original
          .replace("  - asset:secondary-label-draft", "  - asset:label-contract")
          .replace(
            /## Current Baseline\n\n.*$/su,
            "## Current Baseline\n\nThe delivered label contract governs trimmed primary uppercase and secondary lowercase output.\n",
          ),
      );
    }
    const effortPath = ".bearing/state/efforts/label-delivery.md";
    const originalEffort = await readFile(join(root, effortPath), "utf8");
    await writeFixture(
      root,
      effortPath,
      originalEffort.replace("Lifecycle: active", "Lifecycle: concluded").replace(
        "Work binding:",
        `Conclusion:
  Disposition: completed
  Rationale: The accepted secondary formatter delivery is complete and its continuing material is accounted for.
  Concluded at: 2026-08-18T09:00:00Z
Work binding:`,
      ),
    );
    const concludedEffort = await inspect("effort:label-delivery");
    expect(concludedEffort).toMatchObject({ outcome: "complete", diagnostics: [] });
    expect((await inspect("diagnostics")).result).toEqual([]);
    const afterGate = await inspect("gate:stable-label-output");
    expect(afterGate.generation).toEqual(concludedEffort.generation);
    expect(afterGate.generation.basisFingerprint).not.toBe(beforeGate.generation.basisFingerprint);
    expect(afterGate.result.target.value).toMatchObject({
      lifecycle: "active",
      readiness: "ready-for-review",
    });
    const postTransitionContext = await inspect("project");
    expect(postTransitionContext.generation).toEqual(afterGate.generation);
    expect(postTransitionContext.result.roadmapFocus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          focusedGate: expect.objectContaining({
            id: "gate:stable-label-output",
            readiness: "ready-for-review",
          }),
        }),
      ]),
    );
    const briefPath = ".bearing/state/project-brief.md";
    const originalBrief = await readFile(join(root, briefPath), "utf8");
    await writeFixture(
      root,
      briefPath,
      originalBrief
        .replace("Generated at: 2026-08-17T10:00:00Z", "Generated at: 2026-08-18T09:00:00Z")
        .replace(
          "with Label Delivery as its active commitment.",
          "with Label Delivery concluded and the Gate still awaiting its independent decision.",
        ),
    );
    const affected = [
      "effort:label-delivery",
      "asset:label-maintenance",
      "asset:secondary-label-draft",
      "authority:label-behavior",
      "authority:consumer-compatibility",
      "project-brief:current",
    ];
    const readback = new Map<string, Awaited<ReturnType<typeof inspect>>>();
    for (const reference of affected) {
      const result = await inspect(reference);
      expect(result).toMatchObject({
        outcome: "complete",
        diagnostics: [],
        generation: {
          basisFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          publicationCount: expect.any(Number),
        },
      });
      readback.set(reference, result);
    }
    expect(
      new Set([...readback.values()].map((result) => JSON.stringify(result.generation))).size,
    ).toBe(1);
    expect(readback.get("effort:label-delivery")?.result.target.value).toMatchObject({
      lifecycle: "concluded",
      activatedAt: { availability: "available", value: "2026-08-16T00:05:00Z" },
      workBinding: { provider: "matt-skills/v1", nativeScope: ".scratch/label-delivery" },
      conclusion: { disposition: "completed" },
    });
    expect(readback.get("asset:secondary-label-draft")?.result.target.value).toMatchObject({
      disposition: "superseded",
      owner: "effort:label-delivery",
      supersededBy: "asset:label-contract",
      sourceLocator: "docs/secondary-label-draft.md",
    });
    expect((await inspect("asset:label-case-research")).result.target.value).toMatchObject({
      disposition: "archived",
      owner: "effort:label-delivery",
      archivedAt: { availability: "available", value: "2026-08-17T09:00:00Z" },
    });
    for (const authority of ["label-behavior", "consumer-compatibility"]) {
      expect(readback.get(`authority:${authority}`)?.result.target.value).toMatchObject({
        baselineAssetIds: ["asset:label-contract"],
      });
    }
    expect((await inspect("diagnostics")).result).toEqual([]);
    for (const [path, bytes] of preserved) {
      expect(await readFile(join(root, path), "utf8")).toBe(bytes);
    }
  } finally {
    await product.dispose();
  }
}, 120_000);
