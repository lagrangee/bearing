import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
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
          targetedReconciliationBasis: { state: "ready" },
          planningReferences: ["effort:e001"],
        },
      },
    });
    const absoluteNative = await product.run(
      ["inspect", "--native", `${fixture.root}/${fixture.nativeLocator}`, "--repo", "."],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(absoluteNative.exitClass).toBe("success");
    expect(absoluteNative.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.parse(absoluteNative.stdout)).toMatchObject({
      request: { kind: "native-reference", reference: fixture.nativeLocator },
      result: { reference: fixture.nativeLocator, binding: { state: "bound" } },
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
    const rejected = await product.run(
      [
        "reconcile-native",
        "--scope",
        ".scratch/scope-001",
        "--ref",
        ".scratch/outside-scope/issues/01.md",
        "--repo",
        ".",
      ],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(rejected.exitClass).toBe("product-outcome");
    expect(rejected.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.parse(rejected.stdout)).toMatchObject({
      command: "reconcile-native",
      outcome: "unfulfilled",
      result: { acquisitionCount: 0 },
      diagnostics: [{ code: "native-reconciliation-reference-outside-scope" }],
    });

    const reconciled = await product.run(
      [
        "reconcile-native",
        "--scope",
        ".scratch/scope-001",
        "--ref",
        `${fixture.root}/.scratch/scope-001/map.md`,
        "--ref",
        nativePath,
        "--repo",
        ".",
      ],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(reconciled.exitClass).toBe("success");
    const reconciliationReceipt = JSON.parse(reconciled.stdout);
    expect(reconciliationReceipt.request).toEqual({
      schemaVersion: 2,
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
      subjects: [fixture.nativeLocator, ".scratch/scope-001/map.md"],
    });
    expect(reconciliationReceipt).toMatchObject({
      command: "reconcile-native",
      outcome: "complete",
      result: {
        acquisitionCount: 1,
        dispositions: [
          { reference: fixture.nativeLocator, disposition: "read" },
          { reference: ".scratch/scope-001/map.md", disposition: "read" },
        ],
        relationDispositions: [
          {
            relation: {
              kind: "parent-child",
              source: ".scratch/scope-001/map.md",
              target: fixture.nativeLocator,
            },
            disposition: "read",
          },
        ],
      },
    });
    expect(reconciliationReceipt.result.readback).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nativeReference: fixture.nativeLocator,
          entity: expect.objectContaining({
            kind: "wayfinder-ticket",
            claim: { state: "claimed" },
          }),
        }),
      ]),
    );

    const callerAssertedRelation = await product.run(
      [
        "reconcile-native",
        "--scope",
        ".scratch/scope-001",
        "--ref",
        fixture.nativeLocator,
        "--relation",
        JSON.stringify({
          kind: "parent-child",
          source: fixture.nativeLocator,
          target: ".scratch/scope-001/map.md",
        }),
        "--repo",
        ".",
      ],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(callerAssertedRelation.exitClass).toBe("usage-error");

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

    for (const args of [
      ["git", "init", "-q"],
      ["git", "config", "user.name", "Provider Fixture"],
      ["git", "config", "user.email", "provider@example.invalid"],
      ["git", "add", "-A"],
      ["git", "commit", "-qm", "fixture: provider basis"],
    ]) {
      expect(await Bun.spawn(args, { cwd: fixture.root }).exited).toBe(0);
    }
    const summaryPath = `${fixture.root}/${fixture.summaryLocator}`;
    await writeFile(
      summaryPath,
      (await readFile(summaryPath, "utf8")).replace(
        "variant A",
        "variant B after an exact changed-basis publication",
      ),
    );
    const changedBasis = await product.run(["inspect", "project", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(changedBasis.exitClass).toBe("success");
    const reopened = await product.run(["inspect", "diagnostics", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(reopened.exitClass).toBe("success");
    expect(JSON.parse(reopened.stdout)).toMatchObject({ outcome: "complete", diagnostics: [] });

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

test("native inspect exposes capture-required after a failed targeted reconciliation", async () => {
  const product = await installPackedProduct();
  const fixture = await createRepresentativeProject("representative", product.root);
  const contractPath = `${fixture.root}/docs/agents/issue-tracker.md`;
  const contract = await readFile(contractPath);
  try {
    expect(
      (
        await product.run(["cache", "rebuild", "--repo", "."], {
          cwd: fixture.root,
          observeRoots: [fixture.root],
        })
      ).exitClass,
    ).toBe("success");
    expect(
      (
        await product.run(["provider", "capture", "--scope", ".scratch/scope-001", "--repo", "."], {
          cwd: fixture.root,
          observeRoots: [fixture.root],
        })
      ).exitClass,
    ).toBe("success");

    await rm(contractPath);
    const failed = await product.run(
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
    expect(failed.exitClass).toBe("product-outcome");
    await writeFile(contractPath, contract);

    const inspected = await product.run(
      ["inspect", "--native", fixture.nativeLocator, "--repo", "."],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(inspected.exitClass).toBe("success");
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      result: {
        binding: {
          state: "bound",
          effectiveFreshness: "current",
          targetedReconciliationBasis: {
            state: "capture-required",
            reason: "latest-attempt-failed",
          },
        },
      },
    });
  } finally {
    await product.dispose();
  }
}, 60_000);
