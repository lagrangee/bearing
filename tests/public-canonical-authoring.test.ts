import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import packageMetadata from "../package.json";
import { compileProjectGeneration } from "../src/project-compilation";
import {
  buildSnapshotForProjectCompilation,
  LOCAL_MATT_CONTRACT,
  LOCAL_MATT_TRIAGE_LABELS,
  writeFixture,
} from "./helpers";
import { installPackedProduct } from "./product-seams/installed-product";

type AuthoringExample = Readonly<{ owner: string; locator: string; bytes: string }>;

const owners = [
  "project-summary",
  "project-brief",
  "roadmap",
  "milestone-gate",
  "effort",
  "asset",
  "authority",
] as const;

const lifecycleAlternatives = [
  ["effort", 1, "efforts", "active", "effort:save-notes"],
  ["effort", 2, "efforts", "concluded", "effort:save-notes"],
  ["milestone-gate", 1, "gates", "passed", "gate:notes-persist"],
  ["milestone-gate", 2, "gates", "superseded", "gate:notes-persist"],
  ["roadmap", 2, "roadmaps", "completed", "roadmap:local-notes"],
] as const;

// mdast locates complete fenced blocks; slice the source instead of normalizing its code value.
const readExamples = async (skillRoot: string): Promise<readonly AuthoringExample[]> => {
  const examples: AuthoringExample[] = [];
  for (const owner of owners) {
    const source = await readFile(join(skillRoot, "references/owners", `${owner}.md`), "utf8");
    for (const node of fromMarkdown(source).children) {
      if (node.type !== "code" || node.lang !== "markdown" || node.meta === null) continue;
      if (!node.meta?.startsWith(".bearing/state/")) continue;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) throw new Error("Example has no source range.");
      const bytes = source.slice(
        source.indexOf("\n", start) + 1,
        source.lastIndexOf("\n", end - 1) + 1,
      );
      expect(bytes).toBe(`${node.value}\n`);
      examples.push({ owner, locator: node.meta, bytes });
    }
  }
  return examples;
};

const firstPlanningExamples = (examples: readonly AuthoringExample[]) => {
  const locators = [
    ".bearing/state/project-summary.md",
    ".bearing/state/roadmap-index.md",
    ".bearing/state/roadmaps/local-notes.md",
    ".bearing/state/milestone-gates/notes-persist.md",
    ".bearing/state/efforts/save-notes.md",
  ];
  return locators.map((locator) => {
    const example = examples.find((candidate) => candidate.locator === locator);
    if (example === undefined) throw new Error(`Public authoring example is missing: ${locator}`);
    return example;
  });
};

const writeExamples = async (root: string, examples: readonly AuthoringExample[]) => {
  for (const example of examples) await writeFixture(root, example.locator, example.bytes);
};

