import { describe, expect, test } from "bun:test";
import { access, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseCatalogDocument } from "../src/catalog/model";
import { readCatalog } from "../src/catalog/probe";
import { CatalogLockError, readCatalogDocument, upsertCatalogEntry } from "../src/catalog/store";
import { reconcileRepository } from "../src/reconcile-repository";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

const catalogDocument = (
  entries: readonly Readonly<{
    entryId: string;
    repoRoot: string;
    displayName: string;
  }>[],
) => ({ version: 1, entries });

const writeCatalog = async (
  homeDir: string,
  entries: Parameters<typeof catalogDocument>[0],
): Promise<void> => {
  const catalogPath = join(homeDir, ".bearing/catalog.json");
  await mkdir(join(homeDir, ".bearing"), { recursive: true });
  await writeFile(catalogPath, `${JSON.stringify(catalogDocument(entries), null, 2)}\n`);
};

describe("Project Catalog contract", () => {
  test("requires a URL-safe opaque entry identity", () => {
    expect(() =>
      parseCatalogDocument(
        catalogDocument([
          { entryId: "nested/project", repoRoot: "/projects/one", displayName: "One" },
        ]),
      ),
    ).toThrow();
  });

  test("rejects an entry with fields outside the strict persisted schema", () => {
    // Given: a document that otherwise matches the three-field entry contract.
    const untrusted = {
      version: 1,
      entries: [
        {
          entryId: "entry-one",
          repoRoot: "/projects/one",
          displayName: "One",
          lastOpenedAt: "2026-07-13T00:00:00Z",
        },
      ],
    };

    // When / Then: parsing the persistence boundary rejects the extra field.
    expect(() => parseCatalogDocument(untrusted)).toThrow();
  });

  test("canonicalizes repeated repository upserts while preserving local identity and alias", async () => {
    // Given: one enabled repository reachable through both a symlink and its real path.
    const repoRoot = await createValidBearingRepo();
    const links = await makeTemporaryDirectory("bearing-catalog-links-");
    const linkedRoot = join(links, "friendly-link");
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await symlink(repoRoot, linkedRoot);

    // When: reconcile reaches the same canonical repository twice.
    await upsertCatalogEntry({
      homeDir,
      repoRoot: linkedRoot,
      createEntryId: () => "entry-original",
    });
    const first = await readCatalogDocument({ homeDir });
    const originalEntry = first.entries[0];
    if (originalEntry === undefined) throw new Error("Catalog fixture did not persist an entry.");
    await writeCatalog(homeDir, [{ ...originalEntry, displayName: "My preserved alias" }]);
    await upsertCatalogEntry({
      homeDir,
      repoRoot,
      createEntryId: () => "entry-replacement",
    });

    // Then: one canonical entry remains and user-local fields are preserved.
    expect((await readCatalogDocument({ homeDir })).entries).toEqual([
      {
        entryId: "entry-original",
        repoRoot: await realpath(repoRoot),
        displayName: "My preserved alias",
      },
    ]);
    expect(originalEntry.displayName).toBe(basename(repoRoot));
  });

  test("stably sorts entries and derives independent live probe states", async () => {
    // Given: entries spanning every independent availability state.
    const available = await realpath(await createValidBearingRepo());
    const manifestMissing = await realpath(await makeTemporaryDirectory("catalog-no-manifest-"));
    const invalidManifest = await realpath(await makeTemporaryDirectory("catalog-bad-manifest-"));
    const missing = join(await makeTemporaryDirectory("catalog-missing-parent-"), "gone");
    const unreadable = join(await makeTemporaryDirectory("catalog-unreadable-"), "not-a-directory");
    await mkdir(join(invalidManifest, ".bearing"), { recursive: true });
    await writeFile(join(invalidManifest, ".bearing/manifest.json"), "{not-json\n");
    await writeFile(unreadable, "not a repository directory\n");
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await writeCatalog(homeDir, [
      { entryId: "z", repoRoot: available, displayName: "Zulu" },
      { entryId: "m", repoRoot: missing, displayName: "alpha" },
      { entryId: "n", repoRoot: manifestMissing, displayName: "Alpha" },
      { entryId: "i", repoRoot: invalidManifest, displayName: "bravo" },
      { entryId: "u", repoRoot: unreadable, displayName: "charlie" },
    ]);

    // When: the Portal reads the Catalog once.
    const result = await readCatalog({ homeDir });

    // Then: name/path sorting is deterministic and one bad entry does not block the others.
    expect(result.entries.map(({ entryId }) => entryId)).toEqual(["n", "m", "i", "u", "z"]);
    expect(
      Object.fromEntries(
        result.entries.map(({ entryId, availability }) => [entryId, availability]),
      ),
    ).toEqual({
      m: "missing",
      n: "manifest-missing",
      i: "invalid-manifest",
      u: "unreadable",
      z: "available",
    });
  });

  test("probes last-known-good entries while reporting degraded Catalog truth", async () => {
    // Given a malformed current Catalog and one trustworthy registered project in the backup
    const available = await realpath(await createValidBearingRepo());
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".bearing"), { recursive: true });
    await writeFile(join(homeDir, ".bearing/catalog.json"), "{malformed\n");
    await writeFile(
      join(homeDir, ".bearing/catalog.backup.json"),
      `${JSON.stringify(
        catalogDocument([
          { entryId: "entry-backup", repoRoot: available, displayName: "Backup project" },
        ]),
        null,
        2,
      )}\n`,
    );

    // When the Portal-facing probe reads the Catalog
    const result = await readCatalog({ homeDir });

    // Then the state remains degraded and the trustworthy backup entry is still probed
    expect(result).toMatchObject({
      state: "degraded",
      entries: [{ entryId: "entry-backup", availability: "available" }],
      diagnostic: { code: "catalog-current-invalid" },
    });
  });

  test("returns a typed failure instead of overwriting a live lock holder", async () => {
    // Given: a Catalog lock owned by the current live process.
    const repoRoot = await createValidBearingRepo();
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const catalogPath = join(homeDir, ".bearing/catalog.json");
    const lockRoot = join(homeDir, ".bearing/catalog.lock");
    await mkdir(lockRoot, { recursive: true });
    await writeFile(
      join(lockRoot, "owner.json"),
      `${JSON.stringify({ pid: process.pid, token: "held-by-test" })}\n`,
    );

    // When / Then: bounded acquisition reports contention without mutating the store.
    await expect(
      upsertCatalogEntry({
        homeDir,
        repoRoot,
        createEntryId: () => "entry-never-written",
        lockTimeoutMs: 0,
      }),
    ).rejects.toBeInstanceOf(CatalogLockError);
    await expect(access(catalogPath)).rejects.toThrow();
  });

  test("fails closed when the current Catalog document is malformed", async () => {
    // Given: malformed bytes at the trusted persistence boundary.
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const catalogPath = join(homeDir, ".bearing/catalog.json");
    await mkdir(join(homeDir, ".bearing"), { recursive: true });
    await writeFile(catalogPath, "{malformed\n");

    // When / Then: the store never turns corrupt bytes into an empty Catalog.
    await expect(readCatalogDocument({ homeDir })).rejects.toThrow();
  });

  test("preserves repository setup when the later Catalog registration fails", async () => {
    // Given: a fresh repository and a malformed user-level Catalog.
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".bearing"), { recursive: true });
    await writeFile(join(homeDir, ".bearing/catalog.json"), "{malformed\n");

    // When: reconcile completes repo-local setup before Catalog registration.
    const result = await reconcileRepository({
      repoRoot,
      packageRoot: process.cwd(),
      homeDir,
      surfaces: ["agent-skills"],
      profiles: ["generic-agent"],
    });

    // Then: the split outcome is partial, while the valid repo-local manifest remains committed.
    expect(result.outcome).toBe("partial");
    expect(result.repository.outcome).toBe("applied");
    expect(result.catalog.outcome).toBe("failed");
    const manifest = JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ schemaVersion: 1, surfaces: ["agent-skills"] });
  });
});
