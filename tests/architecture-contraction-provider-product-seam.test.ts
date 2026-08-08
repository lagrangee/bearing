import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { createRepresentativeProject } from "./fixtures/representative-project";
import { installPackedProduct } from "./product-seams/installed-product";

test("packed product exposes explicit provider cost classes and native typed readback", async () => {
  const product = await installPackedProduct();
  const fixture = await createRepresentativeProject("representative", product.root);
  try {
    const rebuilt = await product.run(["cache", "rebuild", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(rebuilt.exitClass).toBe("success");
    expect(JSON.parse(rebuilt.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "cache-rebuild",
      outcome: "complete",
      result: { acquisitionCount: 0 },
    });
    expect(JSON.parse(rebuilt.stdout).result.missingEvidenceScopes).toHaveLength(9);
    expect(rebuilt.effects.created).toContain("root-0/.bearing/cache/project-read-model.sqlite");
    expect(rebuilt.effects.created).not.toContain(
      "root-0/.bearing/cache/provider-observations.json",
    );
    expect(rebuilt.effects.created).not.toContain(
      "root-0/.bearing/cache/provider-detail-selections.json",
    );

    const captured = await product.run(
      ["provider", "capture", "--scope", ".scratch/scope-001", "--repo", "."],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(captured.exitClass).toBe("success");
    expect(JSON.parse(captured.stdout)).toMatchObject({
      command: "provider-capture",
      outcome: "complete",
      result: {
        acquisitionCount: 1,
        scopes: [{ scope: ".scratch/scope-001", disposition: "captured" }],
      },
    });
    expect(captured.effects.created).not.toContain(
      "root-0/.bearing/cache/provider-observations.json",
    );

    const native = await product.run(
      ["inspect", "--native", fixture.nativeLocator, "--repo", "."],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(native.exitClass).toBe("success");
    expect(native.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.parse(native.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "inspect",
      outcome: "complete",
      request: { kind: "native-reference", reference: fixture.nativeLocator },
      result: {
        binding: {
          state: "bound",
          nativeScope: ".scratch/scope-001",
          planningReferences: ["effort:e001"],
        },
      },
    });
    const unbound = await product.run(
      ["inspect", "--native", ".scratch/unbound/issues/01.md", "--repo", "."],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(unbound.exitClass).toBe("success");
    expect(unbound.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.parse(unbound.stdout)).toMatchObject({
      outcome: "complete",
      result: {
        reference: ".scratch/unbound/issues/01.md",
        binding: { state: "unbound" },
        coverage: { state: "unavailable" },
      },
    });

    const nativePath = `${fixture.root}/${fixture.nativeLocator}`;
    await writeFile(
      nativePath,
      (await readFile(nativePath, "utf8")).replace("Status: resolved", "Status: claimed"),
    );
    const reconciled = await product.run(
      [
        "reconcile-native",
        "--scope",
        ".scratch/scope-001",
        "--ref",
        fixture.nativeLocator,
        "--repo",
        ".",
      ],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(reconciled.exitClass).toBe("success");
    expect(JSON.parse(reconciled.stdout)).toMatchObject({
      command: "reconcile-native",
      outcome: "complete",
      result: {
        acquisitionCount: 1,
        dispositions: [{ reference: fixture.nativeLocator, disposition: "read" }],
        readback: [
          {
            nativeReference: fixture.nativeLocator,
            entity: { kind: "wayfinder-ticket", claim: { state: "claimed" } },
          },
        ],
      },
    });

    const verified = await product.run(["provider", "verify", "--all", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(verified.exitClass).toBe("success");
    expect(JSON.parse(verified.stdout)).toMatchObject({
      command: "provider-verify",
      outcome: "complete",
      result: { acquisitionCount: 9, missingEvidenceScopes: [] },
    });

    const invalid = await product.run(["provider", "verify", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(invalid.exitClass).toBe("usage-error");
    expect(invalid.effects).toEqual({ created: [], changed: [], removed: [] });
    const invalidNative = await product.run(["inspect", "--native", "", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(invalidNative.exitClass).toBe("usage-error");
    expect(invalidNative.effects).toEqual({ created: [], changed: [], removed: [] });
    const unavailableScope = await product.run(
      ["provider", "capture", "--scope", ".scratch/not-bound", "--repo", "."],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(unavailableScope.exitClass).toBe("product-outcome");
    expect(unavailableScope.stderr).toBe("");
    expect(unavailableScope.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.parse(unavailableScope.stdout)).toMatchObject({
      command: "provider-capture",
      outcome: "unfulfilled",
      result: { acquisitionCount: 0 },
    });
  } finally {
    await product.dispose();
  }
}, 60_000);
