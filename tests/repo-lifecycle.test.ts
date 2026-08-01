import { describe, expect, test } from "bun:test";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { readCatalogDocument, upsertCatalogEntry } from "../src/catalog/store";
import { writeInstallTarget } from "../src/installer";
import {
  deactivateRepository,
  inspectPurgePlan,
  type PurgeTransactionHooks,
  purgeRepository,
} from "../src/repo-lifecycle";
import { setupRepository } from "../src/repo-setup";
import { LOCAL_MATT_CONTRACT, makeTemporaryDirectory, standardMattAgentSurface } from "./helpers";

const seedRepository = async (repoRoot: string): Promise<void> => {
  const contractLocator = "docs/agents/issue-tracker.md";
  await mkdir(join(repoRoot, "docs/agents"), { recursive: true });
  await writeFile(join(repoRoot, contractLocator), LOCAL_MATT_CONTRACT);
  await writeFile(
    join(repoRoot, "AGENTS.md"),
    `# User rules\n\n${standardMattAgentSurface(contractLocator)}`,
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

const seedNestedManifestSymlink = async (
  homeDir: string,
  repoRoot: string,
  entryId: string,
): Promise<
  Readonly<{
    externalManifest: string;
    externalBytes: string;
    agentsBefore: string;
    catalogBefore: string;
  }>
> => {
  await seedRepository(repoRoot);
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => entryId });
  const agentsBefore = await readFile(join(repoRoot, "AGENTS.md"), "utf8");
  const catalogBefore = await readFile(join(homeDir, ".bearing/catalog.json"), "utf8");
  const outside = await makeTemporaryDirectory("bearing-outside-manifest-");
  const externalManifest = join(outside, "external-manifest.json");
  const externalBytes = `${JSON.stringify({
    schemaVersion: 1,
    packageVersion: "external",
    status: "active",
    surfaces: ["agent-skills"],
    executorProfiles: ["generic-agent"],
  })}\n`;
  await writeFile(externalManifest, externalBytes);
  const manifestPath = join(repoRoot, ".bearing/manifest.json");
  await rm(manifestPath);
  await symlink(externalManifest, manifestPath);
  return { externalManifest, externalBytes, agentsBefore, catalogBefore };
};

