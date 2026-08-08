import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import packageMetadata from "../package.json";
import {
  BEARING_MANAGED_END,
  BEARING_MANAGED_START,
  BEARING_POINTER,
} from "../src/agent-surface-entry";
import { readCatalog } from "../src/catalog/probe";
import { readCatalogState } from "../src/catalog/recovery";
import { catalogDatabasePath } from "../src/catalog/sqlite";
import {
  CatalogBusyError,
  CatalogDuplicateRepositoryError,
  CatalogEntryNotFoundError,
  CatalogLocatorReplacementConfirmationRequiredError,
  CatalogRecoveryRequiredError,
  readCatalogDocument,
  relinkCatalogEntry,
  renameCatalogEntry,
  resetCatalog,
  unregisterCatalogEntry,
  upsertCatalogEntry,
} from "../src/catalog/store";
import { installKit } from "../src/installer";
import { createPortalApp } from "../src/portal/app";
import {
  buildPortalAssetManifest,
  loadPortalAssets,
  writePortalAssetManifest,
} from "../src/portal/assets";
import { deactivateRepository } from "../src/repository-deactivation";
import {
  LOCAL_MATT_CONTRACT,
  LOCAL_MATT_TRIAGE_LABELS,
} from "../tests/fixtures/local-matt-contract";

const execFileAsync = promisify(execFile);

