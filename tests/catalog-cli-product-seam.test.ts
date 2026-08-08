import { expect, test } from "bun:test";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_MATT_CONTRACT, LOCAL_MATT_TRIAGE_LABELS } from "./fixtures/local-matt-contract";
import { installPackedProduct } from "./product-seams/installed-product";

const makeFreshRepository = async (root: string): Promise<void> => {
  await mkdir(join(root, "docs/agents"), { recursive: true });
  await writeFile(join(root, "docs/agents/issue-tracker.md"), LOCAL_MATT_CONTRACT);
  await writeFile(join(root, "docs/agents/triage-labels.md"), LOCAL_MATT_TRIAGE_LABELS);
  await writeFile(
    join(root, "AGENTS.md"),
    "## Agent skills\n\n### Issue tracker\n\nIssues use the repository tracker. See `docs/agents/issue-tracker.md`.\n",
  );
};

const makeAvailableLocator = async (root: string): Promise<void> => {
  await mkdir(join(root, ".bearing"), { recursive: true });
  await writeFile(
    join(root, ".bearing/manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: "0.1.0",
      status: "active",
      surfaces: ["agent-skills"],
      executorProfiles: [],
    })}\n`,
  );
};

test("packed Catalog CLI exposes five exact lifecycle operations with truthful locator effects", async () => {
  const product = await installPackedProduct();
  const firstRoot = join(product.root, "first-repository");
  const secondRoot = join(product.root, "second-repository");
  await Promise.all([makeFreshRepository(firstRoot), makeFreshRepository(secondRoot)]);
  await makeAvailableLocator(secondRoot);
  const [canonicalFirstRoot, canonicalSecondRoot] = await Promise.all([
    realpath(firstRoot),
    realpath(secondRoot),
  ]);

  try {
    const help = await product.run(["catalog", "--help"]);
    expect(help.exitClass).toBe("success");
    expect(help.stdout).toContain("catalog inspect");
    expect(help.stdout).toContain("catalog rename");
    expect(help.stdout).toContain("catalog unregister");
    expect(help.stdout).toContain("catalog relink");
    expect(help.stdout).toContain("catalog reset");
    expect(help.stdout).not.toMatch(/catalog (?:forget|remove)\b/u);
    expect(help.stdout).not.toContain("--confirm-move");

    const setup = await product.run([
      "setup",
      "--repo",
      firstRoot,
      "--surface",
      "agent-skills",
      "--provider-contract",
      "docs/agents/issue-tracker.md",
    ]);
    expect(setup.exitClass).toBe("success");

    const inspected = await product.run(["catalog", "inspect", "--repo", firstRoot], {
      observeRoots: [product.homeDir, firstRoot, secondRoot],
    });
    expect(inspected.exitClass).toBe("success");
    expect(inspected.stderr).toBe("");
    expect(inspected.stdout).toContain("Outcome: ready");
    expect(inspected.stdout).toContain(`Repository: ${canonicalFirstRoot}`);
    expect(inspected.stdout).toContain("Availability: available");
    expect(inspected.effects).toEqual({ created: [], changed: [], removed: [] });
    const entryId = inspected.stdout.match(/^Entry: (.+)$/mu)?.[1];
    if (entryId === undefined) throw new Error("Catalog inspect did not return an Entry ID.");

    const renamed = await product.run([
      "catalog",
      "rename",
      "--entry",
      entryId,
      "--name",
      "Renamed project",
    ]);
    expect(renamed.exitClass).toBe("success");
    expect(renamed.stdout).toContain("Display name: Renamed project");
    const inspectedByEntry = await product.run(["catalog", "inspect", "--entry", entryId]);
    expect(inspectedByEntry.exitClass).toBe("success");
    expect(inspectedByEntry.stdout).toContain("Display name: Renamed project");

    const missingEntry = await product.run(["catalog", "inspect", "--entry", "missing-entry"], {
      observeRoots: [product.homeDir, firstRoot, secondRoot],
    });
    expect(missingEntry.exitClass).toBe("product-outcome");
    expect(missingEntry.stderr).toContain("Project Catalog entry does not exist");
    expect(missingEntry.effects).toEqual({ created: [], changed: [], removed: [] });

    const ambiguous = await product.run(
      ["catalog", "unregister", "--entry", entryId, "--repo", firstRoot],
      { observeRoots: [product.homeDir, firstRoot, secondRoot] },
    );
    expect(ambiguous.exitClass).toBe("usage-error");
    expect(ambiguous.effects).toEqual({ created: [], changed: [], removed: [] });

    const unconfirmed = await product.run(
      ["catalog", "relink", "--entry", entryId, "--repo", secondRoot],
      { observeRoots: [product.homeDir, firstRoot, secondRoot] },
    );
    expect(unconfirmed.exitClass).toBe("product-outcome");
    expect(unconfirmed.stderr).toMatch(/locator is still available.*replacement confirmation/iu);
    expect(unconfirmed.stderr).not.toMatch(/mov(?:e|ing)|files?/iu);
    expect(unconfirmed.effects).toEqual({ created: [], changed: [], removed: [] });

    const relinked = await product.run(
      ["catalog", "relink", "--entry", entryId, "--repo", secondRoot, "--confirm-replace-location"],
      { observeRoots: [firstRoot, secondRoot] },
    );
    expect(relinked.exitClass).toBe("success");
    expect(relinked.stdout).toContain(`Repository: ${canonicalSecondRoot}`);
    expect(relinked.stdout).not.toMatch(/mov(?:e|ing)|files?/iu);
    expect(relinked.effects).toEqual({ created: [], changed: [], removed: [] });

    const unregistered = await product.run(["catalog", "unregister", "--repo", secondRoot]);
    expect(unregistered.exitClass).toBe("success");
    expect(unregistered.stdout).toContain("Outcome: applied");
    const missing = await product.run(["catalog", "unregister", "--repo", secondRoot]);
    expect(missing.exitClass).toBe("success");
    expect(missing.stdout).toBe("Outcome: no-op\n");

    for (const retired of ["forget", "remove"]) {
      const rejected = await product.run(["catalog", retired, "--entry", entryId], {
        observeRoots: [product.homeDir],
      });
      expect(rejected.exitClass).toBe("usage-error");
      expect(rejected.effects).toEqual({ created: [], changed: [], removed: [] });
    }

    const unconfirmedReset = await product.run(["catalog", "reset"], {
      observeRoots: [product.homeDir],
    });
    expect(unconfirmedReset.exitClass).toBe("usage-error");
    expect(unconfirmedReset.effects).toEqual({ created: [], changed: [], removed: [] });
    const reset = await product.run(["catalog", "reset", "--confirm-empty"]);
    expect(reset.exitClass).toBe("success");
    expect(reset.stdout).toBe("Outcome: applied\n");
  } finally {
    await product.dispose();
  }
}, 60_000);
