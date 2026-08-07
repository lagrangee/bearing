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

    const inspected = await product.run(["inspect", "effort", "effort:e001", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(inspected.exitClass).toBe("success");
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      state: "complete",
      target: { kind: "effort", id: "effort:e001" },
    });

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