const makeRepository = async (
  root: string,
  surfaces: readonly string[] = ["agent-skills"],
): Promise<void> => {
  await mkdir(join(root, ".bearing"), { recursive: true });
  await writeFile(
    join(root, ".bearing", "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: "0.1.0",
      status: "active",
      surfaces,
      executorProfiles: [],
    })}\n`,
  );
  if (surfaces.includes("agent-skills")) {
    await writeFile(
      join(root, "AGENTS.md"),
      `${BEARING_MANAGED_START}\n${BEARING_POINTER}\n${BEARING_MANAGED_END}\n`,
    );
  }
};

if (process.argv[2] === "--catalog-child") {
  const [, , , homeDir, repoRoot, entryId] = process.argv;
  if (homeDir === undefined || repoRoot === undefined || entryId === undefined) {
    throw new Error("Catalog child arguments are incomplete.");
  }
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => entryId });
  process.exit(0);
}

if (process.argv[2] === "--hold-catalog-writer") {
  const [, , , databasePath, markerPath, holdMilliseconds] = process.argv;
  if (databasePath === undefined || markerPath === undefined || holdMilliseconds === undefined) {
    throw new Error("Catalog writer holder arguments are incomplete.");
  }
  const database = new DatabaseSync(databasePath);
  database.exec("BEGIN IMMEDIATE");
  await writeFile(markerPath, "held\n");
  await delay(Number(holdMilliseconds));
  database.exec("ROLLBACK");
  database.close();
  process.exit(0);
}

test("the built Catalog lane runs on the declared production Node runtime", () => {
  assert.equal(packageMetadata.engines.node, ">=24.15.0");
  const versionOrder = new Intl.Collator("en", { numeric: true }).compare(
    process.versions.node,
    "24.15.0",
  );
  assert.ok(
    versionOrder >= 0,
    `Node ${process.versions.node} is below the supported runtime floor.`,
  );
});

test("the built Catalog lane keeps node:sqlite external and loads the production Catalog graph", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    assert.equal(database.prepare("SELECT 1 AS value").get()?.["value"], 1);
  } finally {
    database.close();
  }

  const homeDir = await mkdtemp(join(tmpdir(), "bearing-node-catalog-home-"));
  try {
    assert.deepEqual(await readCatalogDocument({ homeDir }), { version: 1, entries: [] });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("SQLite Catalog preserves domain CRUD, stable identity, constraints, and missing-read semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-sqlite-catalog-"));
  const homeDir = join(root, "home");
  const firstRoot = join(root, "first");
  const secondRoot = join(root, "second");
  const thirdRoot = join(root, "third");
  await Promise.all([
    makeRepository(firstRoot),
    makeRepository(secondRoot),
    makeRepository(thirdRoot),
  ]);
  try {
    assert.deepEqual(await readCatalogDocument({ homeDir }), { version: 1, entries: [] });
    await assert.rejects(access(catalogDatabasePath(homeDir)));

    const inserted = await upsertCatalogEntry({
      homeDir,
      repoRoot: firstRoot,
      createEntryId: () => "entry-one",
    });
    assert.equal(inserted.outcome, "applied");
    assert.equal((await upsertCatalogEntry({ homeDir, repoRoot: firstRoot })).outcome, "no-op");
    assert.equal(
      (await renameCatalogEntry({ homeDir, entryId: "entry-one", displayName: "One" })).outcome,
      "applied",
    );
    await assert.rejects(renameCatalogEntry({ homeDir, entryId: "entry-one", displayName: "   " }));
    await assert.rejects(
      upsertCatalogEntry({
        homeDir,
        repoRoot: thirdRoot,
        createEntryId: () => "entry-one",
      }),
      /identity must be unique/u,
    );
    await assert.rejects(
      relinkCatalogEntry({ homeDir, entryId: "entry-one", newRepoRoot: secondRoot }),
      (error) => error instanceof CatalogLocatorReplacementConfirmationRequiredError,
    );
    const relinked = await relinkCatalogEntry({
      homeDir,
      entryId: "entry-one",
      newRepoRoot: secondRoot,
      confirmReplaceLocation: true,
    });
    assert.equal(relinked.entry.entryId, "entry-one");
    assert.equal(relinked.entry.repoRoot, await realpath(secondRoot));
    await upsertCatalogEntry({ homeDir, repoRoot: thirdRoot, createEntryId: () => "entry-three" });
    await assert.rejects(
      relinkCatalogEntry({
        homeDir,
        entryId: "entry-one",
        newRepoRoot: thirdRoot,
        confirmReplaceLocation: true,
      }),
      (error) => error instanceof CatalogDuplicateRepositoryError,
    );
    assert.equal(
      (await unregisterCatalogEntry({ homeDir, entryId: "entry-one" })).outcome,
      "applied",
    );
    assert.equal(
      (await unregisterCatalogEntry({ homeDir, entryId: "entry-one" })).outcome,
      "no-op",
    );
    await assert.rejects(
      renameCatalogEntry({ homeDir, entryId: "entry-one", displayName: "Missing" }),
      (error) => error instanceof CatalogEntryNotFoundError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Catalog validates mutation inputs before opening a database transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-sqlite-inputs-"));
  const homeDir = join(root, "home");
  const repoRoot = join(root, "repo");
  await makeRepository(repoRoot);
  try {
    await assert.rejects(
      upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "invalid entry id" }),
    );
    await assert.rejects(
      renameCatalogEntry({ homeDir, entryId: "invalid entry id", displayName: "Valid" }),
    );
    await assert.rejects(renameCatalogEntry({ homeDir, entryId: "valid-id", displayName: "   " }));
    await assert.rejects(access(catalogDatabasePath(homeDir)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite Catalog derives stable display ordering and current availability", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-sqlite-probe-"));
  const homeDir = join(root, "home");
  const alphaRoot = join(root, "Project With Spaces");
  const missingRoot = join(root, "missing-later");
  const zuluRoot = join(root, "zulu");
  await Promise.all([
    makeRepository(alphaRoot),
    makeRepository(missingRoot),
    makeRepository(zuluRoot),
  ]);
  try {
    await upsertCatalogEntry({ homeDir, repoRoot: zuluRoot, createEntryId: () => "zulu" });
    await renameCatalogEntry({ homeDir, entryId: "zulu", displayName: "Zulu Fixture" });
    await upsertCatalogEntry({ homeDir, repoRoot: missingRoot, createEntryId: () => "missing" });
    await renameCatalogEntry({ homeDir, entryId: "missing", displayName: "Bravo Missing" });
    await upsertCatalogEntry({ homeDir, repoRoot: alphaRoot, createEntryId: () => "spaced" });
    await renameCatalogEntry({ homeDir, entryId: "spaced", displayName: "Alpha Fixture" });
    await rm(missingRoot, { recursive: true, force: true });

    const first = await readCatalog({ homeDir });
    const second = await readCatalog({ homeDir });
    assert.deepEqual(
      first.entries.map(({ entryId }) => entryId),
      ["spaced", "missing", "zulu"],
    );
    assert.deepEqual(second.entries, first.entries);
    assert.deepEqual(
      first.entries.map(({ availability }) => availability),
      ["available", "missing", "available"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite Catalog serializes two real Node writers without losing committed entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-sqlite-processes-"));
  const homeDir = join(root, "home");
  const firstRoot = join(root, "first");
  const secondRoot = join(root, "second");
  await Promise.all([makeRepository(firstRoot), makeRepository(secondRoot)]);
  try {
    const artifact = new URL(import.meta.url).pathname;
    await Promise.all([
      execFileAsync(process.execPath, [artifact, "--catalog-child", homeDir, firstRoot, "entry-a"]),
      execFileAsync(process.execPath, [
        artifact,
        "--catalog-child",
        homeDir,
        secondRoot,
        "entry-b",
      ]),
    ]);
    const entries = (await readCatalogDocument({ homeDir })).entries;
    assert.deepEqual(entries.map((entry) => entry.entryId).sort(), ["entry-a", "entry-b"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite Catalog returns bounded catalog-busy and succeeds after the writer releases", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-sqlite-busy-"));
  const homeDir = join(root, "home");
  const repoRoot = join(root, "repo");
  await makeRepository(repoRoot);
  let holder: DatabaseSync | undefined;
  try {
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-a" });
    holder = new DatabaseSync(catalogDatabasePath(homeDir));
    holder.exec("BEGIN IMMEDIATE");
    assert.equal((await readCatalogDocument({ homeDir })).entries[0]?.entryId, "entry-a");
    const startedAt = Date.now();
    await assert.rejects(
      renameCatalogEntry({
        homeDir,
        entryId: "entry-a",
        displayName: "Busy",
      }),
      (error) => error instanceof CatalogBusyError && error.code === "catalog-busy",
    );
    await assert.rejects(
      unregisterCatalogEntry({ homeDir, entryId: "entry-a" }),
      (error) => error instanceof CatalogBusyError && error.code === "catalog-busy",
    );
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 750, `Expected the default busy wait, received ${elapsed}ms.`);
    assert.ok(elapsed <= 5_000, `Expected bounded busy failure, received ${elapsed}ms.`);
    holder.exec("ROLLBACK");
    holder.close();
    holder = undefined;
    assert.equal(
      (await renameCatalogEntry({ homeDir, entryId: "entry-a", displayName: "Ready" })).outcome,
      "applied",
    );
  } finally {
    try {
      holder?.exec("ROLLBACK");
    } catch {}
    holder?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite Catalog rejects existing incompatible schema, constraints, and open targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-sqlite-incompatible-"));
  const versionHome = join(root, "version-home");
  const constraintHome = join(root, "constraint-home");
  const openHome = join(root, "open-home");
  const emptyHome = join(root, "empty-home");
  const repoRoot = join(root, "repo");
  await makeRepository(repoRoot);
  try {
    await upsertCatalogEntry({
      homeDir: versionHome,
      repoRoot,
      createEntryId: () => "version-entry",
    });
    const versionDatabase = new DatabaseSync(catalogDatabasePath(versionHome));
    versionDatabase.exec("PRAGMA user_version = 2");
    versionDatabase.close();
    assert.equal((await readCatalogState({ homeDir: versionHome })).state, "failed");
    await assert.rejects(
      unregisterCatalogEntry({ homeDir: versionHome, entryId: "version-entry" }),
      (error) => error instanceof CatalogRecoveryRequiredError,
    );

    await mkdir(join(constraintHome, ".bearing"), { recursive: true });
    const constraintDatabase = new DatabaseSync(catalogDatabasePath(constraintHome));
    constraintDatabase.exec(`
      CREATE TABLE catalog_entries (
        entry_id TEXT PRIMARY KEY NOT NULL,
        repo_root TEXT NOT NULL,
        display_name TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 1;
    `);
    constraintDatabase.close();
    assert.equal((await readCatalogState({ homeDir: constraintHome })).state, "failed");
    await assert.rejects(
      unregisterCatalogEntry({ homeDir: constraintHome, entryId: "constraint-entry" }),
      (error) => error instanceof CatalogRecoveryRequiredError,
    );
    await assert.rejects(
      upsertCatalogEntry({
        homeDir: constraintHome,
        repoRoot,
        createEntryId: () => "constraint-entry",
      }),
      /unavailable/u,
    );

    await mkdir(join(emptyHome, ".bearing"), { recursive: true });
    new DatabaseSync(catalogDatabasePath(emptyHome)).close();
    await assert.rejects(
      upsertCatalogEntry({
        homeDir: emptyHome,
        repoRoot,
        createEntryId: () => "empty-file-entry",
      }),
      /unavailable/u,
    );

    await mkdir(catalogDatabasePath(openHome), { recursive: true });
    assert.equal((await readCatalogState({ homeDir: openHome })).state, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite Catalog fails closed, ignores legacy JSON, and recovers through reset plus Repository Configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-sqlite-reset-"));
  const homeDir = join(root, "home");
  const repoRoot = join(root, "setup-project");
  await mkdir(join(homeDir, ".bearing"), { recursive: true });
  await writeFile(
    join(homeDir, ".bearing", "catalog.json"),
    JSON.stringify({ version: 1, entries: [{ entryId: "legacy" }] }),
  );
  await writeFile(
    join(homeDir, ".bearing", "catalog.backup.json"),
    JSON.stringify({ version: 1, entries: [{ entryId: "legacy-backup" }] }),
  );
  await mkdir(join(homeDir, ".bearing", "catalog.lock"), { recursive: true });
  await writeFile(join(homeDir, ".bearing", "catalog.lock", "owner.json"), "legacy owner\n");
  await mkdir(join(homeDir, ".bearing", "entry-leases", "legacy.lock"), { recursive: true });
  await writeFile(
    join(homeDir, ".bearing", "entry-leases", "legacy.lock", "owner.json"),
    "legacy lease\n",
  );
  try {
    assert.deepEqual(await readCatalogDocument({ homeDir }), { version: 1, entries: [] });
    await writeFile(catalogDatabasePath(homeDir), "not a database");
    await assert.rejects(readCatalogDocument({ homeDir }), /unavailable/i);
    await assert.rejects(
      unregisterCatalogEntry({ homeDir, entryId: "any-entry" }),
      (error) => error instanceof CatalogRecoveryRequiredError,
    );
    assert.equal(await readFile(catalogDatabasePath(homeDir), "utf8"), "not a database");
    await assert.rejects(resetCatalog({ homeDir, confirmed: false }), /confirmation/i);
    assert.equal((await resetCatalog({ homeDir, confirmed: true })).outcome, "applied");
    assert.deepEqual(await readCatalogDocument({ homeDir }), { version: 1, entries: [] });

    await mkdir(join(repoRoot, "docs", "agents"), { recursive: true });
    await writeFile(join(repoRoot, "docs", "agents", "issue-tracker.md"), LOCAL_MATT_CONTRACT);
    await writeFile(join(repoRoot, "docs", "agents", "triage-labels.md"), LOCAL_MATT_TRIAGE_LABELS);
    await writeFile(
      join(repoRoot, "AGENTS.md"),
      "## Agent skills\n\n### Issue tracker\n\nIssues use the repository tracker. See `docs/agents/issue-tracker.md`.\n",
    );
    const configurationArguments = [
      "--intent",
      "activate",
      "--repo",
      repoRoot,
      "--surface",
      "agent-skills",
      "--provider-contract",
      "docs/agents/issue-tracker.md",
      "--executor-mode",
      "skip",
    ];
    const planned = await execFileAsync(
      process.execPath,
      ["dist/cli.js", "configure", "plan", ...configurationArguments],
      { cwd: process.cwd(), env: { ...process.env, HOME: homeDir } },
    );
    const plan = JSON.parse(planned.stdout) as { sealedPlanToken?: string };
    assert.match(plan.sealedPlanToken ?? "", /^sha256:[0-9a-f]{64}$/u);
    const applied = await execFileAsync(
      process.execPath,
      [
        "dist/cli.js",
        "configure",
        "apply",
        ...configurationArguments,
        "--plan-token",
        plan.sealedPlanToken ?? "",
      ],
      { cwd: process.cwd(), env: { ...process.env, HOME: homeDir } },
    );
    assert.deepEqual((JSON.parse(applied.stdout) as { catalog: { outcome: string } }).catalog, {
      outcome: "applied",
      entryId: (await readCatalogDocument({ homeDir })).entries[0]?.entryId,
    });
    assert.equal((await readCatalogDocument({ homeDir })).entries.length, 1);
    await Promise.all([
      access(join(homeDir, ".bearing", "catalog.json")),
      access(join(homeDir, ".bearing", "catalog.backup.json")),
      access(join(homeDir, ".bearing", "catalog.lock", "owner.json")),
      access(join(homeDir, ".bearing", "entry-leases", "legacy.lock", "owner.json")),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("confirmed reset waits for a valid writer and preserves unavailable state on replacement failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-sqlite-reset-boundary-"));
  const homeDir = join(root, "home");
  const repoRoot = join(root, "repo");
  const markerPath = join(root, "writer-held");
  await makeRepository(repoRoot);
  try {
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "reset-entry" });
    const artifact = new URL(import.meta.url).pathname;
    const holder = execFileAsync(process.execPath, [
      artifact,
      "--hold-catalog-writer",
      catalogDatabasePath(homeDir),
      markerPath,
      "300",
    ]);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await access(markerPath);
        break;
      } catch {
        if (attempt === 99) throw new Error("Catalog writer holder did not start.");
        await delay(10);
      }
    }
    const startedAt = Date.now();
    await resetCatalog({ homeDir, confirmed: true });
    await holder;
    assert.ok(Date.now() - startedAt >= 150);
    assert.deepEqual(await readCatalogDocument({ homeDir }), { version: 1, entries: [] });

    const failedHome = join(root, "failed-home");
    await mkdir(join(failedHome, ".bearing"), { recursive: true });
    await writeFile(catalogDatabasePath(failedHome), "not a database");
    await mkdir(`${catalogDatabasePath(failedHome)}-journal`);
    await writeFile(
      join(`${catalogDatabasePath(failedHome)}-journal`, "preserved"),
      "blocks replacement\n",
    );
    await assert.rejects(resetCatalog({ homeDir: failedHome, confirmed: true }), /unavailable/u);
    assert.equal((await readCatalogState({ homeDir: failedHome })).state, "failed");
    assert.equal(await readFile(catalogDatabasePath(failedHome), "utf8"), "not a database");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installer Catalog inspection runs through the production Node boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-node-installer-"));
  const homeDir = join(root, "home");
  const repoRoot = join(root, "project");
  await Promise.all([
    mkdir(homeDir, { recursive: true }),
    mkdir(join(repoRoot, ".bearing"), { recursive: true }),
  ]);
  const manifestPath = join(repoRoot, ".bearing", "manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: "0.1.0",
      status: "active",
      surfaces: ["agent-skills"],
      executorProfiles: [],
    })}\n`,
  );
  try {
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "newer-project" });
    await writeFile(manifestPath, '{"schemaVersion":2,"packageVersion":"0.2.0"}\n');
    await assert.rejects(
      installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] }),
      /reads repository schema 1 only/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Portal host reads the SQLite Catalog through the Node-owned adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-node-portal-"));
  const packageRoot = join(root, "package");
  const portalRoot = join(packageRoot, "dist", "portal");
  const homeDir = join(root, "home");
  await mkdir(portalRoot, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ version: packageMetadata.version }),
  );
  await writeFile(join(portalRoot, "index.html"), '<!doctype html><div id="root"></div>');
  await writePortalAssetManifest(
    portalRoot,
    await buildPortalAssetManifest(portalRoot, packageMetadata.version),
  );
  const app = createPortalApp({
    assets: await loadPortalAssets(packageRoot, packageMetadata.version),
    sessions: { secret: "ticket-03-node-server-test-session-secret" },
    readCatalog: () => readCatalog({ homeDir }),
  });
  try {
    const catalog = await app.request("http://127.0.0.1:4178/api/v1/catalog");
    assert.equal(catalog.status, 200);
    const body = (await catalog.json()) as { state?: unknown; entries?: unknown };
    assert.equal(body.state, "ready");
    assert.deepEqual(body.entries, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository deactivation cleans up through the SQLite Catalog domain API", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-sqlite-lifecycle-"));
  const homeDir = join(root, "home");
  const deactivateRoot = join(root, "deactivate");
  await makeRepository(deactivateRoot);
  try {
    await upsertCatalogEntry({
      homeDir,
      repoRoot: deactivateRoot,
      createEntryId: () => "deactivate-entry",
    });
    const deactivated = await deactivateRepository({ homeDir, repoRoot: deactivateRoot });
    assert.equal(deactivated.outcome, "applied");
    assert.deepEqual(await readCatalogDocument({ homeDir }), { version: 1, entries: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the built and shipped CLI exposes only the SQLite Catalog surface", async () => {
  const builtCli = await readFile(join(process.cwd(), "dist", "cli.js"), "utf8");
  assert.match(builtCli, /import\("node:sqlite"\)/u);
  assert.doesNotMatch(
    builtCli,
    /bun:sqlite|catalog\.json|catalog\.backup|repair-entry-lock|repair-lock|lockTimeoutMs/u,
  );

  const catalogModules = (await readdir(join(process.cwd(), "src", "catalog"))).sort();
  assert.deepEqual(catalogModules, [
    "availability.ts",
    "cli.ts",
    "entry-id.ts",
    "errors.ts",
    "model.ts",
    "operations.ts",
    "probe.ts",
    "recovery.ts",
    "repository-inspection.ts",
    "repository.ts",
    "sqlite.ts",
    "store.ts",
    "transaction.ts",
  ]);

  const homeDir = await mkdtemp(join(tmpdir(), "bearing-built-catalog-help-"));
  try {
    const help = await execFileAsync(process.execPath, ["dist/cli.js", "catalog", "--help"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: homeDir },
    });
    assert.match(help.stdout, /catalog reset --confirm-empty/u);
    assert.match(help.stdout, /catalog inspect/u);
    assert.match(help.stdout, /catalog unregister/u);
    assert.match(help.stdout, /confirm-replace-location/u);
    assert.doesNotMatch(help.stdout, /catalog (?:forget|remove)\b|confirm-move/u);
    assert.doesNotMatch(help.stdout, /repair|lease|lock/u);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }

  const shippedGuidance = await Promise.all([
    readFile(join(process.cwd(), "skills/bearing/references/journeys/configure.md"), "utf8"),
    readFile(join(process.cwd(), "skills/bearing/references/journeys/catalog.md"), "utf8"),
    readFile(join(process.cwd(), "docs/cli.md"), "utf8"),
    readFile(join(process.cwd(), "docs/cli.zh-CN.md"), "utf8"),
  ]);
  for (const document of shippedGuidance) {
    assert.doesNotMatch(
      document,
      /catalog\.json|catalog\.backup|repair-lock|repair-entry-lock|backup repair/u,
    );
    assert.doesNotMatch(document, /catalog (?:forget|remove)\b|confirm-move/u);
  }
});