test("public first-planning examples form a coherent unbound generation without repairs", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-public-authoring-"));
  try {
    const examples = firstPlanningExamples(
      await readExamples(join(process.cwd(), "skills/bearing")),
    );
    await writeExamples(root, examples);

    const compilation = await compileProjectGeneration(root);
    expect(compilation.inputs).toEqual(examples.map((example) => example.locator).sort());
    expect(compilation.diagnostics).toEqual([]);
    expect(compilation.decoded.records.every((record) => record.trust === "available")).toBe(true);
    const generation = await buildSnapshotForProjectCompilation(
      root,
      packageMetadata.version,
      compilation,
    );
    expect(generation.roadmaps).toMatchObject({
      validity: "available",
      items: [
        { id: "roadmap:local-notes", focusedGateId: null, gateOrder: ["gate:notes-persist"] },
      ],
    });
    expect(generation.gates).toMatchObject({
      validity: "available",
      items: [{ id: "gate:notes-persist", lifecycle: "planned", effortIds: ["effort:save-notes"] }],
    });
    expect(generation.efforts).toMatchObject({
      validity: "available",
      items: [{ id: "effort:save-notes", lifecycle: "planned" }],
    });
    if (generation.efforts.validity !== "available") throw new Error("Efforts are unavailable.");
    expect(generation.efforts.items[0]).not.toHaveProperty("workBinding");
    expect(compilation.metrics.providerAcquisitionCount).toBe(0);
    for (const example of examples) {
      expect(await readFile(join(root, example.locator), "utf8")).toBe(example.bytes);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed CLI reads its raw public examples and rejects malformed authoring without rewriting sources", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "consumer");
  try {
    await mkdir(root);
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
    await writeFixture(root, "docs/agents/issue-tracker.md", LOCAL_MATT_CONTRACT);
    await writeFixture(root, "docs/agents/triage-labels.md", LOCAL_MATT_TRIAGE_LABELS);
    const skillRoot = join(product.root, "install/node_modules/@lagrangee/bearing/skills/bearing");
    for (const locator of [
      "references/contracts/canonical-mutation.md",
      ...owners.map((owner) => `references/owners/${owner}.md`),
    ]) {
      expect(await readFile(join(skillRoot, locator))).toEqual(
        await readFile(join(process.cwd(), "skills/bearing", locator)),
      );
    }
    const examples = await readExamples(skillRoot);
    const firstPlanning = firstPlanningExamples(examples);
    const initial = await product.run(["inspect", "project", "--repo", root]);
    expect(JSON.parse(initial.stdout)).toMatchObject({
      outcome: "complete",
      result: { summary: { validity: "absent" }, scopeOutline: [] },
    });
    await writeExamples(root, firstPlanning);
    for (const [reference, kind] of [
      ["project-summary:current", "project-summary"],
      ["roadmap:local-notes", "roadmap"],
      ["gate:notes-persist", "gate"],
      ["effort:save-notes", "effort"],
    ] as const) {
      const inspected = await product.run(["inspect", reference, "--repo", root]);
      expect(inspected.exitClass).toBe("success");
      expect(JSON.parse(inspected.stdout)).toMatchObject({
        outcome: "complete",
        result: { target: { kind, value: { id: reference } }, diagnostics: [] },
      });
    }
    const effort = JSON.parse(
      (await product.run(["inspect", "effort:save-notes", "--repo", root])).stdout,
    );
    expect(effort.result.target.value).toMatchObject({
      lifecycle: "planned",
      workBindingState: { state: "not-created" },
    });
    expect(effort.result.target.value).not.toHaveProperty("workBinding");

    const emptyRegistry = examples.filter((candidate) => candidate.owner === "asset")[1];
    if (emptyRegistry === undefined)
      throw new Error("Installed empty registry example is missing.");
    await writeExamples(root, [emptyRegistry]);
    expect(
      JSON.parse((await product.run(["inspect", "diagnostics", "--repo", root])).stdout),
    ).toMatchObject({ outcome: "complete", result: [] });
    expect(await readFile(join(root, emptyRegistry.locator), "utf8")).toBe(emptyRegistry.bytes);

    const additional = ["project-brief", "asset", "authority"].map((owner) => {
      const example = examples.find((candidate) => candidate.owner === owner);
      if (example === undefined) throw new Error(`Installed owner example is missing: ${owner}`);
      return example;
    });
    await writeExamples(root, additional);
    for (const reference of [
      "project-brief:current",
      "asset:note-format",
      "asset:note-format-draft",
      "asset:format-research",
      "authority:note-format",
    ]) {
      const inspected = await product.run(["inspect", reference, "--repo", root]);
      expect(inspected.exitClass).toBe("success");
      expect(JSON.parse(inspected.stdout)).toMatchObject({
        outcome: "complete",
        result: { target: { value: { id: reference } }, diagnostics: [] },
      });
    }
    expect(
      JSON.parse((await product.run(["inspect", "diagnostics", "--repo", root])).stdout),
    ).toMatchObject({ outcome: "complete", result: [] });

    await writeFixture(
      root,
      ".scratch/save-notes/PRD.md",
      "# Save and reopen notes\n\nStatus: ready-for-agent\n",
    );
    for (const [owner, ordinal, , lifecycle, reference] of lifecycleAlternatives) {
      const example = examples.filter((candidate) => candidate.owner === owner)[ordinal];
      if (example === undefined)
        throw new Error(`Missing installed ${owner} lifecycle example: ${lifecycle}`);
      await writeExamples(root, firstPlanning);
      await writeExamples(root, [example]);
      if (lifecycle === "active") {
        const capture = await product.run([
          "provider",
          "capture",
          "--scope",
          ".scratch/save-notes",
          "--repo",
          root,
        ]);
        expect(JSON.parse(capture.stdout)).toMatchObject({
          outcome: "complete",
          result: { acquisitionCount: 1 },
        });
      }
      const inspected = await product.run(["inspect", reference, "--repo", root]);
      expect(inspected.exitClass).toBe("success");
      expect(JSON.parse(inspected.stdout)).toMatchObject({
        outcome: "complete",
        result: { target: { value: { lifecycle } }, diagnostics: [] },
      });
      expect(await readFile(join(root, example.locator), "utf8")).toBe(example.bytes);
    }
    await writeExamples(root, firstPlanning);

    // Corrupt one known boundary at a time; valid examples above and restored below stay byte-exact.
    const malformed = [
      {
        owner: "project-summary",
        reference: "project-summary:current",
        defect: "missing title",
        from: "Title: Local Notes\n",
        to: "",
        code: "invalid-bearing-schema",
      },
      {
        owner: "effort",
        reference: "effort:save-notes",
        defect: "missing required collection",
        from: "Citations: []\n",
        to: "",
        code: "invalid-bearing-schema",
      },
      {
        owner: "effort",
        reference: "effort:save-notes",
        defect: "duplicate required section",
        from: "## Work",
        to: "## Intent\n\nDuplicate intent.\n\n## Work",
        code: "invalid-bearing-record-body",
      },
      {
        owner: "milestone-gate",
        reference: "gate:notes-persist",
        defect: "task list in plain list",
        from: "- A saved note reopens",
        to: "- [ ] A saved note reopens",
        code: "invalid-bearing-record-body",
      },
      {
        owner: "milestone-gate",
        reference: "gate:notes-persist",
        defect: "missing contribution order",
        from: "Effort order:\n  - effort:save-notes",
        to: "Effort order: []",
        code: "gate-effort-order-mismatch",
      },
      {
        owner: "effort",
        reference: "effort:save-notes",
        defect: "planned and bound",
        from: "Lifecycle: planned\n",
        to: "Lifecycle: planned\nWork binding:\n  Provider: matt-skills/v1\n  Native scope: .scratch/save-notes\n",
        code: "effort-work-binding-lifecycle-conflict",
      },
      {
        owner: "effort",
        reference: "effort:save-notes",
        defect: "active without Binding",
        from: "Lifecycle: planned\n",
        to: "Lifecycle: active\nActivated at: 2026-09-01T10:00:00.000Z\n",
        code: "effort-work-binding-missing",
      },
    ];
    for (const defect of malformed) {
      const example = firstPlanning.find((candidate) => candidate.owner === defect.owner);
      if (example === undefined || !example.bytes.includes(defect.from))
        throw new Error(`Missing negative-case basis: ${defect.defect}`);
      const bytes = example.bytes.replace(defect.from, defect.to);
      await writeFixture(root, example.locator, bytes);
      const inspection = JSON.parse(
        (await product.run(["inspect", defect.reference, "--repo", root])).stdout,
      );
      expect(inspection.outcome, defect.defect).not.toBe("complete");
      const diagnostics = JSON.parse(
        (await product.run(["inspect", "diagnostics", "--repo", root])).stdout,
      );
      expect(diagnostics.result, defect.defect).toContainEqual(
        expect.objectContaining({ code: defect.code, impact: "blocking", target: example.locator }),
      );
      expect(await readFile(join(root, example.locator), "utf8")).toBe(bytes);
      await writeFixture(root, example.locator, example.bytes);
      expect(
        JSON.parse((await product.run(["inspect", defect.reference, "--repo", root])).stdout),
      ).toMatchObject({ outcome: "complete" });
    }

    for (const [owner, reference, from, to, timeField] of [
      [
        "project-summary",
        "project-summary:current",
        "Updated at: 2026-09-01T09:00:00.000Z\n",
        "",
        "updatedAt",
      ],
      [
        "effort",
        "effort:save-notes",
        "Planned at: 2026-09-01T09:00:00.000Z",
        "Planned at: null",
        "plannedAt",
      ],
    ] as const) {
      const example = firstPlanning.find((candidate) => candidate.owner === owner);
      if (example === undefined) throw new Error(`Missing historical-case basis: ${owner}`);
      const historical = example.bytes.replace(from, to);
      await writeFixture(root, example.locator, historical);
      const inspected = JSON.parse(
        (await product.run(["inspect", reference, "--repo", root])).stdout,
      );
      expect(inspected.outcome).toBe("complete");
      if (timeField === "updatedAt") {
        expect(inspected.result.target.value).not.toHaveProperty(timeField);
      } else {
        expect(inspected.result.target.value[timeField]).toEqual({ availability: "unavailable" });
      }
      expect(await readFile(join(root, example.locator), "utf8")).toBe(historical);
      await writeExamples(root, [example]);
    }
    for (const example of [...firstPlanning, ...additional]) {
      expect(await readFile(join(root, example.locator), "utf8")).toBe(example.bytes);
    }
  } finally {
    await product.dispose();
  }
}, 120_000);

test("public lifecycle alternatives remain complete records through the actual generation", async () => {
  const examples = await readExamples(join(process.cwd(), "skills/bearing"));
  for (const [owner, ordinal, collection, lifecycle] of lifecycleAlternatives) {
    const example = examples.filter((candidate) => candidate.owner === owner)[ordinal];
    if (example === undefined) throw new Error(`Missing ${owner} lifecycle example: ${lifecycle}`);
    const root = await mkdtemp(join(tmpdir(), "bearing-public-lifecycle-"));
    try {
      await writeExamples(root, firstPlanningExamples(examples));
      await writeExamples(root, [example]);
      await writeFixture(
        root,
        ".bearing/provider.json",
        JSON.stringify({
          schemaVersion: 1,
          provider: "matt-skills/v1",
          contractLocator: "docs/agents/issue-tracker.md",
        }),
      );
      await writeFixture(root, "docs/agents/issue-tracker.md", LOCAL_MATT_CONTRACT);
      await writeFixture(root, "docs/agents/triage-labels.md", LOCAL_MATT_TRIAGE_LABELS);
      await writeFixture(
        root,
        ".scratch/save-notes/PRD.md",
        "# Save and reopen notes\n\nStatus: ready-for-agent\n",
      );
      const compilation = await compileProjectGeneration(root, {
        providerObservationIntent: "all-scope-verification",
      });
      expect(compilation.diagnostics).toEqual([]);
      expect(compilation.decoded.records.every((record) => record.trust === "available")).toBe(
        true,
      );
      const generation = await buildSnapshotForProjectCompilation(
        root,
        packageMetadata.version,
        compilation,
      );
      expect(generation[collection]).toMatchObject({
        validity: "available",
        items: [{ lifecycle }],
      });
      expect(await readFile(join(root, example.locator), "utf8")).toBe(example.bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("public Brief, Asset Registry, and Authority examples join the same accepted planning set", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-public-owners-"));
  try {
    const examples = await readExamples(join(process.cwd(), "skills/bearing"));
    const additional = ["project-brief", "asset", "authority"].map((owner) => {
      const example = examples.find((candidate) => candidate.owner === owner);
      if (example === undefined) throw new Error(`Public owner example is missing: ${owner}`);
      return example;
    });
    await writeExamples(root, [...firstPlanningExamples(examples), ...additional]);
    const compilation = await compileProjectGeneration(root);
    expect(compilation.diagnostics).toEqual([]);
    expect(compilation.decoded.records).toHaveLength(8);
    const generation = await buildSnapshotForProjectCompilation(
      root,
      packageMetadata.version,
      compilation,
    );
    expect(generation.brief).toMatchObject({
      validity: "available",
      value: {
        id: "project-brief:current",
        establishedBaseline: ["Notes stay on the local computer."],
      },
    });
    expect(generation.assets).toMatchObject({
      validity: "available",
      items: [
        { id: "asset:format-research", disposition: "archived" },
        { id: "asset:note-format", disposition: "active", owner: "project-summary:current" },
        {
          id: "asset:note-format-draft",
          disposition: "superseded",
          supersededBy: "asset:note-format",
        },
      ],
    });
    expect(generation.authorities).toMatchObject({
      validity: "available",
      items: [{ id: "authority:note-format", baselineAssetIds: ["asset:note-format"] }],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
