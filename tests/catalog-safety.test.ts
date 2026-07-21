import { describe, expect, test } from "bun:test";
import {
  access,
  link,
  mkdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { readCatalog } from "../src/catalog/probe";
import { readCatalogDocument, upsertCatalogEntry } from "../src/catalog/store";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

describe("Project Catalog filesystem safety", () => {
  test("rejects a user-state ancestor symlink instead of following it", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const outside = await makeTemporaryDirectory("bearing-catalog-outside-");
    await writeFile(join(outside, "catalog.json"), '{"version":1,"entries":[]}\n');
    await symlink(outside, join(homeDir, ".bearing"));

    await expect(readCatalogDocument({ homeDir })).rejects.toThrow("symbolic link");
  });

  test("rejects mutation through a hard-linked Catalog", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await createValidBearingRepo();
    const catalogDirectory = join(homeDir, ".bearing");
    const catalogPath = join(catalogDirectory, "catalog.json");
    await mkdir(catalogDirectory);
    await writeFile(catalogPath, '{"version":1,"entries":[]}\n');
    await link(catalogPath, join(homeDir, "catalog-peer.json"));

    await expect(upsertCatalogEntry({ homeDir, repoRoot })).rejects.toThrow(
      "unlinked regular file",
    );
    expect(await readFile(catalogPath, "utf8")).toBe('{"version":1,"entries":[]}\n');
  });

  test("writes private bytes and probes no planning cache", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await createValidBearingRepo();
    const catalogPath = join(homeDir, ".bearing/catalog.json");

    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-safe" });
    expect((await stat(catalogPath)).mode & 0o777).toBe(0o600);
    expect((await readCatalog({ homeDir })).entries[0]?.availability).toBe("available");
    await expect(access(join(repoRoot, ".bearing/cache/project-sitemap.md"))).rejects.toThrow();
  });

  test("does not register a repository with an invalid manifest", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-invalid-repo-");
    await mkdir(join(repoRoot, ".bearing"));
    await writeFile(join(repoRoot, ".bearing/manifest.json"), "{}\n");

    await expect(upsertCatalogEntry({ homeDir, repoRoot })).rejects.toThrow("manifest is invalid");
    await expect(access(join(homeDir, ".bearing/catalog.json"))).rejects.toThrow();
  });

  test("rejects and isolates a repository whose Bearing directory is a symlink", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-linked-repo-");
    const canonicalRepoRoot = await realpath(repoRoot);
    const externalBearing = await makeTemporaryDirectory("bearing-external-state-");
    await writeFile(
      join(externalBearing, "manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.0.0-g2",
        surfaces: ["agent-skills"],
        executorProfiles: ["generic-agent"],
      })}\n`,
    );
    await symlink(externalBearing, join(repoRoot, ".bearing"));

    await expect(upsertCatalogEntry({ homeDir, repoRoot })).rejects.toThrow("manifest is invalid");

    const catalogDirectory = join(homeDir, ".bearing");
    await mkdir(catalogDirectory, { recursive: true });
    await writeFile(
      join(catalogDirectory, "catalog.json"),
      `${JSON.stringify({
        version: 1,
        entries: [
          { entryId: "linked-repo", repoRoot: canonicalRepoRoot, displayName: "Linked repo" },
        ],
      })}\n`,
    );
    expect((await readCatalog({ homeDir })).entries[0]?.availability).toBe("invalid-manifest");
  });
});
