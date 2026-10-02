import { expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { materializeLiveScenarioProductState } from "../scripts/live-scenario-product";
import { loadLiveScenarioRegistry } from "../scripts/live-scenario-registry";
import { installPackedProduct } from "./product-seams/installed-product";

test("Repository Update preparation follows the built package version in a Development runtime", async () => {
  const sourceRoot = join(import.meta.dirname, "..");
  const registry = await loadLiveScenarioRegistry(
    join(sourceRoot, "validation/live-journey/registry.json"),
  );
  const scenario = registry.scenarios.find(({ id }) => id === "update-repository-integration");
  if (scenario === undefined) throw new Error("Repository Update scenario is missing.");
  const packageMetadata = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
  const product = await installPackedProduct();
  try {
    const repositoryRoot = join(product.root, "repository");
    await mkdir(repositoryRoot);
    const initialized = Bun.spawnSync(["git", "init", "--quiet"], { cwd: repositoryRoot });
    expect(initialized.exitCode).toBe(0);
    await materializeLiveScenarioProductState({
      scenario,
      sourceRoot,
      repositoryRoot,
      productProgram: product.cliPath,
      agentHome: product.homeDir,
    });

    const manifest = JSON.parse(
      await readFile(join(repositoryRoot, ".bearing/manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      packageVersion: "0.1.1",
      runtime: "development",
      status: "active",
    });
    const inspected = Bun.spawnSync(
      [
        "node",
        join(repositoryRoot, "dist/cli.js"),
        "configure",
        "inspect",
        "--repo",
        repositoryRoot,
      ],
      { cwd: repositoryRoot, env: { ...process.env, HOME: product.homeDir } },
    );
    expect(inspected.exitCode).toBe(0);
    expect(JSON.parse(inspected.stdout.toString())).toMatchObject({
      lifecycle: {
        state: "repository-update-required",
        update: {
          source: { schemaVersion: 1, packageVersion: "0.1.1" },
          target: {
            manifest: {
              schemaVersion: 2,
              packageVersion: packageMetadata.version,
              runtime: "development",
            },
          },
        },
      },
    });
  } finally {
    await product.dispose();
  }
}, 30_000);
