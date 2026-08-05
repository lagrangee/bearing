import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { forgetCatalogEntry, readCatalogDocument, upsertCatalogEntry } from "../src/catalog/store";
import {
  deactivateRepository,
  inspectPurgePlan,
  type PurgeTransactionHooks,
  purgeRepository,
} from "../src/repo-lifecycle";
import { setupRepository } from "../src/repo-setup";
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
  await setupRepository({
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

const confirmedPurge = async (
  homeDir: string,
  repoRoot: string,
  hooks: PurgeTransactionHooks = {},
) => {
  const plan = await inspectPurgePlan({ homeDir, repoRoot });
  return purgeRepository(
    {
      homeDir,
      repoRoot,
      confirmed: true,
      planToken: plan.confirmationToken,
      acceptNoRecoveryExport: true,
    },
    hooks,
  );
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

test("purge requires confirmation and preserves durable repository content", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-node-purge-"));
  const homeDir = join(root, "home");
  const repoRoot = join(root, "repo");
  await mkdir(repoRoot);
  try {
    await seedRepository(repoRoot);
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "purge-project" });
    await assert.rejects(
      purgeRepository({ homeDir, repoRoot, confirmed: false }),
      /requires --confirm-purge/u,
    );

    const result = await confirmedPurge(homeDir, repoRoot);
    assert.equal(result.outcome, "applied");
    await assert.rejects(access(join(repoRoot, ".bearing")));
    assert.equal(
      await readFile(join(repoRoot, ".scratch/work/evidence/result.md"), "utf8"),
      "durable\n",
    );
    assert.equal(await readFile(join(repoRoot, "source.txt"), "utf8"), "source stays\n");
    assert.equal((await readCatalogDocument({ homeDir })).entries.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("purge preserves a reviewed Catalog identity when a new repository generation appears", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-node-purge-generation-"));
  const homeDir = join(root, "home");
  const repoRoot = join(root, "repo");
  await mkdir(repoRoot);
  try {
    await seedRepository(repoRoot);
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "purge-recreated" });
    const result = await confirmedPurge(homeDir, repoRoot, {
      removeQuarantine: async (target) => {
        await rm(target, { recursive: true });
        await mkdir(join(repoRoot, ".bearing"));
        await writeFile(join(repoRoot, ".bearing/new-generation.txt"), "new\n");
      },
    });

    assert.equal(result.outcome, "partial");
    assert.equal(result.catalog.outcome, "failed");
    assert.match(
      result.catalog.outcome === "failed" ? result.catalog.message : "",
      /new `.bearing` generation/u,
    );
    assert.equal((await readCatalogDocument({ homeDir })).entries[0]?.entryId, "purge-recreated");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("purge preserves changed or newly-created Catalog identity after review", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-node-purge-identity-"));
  const homeDir = join(root, "home");
  const changedRoot = join(root, "changed");
  const lateRoot = join(root, "late");
  await Promise.all([mkdir(changedRoot), mkdir(lateRoot)]);
  try {
    await seedRepository(changedRoot);
    await upsertCatalogEntry({
      homeDir,
      repoRoot: changedRoot,
      createEntryId: () => "reviewed-entry",
    });
    const changed = await confirmedPurge(homeDir, changedRoot, {
      beforeNamespaceRename: async () => {
        await forgetCatalogEntry({ homeDir, entryId: "reviewed-entry" });
        await upsertCatalogEntry({
          homeDir,
          repoRoot: changedRoot,
          createEntryId: () => "replacement-entry",
        });
      },
    });
    assert.equal(changed.outcome, "partial");
    assert.match(
      changed.catalog.outcome === "failed" ? changed.catalog.message : "",
      /identity changed/u,
    );
    assert.equal((await readCatalogDocument({ homeDir })).entries[0]?.entryId, "replacement-entry");

    await seedRepository(lateRoot);
    const late = await confirmedPurge(homeDir, lateRoot, {
      beforeNamespaceRename: async () => {
        await upsertCatalogEntry({
          homeDir,
          repoRoot: lateRoot,
          createEntryId: () => "late-entry",
        });
      },
    });
    assert.equal(late.outcome, "partial");
    assert.match(
      late.catalog.outcome === "failed" ? late.catalog.message : "",
      /unreviewed matching entry/u,
    );
    assert.ok(
      (await readCatalogDocument({ homeDir })).entries.some(
        (entry) => entry.entryId === "late-entry",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("purge reports committed cleanup residue without restoring or losing Catalog cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-node-purge-residue-"));
  const homeDir = join(root, "home");
  const repoRoot = join(root, "repo");
  await mkdir(repoRoot);
  try {
    await seedRepository(repoRoot);
    await writeFile(join(repoRoot, ".bearing/state/first.md"), "first\n");
    await writeFile(join(repoRoot, ".bearing/state/second.md"), "second\n");
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "partial-purge" });

    const result = await confirmedPurge(homeDir, repoRoot, {
      removeQuarantine: async (target) => {
        await rm(join(target, "state/first.md"));
        throw new Error("injected mid-tree deletion failure");
      },
    });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.repository.outcome, "applied");
    assert.equal(result.repository.cleanup?.outcome, "residue");
    assert.equal(result.catalog.outcome, "applied");
    assert.equal((await readCatalogDocument({ homeDir })).entries.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
