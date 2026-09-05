import { expect, test } from "bun:test";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createValidBearingRepo } from "./helpers";
import { installPackedProduct } from "./product-seams/installed-product";

const runtimeTargets = async (unavailable: "cwd" | "target") => {
  const product = await installPackedProduct();
  const cwd = await createValidBearingRepo();
  const target = await createValidBearingRepo();
  const manifestPath = join(unavailable === "cwd" ? cwd : target, ".bearing/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, runtime: "development" })}\n`);
  return {
    product,
    cwd,
    target,
    dispose: () =>
      Promise.all([
        product.dispose(),
        rm(cwd, { recursive: true, force: true }),
        rm(target, { recursive: true, force: true }),
      ]),
  };
};

const repositoryOptions = (cwd: string, target: string): readonly (readonly string[])[] => [
  ["--repo", target],
  [`--repo=${target}`],
  ["--repo", cwd, `--repo=${target}`],
  [`--repo=${cwd}`, "--repo", target],
  ["--repo", cwd, "--repo", target],
];

test("CLI checks the selected target Runtime when only cwd has an available Runtime", async () => {
  const fixture = await runtimeTargets("target");
  const { product, cwd, target } = fixture;
  try {
    for (const command of [
      ["configure", "inspect"],
      ["cache", "rebuild"],
    ]) {
      for (const args of repositoryOptions(cwd, target)) {
        const result = await product.run([...command, ...args], {
          cwd,
          observeRoots: [cwd, target, product.homeDir],
        });
        expect(result.exitClass, `${command.join(" ")} ${args.join(" ")}`).toBe("product-outcome");
        expect(JSON.parse(result.stdout)).toMatchObject({
          outcome: "unfulfilled",
          diagnostics: [{ code: "development-runtime-binding-missing" }],
        });
        expect(result.effects).toEqual({ created: [], changed: [], removed: [] });
      }
    }
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test("CLI executes in the selected target when only its Runtime is available", async () => {
  const fixture = await runtimeTargets("cwd");
  const { product, cwd, target } = fixture;
  try {
    for (const args of repositoryOptions(cwd, target)) {
      await rm(join(target, ".bearing/cache"), { recursive: true, force: true });
      const result = await product.run(["cache", "rebuild", ...args], {
        cwd,
        observeRoots: [cwd, target, product.homeDir],
      });
      expect(result.exitClass, `${result.stderr}\n${result.stdout}`).toBe("success");
      expect(JSON.parse(result.stdout)).toMatchObject({
        command: "cache-rebuild",
        outcome: "complete",
        result: { acquisitionCount: 0 },
      });
      expect([...result.effects.created, ...result.effects.changed]).toContain(
        "root-1/.bearing/cache/project-read-model.sqlite",
      );
      expect([
        ...result.effects.created,
        ...result.effects.changed,
        ...result.effects.removed,
      ]).not.toContainEqual(expect.stringMatching(/^root-[02]\//u));
    }
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test("CLI rejects missing and ambiguous repository values before Runtime admission or writes", async () => {
  const fixture = await runtimeTargets("cwd");
  const { product, cwd, target } = fixture;
  try {
    for (const command of [
      ["cache", "rebuild"],
      ["inspect", "project"],
      ["provider", "verify", "--all"],
      ["reconcile-native", "--scope", ".scratch/work", "--ref", ".scratch/work/map.md"],
      ["configure", "inspect"],
    ]) {
      for (const args of [
        ["--repo"],
        [`--repo=${target}`, "--repo"],
        ["--repo", "--unrelated-option"],
        [`--repo=${target}`, "--repo", "--unrelated-option"],
        ["--repo", "--"],
      ]) {
        const result = await product.run([...command, ...args], {
          cwd,
          observeRoots: [cwd, target, product.homeDir],
        });
        expect(result.exitClass, `${command.join(" ")} ${args.join(" ")}`).toBe(
          command[0] === "configure" ? "product-outcome" : "usage-error",
        );
        expect(result.stderr).not.toBe("");
        expect(result.stdout).toBe("");
        expect(result.effects).toEqual({ created: [], changed: [], removed: [] });
      }
    }
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test("CLI preserves empty equals-form values and leaves terminated arguments to the handler", async () => {
  const fixture = await runtimeTargets("target");
  const { product, cwd, target } = fixture;
  try {
    for (const args of [["--repo="], ["--repo", target, "--repo="]]) {
      const result = await product.run(["configure", "inspect", ...args], {
        cwd,
        observeRoots: [cwd, target, product.homeDir],
      });
      expect(result.exitClass, result.stderr).toBe("success");
      expect(JSON.parse(result.stdout)).toMatchObject({
        command: "configure-inspect",
        currentSelections: { runtime: "stable" },
      });
      expect(result.effects).toEqual({ created: [], changed: [], removed: [] });
    }
    for (const args of [
      ["--", "--repo", target],
      ["--repo", cwd, "--", `--repo=${target}`],
    ]) {
      const result = await product.run(["configure", "inspect", ...args], {
        cwd,
        observeRoots: [cwd, target, product.homeDir],
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unexpected argument");
      expect(result.stdout).toBe("");
      expect(result.effects).toEqual({ created: [], changed: [], removed: [] });
    }
    const validTerminator = await product.run(["inspect", "--repo=", "--", "project"], {
      cwd,
      observeRoots: [target, product.homeDir],
    });
    expect(validTerminator.exitClass, validTerminator.stderr).toBe("success");
    expect(JSON.parse(validTerminator.stdout)).toMatchObject({ request: { kind: "project" } });
    expect(validTerminator.effects).toEqual({ created: [], changed: [], removed: [] });
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test("CLI accepts an option-looking inline path and executes in that repository", async () => {
  const fixture = await runtimeTargets("cwd");
  const { product, cwd } = fixture;
  const target = join(cwd, "--target");
  await rename(fixture.target, target);
  try {
    const result = await product.run(["cache", "rebuild", "--repo=--target"], {
      cwd,
      observeRoots: [target, product.homeDir],
    });
    expect(result.exitClass, `${result.stderr}\n${result.stdout}`).toBe("success");
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "cache-rebuild",
      outcome: "complete",
    });
    expect(result.effects.created).toContain("root-0/.bearing/cache/project-read-model.sqlite");
    expect([
      ...result.effects.created,
      ...result.effects.changed,
      ...result.effects.removed,
    ]).not.toContainEqual(expect.stringMatching(/^root-1\//u));
  } finally {
    await fixture.dispose();
  }
}, 60_000);
