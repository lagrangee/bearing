import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRepresentativeProject } from "./fixtures/representative-project";
import { installPackedProduct } from "./product-seams/installed-product";

const markV20Projection = async (path: string): Promise<void> => {
  const child = Bun.spawn(
    [
      "node",
      "--input-type=module",
      "--eval",
      `import { DatabaseSync } from "node:sqlite";
const database = new DatabaseSync(process.argv[1]);
database.prepare("UPDATE read_model_metadata SET projection_version = 8").run();
database.close();`,
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exitCode !== 0) throw new Error(stderr);
};

const attemptAgentOwnedBriefRefresh = async (
  product: Awaited<ReturnType<typeof installPackedProduct>>,
  root: string,
  candidate: string,
) => {
  const path = join(root, ".bearing/state/project-brief.md");
  const previous = await readFile(path, "utf8");
  await writeFile(path, candidate);
  const validation = await product.run(["inspect", "project-brief:current", "--repo", "."], {
    cwd: root,
    observeRoots: [root],
  });
  if (JSON.parse(validation.stdout).outcome !== "complete") await writeFile(path, previous);
  return validation;
};

test("packed product seam records public output, exit class, and filesystem effects", async () => {
  const product = await installPackedProduct();
  const fixture = await createRepresentativeProject("representative", product.root);

  try {
    await writeFile(
      join(fixture.root, ".bearing/state/project-brief.md"),
      `---
Type: project-brief
ID: project-brief:current
Generated at: 2026-08-09T13:00:00.000Z
Languages:
  At a Glance: en
  Current Position: en
  Established Baseline: en
---

# Project Brief

## At a Glance

Keep the project outcome and accepted decisions visible.

## Current Position

Roadmap 001 is active at Gate 001 under the representative delivery commitment.

## Established Baseline

- Canonical planning and native work retain separate owners.
- Portal reads the same typed project basis as Inspect.
`,
    );

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
      stdout: "0.1.1\n",
      stderr: "",
      effects: { created: [], changed: [], removed: [] },
    });

    const rebuilt = await product.run(["cache", "rebuild", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(rebuilt.exitClass).toBe("success");
    expect(rebuilt.effects.created).toContain("root-0/.bearing/cache/project-read-model.sqlite");
    const verified = await product.run(["provider", "verify", "--all", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(verified.exitClass).toBe("success");

    await markV20Projection(join(fixture.root, ".bearing/cache/project-read-model.sqlite"));

    const incompatible = await product.run(["inspect", "project", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(incompatible.exitClass).toBe("product-outcome");
    expect(JSON.parse(incompatible.stdout)).toMatchObject({
      outcome: "recovery-required",
    });
    expect(incompatible.effects).toEqual({ created: [], changed: [], removed: [] });

    const cutoverRebuild = await product.run(["cache", "rebuild", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(cutoverRebuild.exitClass).toBe("success");
    expect(cutoverRebuild.effects.changed).toContain(
      "root-0/.bearing/cache/project-read-model.sqlite",
    );

    const inspected = await product.run(["inspect", "project", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(inspected.exitClass).toBe("success");
    const projectEnvelope = JSON.parse(inspected.stdout);
    expect(projectEnvelope).toMatchObject({
      schemaVersion: 1,
      command: "inspect",
      outcome: "partial",
      request: { kind: "project" },
      generation: { publicationCount: expect.any(Number) },
      result: {
        basis: { publicationCount: expect.any(Number) },
        summary: { value: { id: "project-summary:current" } },
        brief: {
          value: {
            id: "project-brief:current",
            atAGlance: "Keep the project outcome and accepted decisions visible.",
            currentPosition:
              "Roadmap 001 is active at Gate 001 under the representative delivery commitment.",
            establishedBaseline: [
              "Canonical planning and native work retain separate owners.",
              "Portal reads the same typed project basis as Inspect.",
            ],
          },
        },
        diagnosticCounts: { blocking: 9, nonBlocking: 0 },
      },
    });
    expect(projectEnvelope.result.brief.value).not.toHaveProperty("projectPurpose");
    expect(projectEnvelope.result.brief.value).not.toHaveProperty("currentStage");
    expect(projectEnvelope.result.brief.value).not.toHaveProperty("materialAchievedState");
    expect(projectEnvelope.result.roadmapFocus).toBeArray();
    expect(projectEnvelope.result.scopeOutline).toContainEqual(
      expect.objectContaining({ effortId: "effort:e001" }),
    );
    expect(projectEnvelope.result.attentionCount).toBeNumber();
    expect(projectEnvelope.result.sources).toBeArray();
    expect(projectEnvelope.result.deeperReads).toContain("effort:e001");
    expect(inspected.effects).toEqual({ created: [], changed: [], removed: [] });

    const repeated = await product.run(["inspect", "project", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(repeated.exitClass).toBe("success");
    expect(repeated.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.parse(repeated.stdout)).toEqual(projectEnvelope);

    const briefPath = join(fixture.root, ".bearing/state/project-brief.md");
    const acceptedBrief = await readFile(briefPath, "utf8");
    const rejectedBriefRefresh = await attemptAgentOwnedBriefRefresh(
      product,
      fixture.root,
      acceptedBrief.replace("2026-08-09T13:00:00.000Z", "2026-08-09T14:00:00.000Z").replace(
        "- Portal reads the same typed project basis as Inspect.",
        `- Portal reads the same typed project basis as Inspect.
- First forbidden extra baseline fact.
- Second forbidden extra baseline fact.
- Third forbidden extra baseline fact.
- Fourth forbidden extra baseline fact.`,
      ),
    );
    expect(rejectedBriefRefresh.exitClass).toBe("product-outcome");
    expect(JSON.parse(rejectedBriefRefresh.stdout)).toMatchObject({
      outcome: "unfulfilled",
      request: { kind: "planning-reference", reference: "project-brief:current" },
    });
    expect(await readFile(briefPath, "utf8")).toBe(acceptedBrief);

    const afterRejectedRefresh = await product.run(
      ["inspect", "project-brief:current", "--repo", "."],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(afterRejectedRefresh.exitClass).toBe("success");
    expect(JSON.parse(afterRejectedRefresh.stdout)).toMatchObject({
      outcome: "complete",
      result: {
        target: {
          kind: "project-brief",
          value: projectEnvelope.result.brief.value,
        },
      },
    });

    const diagnostics = await product.run(["inspect", "diagnostics", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(diagnostics.exitClass).toBe("success");
    expect(JSON.parse(diagnostics.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "inspect",
      outcome: "partial",
      request: { kind: "diagnostics" },
      result: expect.arrayContaining([
        expect.objectContaining({
          code: "provider-observation-unavailable",
          impact: "blocking",
        }),
      ]),
    });
    expect(JSON.parse(diagnostics.stdout).result).toHaveLength(9);

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
