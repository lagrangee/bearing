import { expect, test } from "bun:test";
import { createBenchmarkFixture } from "../scripts/sync-benchmark-lib";
import { installPackedProduct } from "./product-seams/installed-product";

test("packed product seam records public output, exit class, and filesystem effects", async () => {
  const product = await installPackedProduct();
  const fixture = await createBenchmarkFixture("representative", product.root);

  try {
    expect(product.candidate.identity).toBe(
      product.candidate.sourceState === "clean"
        ? `git:${product.candidate.headCommit}`
        : `sha256:${product.candidate.packageSha256}`,
    );

    const version = await product.run(["--version"], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(version).toMatchObject({
      exitClass: "success",
      exitCode: 0,
      stdout: "0.1.0\n",
      stderr: "",
      effects: { created: [], changed: [], removed: [] },
    });

    const synced = await product.run(
      ["sync", "--repo", ".", "--initialize-provider-observations"],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(synced.exitClass).toBe("success");
    expect(synced.effects.created.length).toBeGreaterThan(0);

    const inspected = await product.run(["inspect", "project", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(inspected.exitClass).toBe("success");
    const projectEnvelope = JSON.parse(inspected.stdout);
    expect(projectEnvelope).toMatchObject({
      schemaVersion: 1,
      command: "inspect",
      outcome: "complete",
      request: { kind: "project" },
      generation: { publicationCount: 1 },
      result: {
        basis: { publicationCount: 1 },
        summary: { value: { id: "project-summary:current" } },
        diagnosticCounts: { blocking: 0, nonBlocking: 0 },
      },
    });
    expect(projectEnvelope.result.roadmapFocus).toBeArray();
    expect(projectEnvelope.result.scopeOutline).toContainEqual(
      expect.objectContaining({ effortId: "effort:e001" }),
    );
    expect(projectEnvelope.result.attentionCount).toBeNumber();
    expect(projectEnvelope.result.sources).toBeArray();
    expect(projectEnvelope.result.deeperReads).toContain("effort:e001");
    expect(inspected.effects.created).toContain("root-0/.bearing/cache/project-read-model.sqlite");

    const repeated = await product.run(["inspect", "project", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(repeated.exitClass).toBe("success");
    expect(repeated.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.parse(repeated.stdout)).toMatchObject({
      outcome: "complete",
      generation: { publicationCount: 1 },
    });

    const diagnostics = await product.run(["inspect", "diagnostics", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(diagnostics.exitClass).toBe("success");
    expect(JSON.parse(diagnostics.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "inspect",
      outcome: "complete",
      request: { kind: "diagnostics" },
      result: [],
    });

    const planning = await product.run(["inspect", "effort:e001", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(planning.exitClass).toBe("success");
    expect(JSON.parse(planning.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "inspect",
      outcome: "complete",
      request: { kind: "planning-reference", reference: "effort:e001" },
      result: {
        target: { kind: "effort", value: { id: "effort:e001" } },
        directRelations: expect.any(Array),
        coverage: { state: "available" },
        diagnostics: [],
        revision: { generationFingerprint: expect.stringMatching(/^sha256:/) },
      },
    });

    const summary = await product.run(["inspect", "project-summary:current", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(summary.exitClass).toBe("success");
    expect(JSON.parse(summary.stdout)).toMatchObject({
      outcome: "complete",
      result: {
        target: {
          kind: "project-summary",
          value: { id: "project-summary:current" },
        },
      },
    });

    const missing = await product.run(["inspect", "effort:missing", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(missing.exitClass).toBe("product-outcome");
    expect(missing.stderr).toBe("");
    expect(JSON.parse(missing.stdout)).toMatchObject({
      outcome: "unfulfilled",
      request: { kind: "planning-reference", reference: "effort:missing" },
    });

    const invalid = await product.run(["inspect", "project", "extra", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(invalid.exitClass).toBe("usage-error");

    const invalidOption = await product.run(["inspect", "project", "--unknown"], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(invalidOption.exitClass).toBe("usage-error");

    const rejected = await product.run(["private-token"], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(rejected.exitClass).toBe("product-outcome");
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toBe("Unknown command. Run bearing --help.\n");
    expect(rejected.stderr).not.toContain("private-token");
    expect(rejected.effects).toEqual({ created: [], changed: [], removed: [] });
  } finally {
    await product.dispose();
  }
}, 60_000);