describe("repository Bearing lifecycle", () => {
  test("deactivate removes enablement and Catalog registration but preserves state and native work", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await seedRepository(repoRoot);
    await writeFile(join(repoRoot, ".bearing/state/accepted.md"), "accepted truth\n");
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "deactivate-project" });

    const result = await deactivateRepository({ homeDir, repoRoot });

    expect(result.outcome).toBe("applied");
    expect(
      JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({ status: "deactivated", surfaces: ["agent-skills"] });
    await access(join(repoRoot, ".bearing/provider.json"));
    await expect(access(join(repoRoot, ".bearing/cache"))).rejects.toThrow();
    expect(await readFile(join(repoRoot, ".bearing/state/accepted.md"), "utf8")).toBe(
      "accepted truth\n",
    );
    expect(await readFile(join(repoRoot, ".scratch/work/evidence/result.md"), "utf8")).toBe(
      "durable\n",
    );
    expect(await readFile(join(repoRoot, "source.txt"), "utf8")).toBe("source stays\n");
    const agents = await readFile(join(repoRoot, "AGENTS.md"), "utf8");
    expect(agents).toStartWith("# User rules\n");
    expect(agents).not.toContain("bearing:managed-start");
    expect((await readCatalogDocument({ homeDir })).entries).toEqual([]);

    const replay = await deactivateRepository({ homeDir, repoRoot });
    expect(replay.outcome).toBe("no-op");
    expect(replay.repository.outcome).toBe("no-op");
  });

  test("purge removes only .bearing and managed blocks after explicit confirmation", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await seedRepository(repoRoot);
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "purge-project" });

    await expect(purgeRepository({ homeDir, repoRoot, confirmed: false })).rejects.toThrow(
      "requires --confirm-purge",
    );
    await access(join(repoRoot, ".bearing/manifest.json"));

    const result = await confirmedPurge(homeDir, repoRoot);
    expect(result.outcome).toBe("applied");
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
    expect(await readFile(join(repoRoot, ".scratch/work/effort.md"), "utf8")).toBe("# Effort\n");
    expect(await readFile(join(repoRoot, ".scratch/work/evidence/result.md"), "utf8")).toBe(
      "durable\n",
    );
    expect(await readFile(join(repoRoot, "source.txt"), "utf8")).toBe("source stays\n");
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).not.toContain(
      "bearing:managed-start",
    );
    expect((await readCatalogDocument({ homeDir })).entries).toEqual([]);
  });

  test("purge refuses a linked .bearing namespace", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    const outside = await makeTemporaryDirectory("bearing-outside-");
    await writeFile(join(outside, "preserved.txt"), "outside\n");
    await symlink(outside, join(repoRoot, ".bearing"));

    await expect(confirmedPurge(homeDir, repoRoot)).rejects.toThrow("unsafe Bearing-owned target");
    expect(await readFile(join(outside, "preserved.txt"), "utf8")).toBe("outside\n");
  });

  test("deactivate rejects a linked .bearing namespace without touching its target", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    const outside = await makeTemporaryDirectory("bearing-outside-");
    const externalManifest = join(outside, "manifest.json");
    const externalBytes = `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: "0.1.0",
      surfaces: ["agent-skills"],
      executorProfiles: ["generic-agent"],
    })}\n`;
    const managedAgents = `# User rules

<!-- bearing:managed-start -->
For every project request, load and follow the global \`bearing\` skill as the governing runbook.
<!-- bearing:managed-end -->
`;
    await writeFile(externalManifest, externalBytes);
    await writeFile(join(outside, "state.md"), "external state\n");
    await writeFile(join(repoRoot, "AGENTS.md"), managedAgents);
    await symlink(outside, join(repoRoot, ".bearing"));

    await expect(deactivateRepository({ homeDir, repoRoot })).rejects.toThrow(
      "deactivation refuses an unsafe `.bearing` namespace shape",
    );

    expect(await readFile(externalManifest, "utf8")).toBe(externalBytes);
    expect(await readFile(join(outside, "state.md"), "utf8")).toBe("external state\n");
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(managedAgents);
  });

  test("deactivate rejects retained namespace state without its lifecycle authority", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await mkdir(join(repoRoot, ".bearing/state"), { recursive: true });
    await writeFile(join(repoRoot, ".bearing/state/accepted.md"), "retained truth\n");

    await expect(deactivateRepository({ homeDir, repoRoot })).rejects.toThrow(
      "requires a valid lifecycle manifest",
    );
    expect(await readFile(join(repoRoot, ".bearing/state/accepted.md"), "utf8")).toBe(
      "retained truth\n",
    );
  });

  test("deactivate rejects an unsafe cache shape before lifecycle writes", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    const outside = await makeTemporaryDirectory("bearing-outside-cache-");
    await seedRepository(repoRoot);
    await writeFile(join(outside, "preserved.txt"), "outside cache target\n");
    await rm(join(repoRoot, ".bearing/cache"), { recursive: true });
    await symlink(outside, join(repoRoot, ".bearing/cache"));
    const manifestBefore = await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8");
    const agentsBefore = await readFile(join(repoRoot, "AGENTS.md"), "utf8");

    await expect(deactivateRepository({ homeDir, repoRoot })).rejects.toThrow(
      "unsafe `.bearing/cache` shape",
    );

    expect(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")).toBe(manifestBefore);
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(agentsBefore);
    expect(await readFile(join(outside, "preserved.txt"), "utf8")).toBe("outside cache target\n");
  });

  test("deactivate rejects a nested manifest symlink before pointer or Catalog writes", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    const fixture = await seedNestedManifestSymlink(homeDir, repoRoot, "nested-deactivate");

    await expect(deactivateRepository({ homeDir, repoRoot })).rejects.toThrow(
      "manifest must be one single-link regular file",
    );

    expect((await lstat(join(repoRoot, ".bearing/manifest.json"))).isSymbolicLink()).toBe(true);
    expect(await readFile(fixture.externalManifest, "utf8")).toBe(fixture.externalBytes);
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(fixture.agentsBefore);
    expect(await readFile(join(homeDir, ".bearing/catalog.json"), "utf8")).toBe(
      fixture.catalogBefore,
    );
  });

  test("purge uses the same nested manifest guard before pointer or Catalog writes", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    const fixture = await seedNestedManifestSymlink(homeDir, repoRoot, "nested-purge");

    await expect(confirmedPurge(homeDir, repoRoot)).rejects.toThrow("unsafe Bearing-owned target");

    expect((await lstat(join(repoRoot, ".bearing/manifest.json"))).isSymbolicLink()).toBe(true);
    expect(await readFile(fixture.externalManifest, "utf8")).toBe(fixture.externalBytes);
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(fixture.agentsBefore);
    expect(await readFile(join(homeDir, ".bearing/catalog.json"), "utf8")).toBe(
      fixture.catalogBefore,
    );
  });

  test("purge preserves a concurrent Agent Surface generation and the reviewed namespace", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await seedRepository(repoRoot);
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "purge-race" });
    const concurrentAgents = `${await readFile(join(repoRoot, "AGENTS.md"), "utf8")}
# Concurrent user update
`;

    await expect(
      confirmedPurge(homeDir, repoRoot, {
        beforeApply: async () => {
          await writeFile(join(repoRoot, "AGENTS.md"), concurrentAgents);
        },
      }),
    ).rejects.toThrow("original targets were restored");

    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(concurrentAgents);
    await access(join(repoRoot, ".bearing/manifest.json"));
    expect((await readCatalogDocument({ homeDir })).entries).toHaveLength(1);
  });

  test("purge rolls pointers back when the namespace generation changes during writes", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await seedRepository(repoRoot);
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "purge-generation-race" });
    const agentsBefore = await readFile(join(repoRoot, "AGENTS.md"), "utf8");
    const manifestPath = join(repoRoot, ".bearing/manifest.json");
    const racedManifest = {
      ...JSON.parse(await readFile(manifestPath, "utf8")),
      packageVersion: "concurrent-generation",
    };

    await expect(
      confirmedPurge(homeDir, repoRoot, {
        writeTarget: async (plan, ordinal) => {
          await writeInstallTarget(plan, ordinal);
          await writeFile(manifestPath, `${JSON.stringify(racedManifest, null, 2)}\n`);
        },
      }),
    ).rejects.toThrow("original targets were restored");

    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(agentsBefore);
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({
      packageVersion: "concurrent-generation",
    });
    expect((await readCatalogDocument({ homeDir })).entries).toHaveLength(1);
  });

  test("purge binds the quarantine rename to the reviewed namespace inode", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await seedRepository(repoRoot);
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "purge-inode-race" });
    const agentsBefore = await readFile(join(repoRoot, "AGENTS.md"), "utf8");
    const reviewedAside = join(repoRoot, ".reviewed-bearing-generation");

    await expect(
      confirmedPurge(homeDir, repoRoot, {
        beforeNamespaceRename: async () => {
          await rename(join(repoRoot, ".bearing"), reviewedAside);
          await mkdir(join(repoRoot, ".bearing"));
          await writeFile(join(repoRoot, ".bearing/replacement.txt"), "replacement survives\n");
        },
      }),
    ).rejects.toThrow("original targets were restored");

    expect(await readFile(join(repoRoot, ".bearing/replacement.txt"), "utf8")).toBe(
      "replacement survives\n",
    );
    await access(join(reviewedAside, "manifest.json"));
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(agentsBefore);
    expect((await readCatalogDocument({ homeDir })).entries).toHaveLength(1);
  });

  test("purge preserves Catalog identity when a new repository generation appears", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await seedRepository(repoRoot);
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "purge-recreated" });
    const plan = await inspectPurgePlan({ homeDir, repoRoot });

    const result = await purgeRepository(
      {
        homeDir,
        repoRoot,
        confirmed: true,
        planToken: plan.confirmationToken,
        acceptNoRecoveryExport: true,
      },
      {
        removeQuarantine: async (target) => {
          await rm(target, { recursive: true });
          await mkdir(join(repoRoot, ".bearing"));
          await writeFile(join(repoRoot, ".bearing/new-generation.txt"), "new\n");
        },
      },
    );

    expect(result).toMatchObject({
      outcome: "partial",
      catalog: { outcome: "failed", message: expect.stringContaining("new `.bearing` generation") },
    });
    expect((await readCatalogDocument({ homeDir })).entries).toEqual([
      expect.objectContaining({ entryId: "purge-recreated" }),
    ]);
    expect(await readFile(join(repoRoot, ".bearing/new-generation.txt"), "utf8")).toBe("new\n");
  });

  test("purge never removes a matching Catalog entry whose identity changed after review", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await seedRepository(repoRoot);
    await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "purge-reviewed-entry" });
    const plan = await inspectPurgePlan({ homeDir, repoRoot });
    const catalogRepoRoot = plan.inventory.catalogEntry?.repoRoot;
    if (catalogRepoRoot === undefined) throw new Error("Expected reviewed Catalog entry.");
    const replacement = {
      version: 1 as const,
      entries: [
        {
          entryId: "purge-new-entry",
          repoRoot: catalogRepoRoot,
          displayName: "Relinked project",
        },
      ],
    };

    const result = await purgeRepository(
      {
        homeDir,
        repoRoot,
        confirmed: true,
        planToken: plan.confirmationToken,
        acceptNoRecoveryExport: true,
      },
      {
        removeQuarantine: async (target) => {
          await rm(target, { recursive: true });
          await writeFile(
            join(homeDir, ".bearing/catalog.json"),
            `${JSON.stringify(replacement, null, 2)}\n`,
          );
        },
      },
    );

    expect(result).toMatchObject({
      outcome: "partial",
      catalog: { outcome: "failed", message: expect.stringContaining("identity changed") },
    });
    expect(await readCatalogDocument({ homeDir })).toEqual(replacement);
  });

  test("purge preserves a matching Catalog entry created after a no-entry review", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await seedRepository(repoRoot);
    const plan = await inspectPurgePlan({ homeDir, repoRoot });
    expect(plan.inventory.catalogEntry).toBeUndefined();
    const canonicalRoot = await realpath(repoRoot);

    const result = await purgeRepository(
      {
        homeDir,
        repoRoot,
        confirmed: true,
        planToken: plan.confirmationToken,
        acceptNoRecoveryExport: true,
      },
      {
        removeQuarantine: async (target) => {
          await rm(target, { recursive: true });
          await mkdir(join(homeDir, ".bearing"), { recursive: true });
          await writeFile(
            join(homeDir, ".bearing/catalog.json"),
            `${JSON.stringify(
              {
                version: 1,
                entries: [
                  {
                    entryId: "purge-late-entry",
                    repoRoot: canonicalRoot,
                    displayName: "Late entry",
                  },
                ],
              },
              null,
              2,
            )}\n`,
          );
        },
      },
    );

    expect(result).toMatchObject({
      outcome: "partial",
      catalog: { outcome: "failed", message: expect.stringContaining("unreviewed matching entry") },
    });
    expect((await readCatalogDocument({ homeDir })).entries[0]?.entryId).toBe("purge-late-entry");
  });

  test("reports a committed partial quarantine truthfully when purge cleanup fails", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
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

    expect(result.outcome).toBe("blocked");
    expect(result.repository.outcome).toBe("applied");
    expect(result.repository.cleanup).toMatchObject({ outcome: "residue" });
    if (result.repository.cleanup?.outcome !== "residue") {
      throw new Error("Expected typed purge cleanup residue.");
    }
    expect(result.repository.cleanup.message).toContain("no restoration was claimed");
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
    await expect(
      access(join(result.repository.cleanup.location, "state/first.md")),
    ).rejects.toThrow();
    expect(
      await readFile(join(result.repository.cleanup.location, "state/second.md"), "utf8"),
    ).toBe("second\n");
    expect(await readFile(join(repoRoot, ".scratch/work/evidence/result.md"), "utf8")).toBe(
      "durable\n",
    );
    expect(await readFile(join(repoRoot, "source.txt"), "utf8")).toBe("source stays\n");
    expect((await readCatalogDocument({ homeDir })).entries).toEqual([]);
  });

  test("setup fails closed instead of overwriting a newer repository schema", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await mkdir(join(repoRoot, ".bearing"));
    const contractLocator = "docs/agents/issue-tracker.md";
    await mkdir(join(repoRoot, "docs/agents"), { recursive: true });
    await writeFile(join(repoRoot, contractLocator), LOCAL_MATT_CONTRACT);
    await writeFile(join(repoRoot, "AGENTS.md"), standardMattAgentSurface(contractLocator));
    const manifestPath = join(repoRoot, ".bearing/manifest.json");
    const newer = `${JSON.stringify({ schemaVersion: 2, packageVersion: "0.2.0" })}\n`;
    await writeFile(manifestPath, newer);

    await expect(
      setupRepository({
        repoRoot,
        packageRoot: process.cwd(),
        surfaces: ["agent-skills"],
        profiles: [],
        provider: { key: "matt-skills/v1", contractLocator },
      }),
    ).rejects.toThrow("cannot interpret repository schema 2");
    expect(await readFile(manifestPath, "utf8")).toBe(newer);
  });
});
