import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readCatalogDocument, upsertCatalogEntry } from "../src/catalog/store";
import { applyRepositoryConfigurationUnit } from "../src/repository-configuration-apply";
import { deactivateRepository } from "../src/repository-deactivation";
import {
  LOCAL_MATT_CONTRACT,
  LOCAL_MATT_TRIAGE_LABELS,
} from "../tests/fixtures/local-matt-contract";

const seedRepository = async (repoRoot: string): Promise<void> => {
  const contractLocator = "docs/agents/issue-tracker.md";
  await mkdir(join(repoRoot, "docs", "agents"), { recursive: true });
  await writeFile(join(repoRoot, contractLocator), LOCAL_MATT_CONTRACT);
  await writeFile(join(repoRoot, "docs/agents/triage-labels.md"), LOCAL_MATT_TRIAGE_LABELS);
  await writeFile(
    join(repoRoot, "AGENTS.md"),
    `# User rules\n\n## Agent skills\n\n### Issue tracker\n\nIssues use the repository tracker. See \`${contractLocator}\`.\n`,
  );
  await writeFile(join(repoRoot, "source.txt"), "source stays\n");
  await applyRepositoryConfigurationUnit({
    repoRoot,
    packageRoot: process.cwd(),
    surfaces: ["agent-skills"],
    profiles: [],
    provider: { key: "matt-skills/v1", contractLocator },
  });
  await mkdir(join(repoRoot, ".scratch/work/evidence"), { recursive: true });
  await writeFile(join(repoRoot, ".scratch/work/effort.md"), "# Effort\n");
  await writeFile(join(repoRoot, ".scratch/work/evidence/result.md"), "durable\n");
};

test("deactivate preserves repository truth and reports applied then no-op Catalog cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-node-deactivate-"));
  const homeDir = join(root, "home");
  const repoRoot = join(root, "repo");
  await mkdir(repoRoot);
  try {
    await seedRepository(repoRoot);
    await writeFile(join(repoRoot, ".bearing/state/accepted.md"), "accepted truth\n");
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "deactivate-project" });

    const result = await deactivateRepository({ homeDir, repoRoot });
    assert.equal(result.outcome, "applied");
    assert.equal((await readCatalogDocument({ homeDir })).entries.length, 0);
    assert.equal(
      await readFile(join(repoRoot, ".bearing/state/accepted.md"), "utf8"),
      "accepted truth\n",
    );
    assert.equal(
      await readFile(join(repoRoot, ".scratch/work/evidence/result.md"), "utf8"),
      "durable\n",
    );

    const replay = await deactivateRepository({ homeDir, repoRoot });
    assert.equal(replay.outcome, "no-op");
    assert.equal(replay.repository.outcome, "no-op");
    assert.equal(replay.catalog.outcome, "no-op");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
