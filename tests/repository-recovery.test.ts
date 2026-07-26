import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { upsertCatalogEntry } from "../src/catalog/store";
import {
  diagnoseRepositoryRecovery,
  inspectPurgePlan,
  purgeRepository,
} from "../src/repo-lifecycle";
import { setupRepository } from "../src/repo-setup";
import { makeTemporaryDirectory } from "./helpers";

const expectMissing = async (target: string): Promise<void> => {
  await expect(access(target)).rejects.toThrow();
};

const hash = (bytes: string | Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const seedStrictRecoveryBundle = async (bundleRoot: string): Promise<void> => {
  const createdAt = "2026-07-26T00:00:00.000Z";
  const payload = Buffer.from('{"schemaVersion":1}\n', "utf8");
  const inventory = `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: "bearing-recovery-bundle",
      createdAt,
      sourceSchema: "bearing-repository/v0.1.0",
      targetSchema: "bearing-repository/v0.1.1",
      entries: [
        {
          source: ".bearing/manifest.json",
          bundlePath: "repository/.bearing/manifest.json",
          sha256: hash(payload),
          bytes: payload.length,
          disposition: "replace",
        },
      ],
    },
    null,
    2,
  )}\n`;
  await mkdir(join(bundleRoot, "repository/.bearing"), { recursive: true });
  await writeFile(join(bundleRoot, "repository/.bearing/manifest.json"), payload);
  await writeFile(join(bundleRoot, "inventory.json"), inventory);
  await writeFile(
    join(bundleRoot, "receipt.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "bearing-recovery-bundle-receipt",
        createdAt,
        sourceSchema: "bearing-repository/v0.1.0",
        targetSchema: "bearing-repository/v0.1.1",
        inventoryHash: hash(inventory),
        entryCount: 1,
        verified: true,
      },
      null,
      2,
    )}\n`,
  );
};

const runPurgeCli = async (
  repoRoot: string,
  homeDir: string,
  extraArgs: readonly string[],
): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>> => {
  const child = Bun.spawn(
    ["bun", join(process.cwd(), "src/cli.ts"), "purge", "--repo", repoRoot, ...extraArgs],
    {
      env: { ...process.env, HOME: homeDir },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
};

const runSetupPlanCli = async (
  repoRoot: string,
  homeDir: string,
  extraArgs: readonly string[] = [],
): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>> => {
  const child = Bun.spawn(
    [
      "bun",
      join(process.cwd(), "src/cli.ts"),
      "setup",
      "--repo",
      repoRoot,
      "--surface",
      "agent-skills",
      "--plan",
      ...extraArgs,
    ],
    {
      env: { ...process.env, HOME: homeDir },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
};

const seedRepository = async (
  repoRoot: string,
  homeDir: string,
  catalogEntryId = "recovery-project",
): Promise<Readonly<{ agentsBefore: string }>> => {
  await mkdir(join(repoRoot, "docs/agents"), { recursive: true });
  await writeFile(
    join(repoRoot, "docs/agents/issue-tracker.md"),
    "# Issue tracker: Local Markdown\n\nProvider contract: `matt-skills/v1`\n",
  );
  await writeFile(
    join(repoRoot, "AGENTS.md"),
    "# User rules\n\nWork-management contract: `docs/agents/issue-tracker.md`\n",
  );
  await setupRepository({
    repoRoot,
    packageRoot: process.cwd(),
    surfaces: ["agent-skills"],
    profiles: [],
    provider: {
      key: "matt-skills/v1",
      contractLocator: "docs/agents/issue-tracker.md",
    },
  });
  await writeFile(join(repoRoot, ".bearing/state/retained.md"), "retained state\n");
  await mkdir(join(repoRoot, ".bearing/backups/retained"), { recursive: true });
  await writeFile(join(repoRoot, ".bearing/backups/retained/receipt.json"), '{"verified":true}\n');
  await mkdir(join(repoRoot, ".scratch/work/issues"), { recursive: true });
  await writeFile(join(repoRoot, ".scratch/work/issues/01-native.md"), "# Native\n");
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => catalogEntryId });
  return { agentsBefore: await readFile(join(repoRoot, "AGENTS.md"), "utf8") };
};

describe("Invalid/Unsupported diagnosis", () => {
  test("orders only diagnosis-proven recovery choices for newer, older, and corrupt manifests", async () => {
    const newerRoot = await makeTemporaryDirectory("bearing-recovery-newer-");
    const olderRoot = await makeTemporaryDirectory("bearing-recovery-older-");
    const corruptRoot = await makeTemporaryDirectory("bearing-recovery-corrupt-");
    await mkdir(join(newerRoot, ".bearing"), { recursive: true });
    await mkdir(join(olderRoot, ".bearing"), { recursive: true });
    await mkdir(join(corruptRoot, ".bearing/state"), { recursive: true });
    await writeFile(
      join(newerRoot, ".bearing/manifest.json"),
      '{"schemaVersion":2,"packageVersion":"0.2.0"}\n',
    );
    await writeFile(
      join(olderRoot, ".bearing/manifest.json"),
      '{"schemaVersion":1,"packageVersion":"0.1.0","surfaces":["agent-skills"],"executorProfiles":[]}\n',
    );
    await writeFile(join(corruptRoot, ".bearing/manifest.json"), "{broken\n");
    await writeFile(join(corruptRoot, ".bearing/state/project-summary.md"), "not valid state\n");

    const newer = await diagnoseRepositoryRecovery(newerRoot);
    const older = await diagnoseRepositoryRecovery(olderRoot);
    const corrupt = await diagnoseRepositoryRecovery(corruptRoot);

    expect(newer).toMatchObject({
      classification: "invalid-or-unsupported",
      applied: false,
      blockers: [
        {
          cause: "newer-schema",
          unsafeInputs: [".bearing/manifest.json"],
          recoveryChoices: [{ kind: "compatible-kit", owner: "package-manager", order: 1 }],
        },
      ],
    });
    expect(newer.blockers[0]?.recoveryChoices.map((choice) => choice.kind)).not.toContain("purge");
    expect(older).toMatchObject({
      classification: "legacy-cutover",
      applied: false,
      blockers: [
        {
          cause: "recognized-older-schema",
          recoveryChoices: [{ kind: "bounded-cutover", order: 1 }],
        },
      ],
    });
    expect(corrupt.classification).toBe("invalid-or-unsupported");
    expect(corrupt.blockers.map((blocker) => blocker.cause)).toEqual([
      "corrupt-manifest",
      "invalid-state-object",
    ]);
    expect(corrupt.blockers[0]?.recoveryChoices.map((choice) => choice.kind)).toEqual([
      "explicit-object-disposition",
      "purge",
    ]);

    const bundleRoot = join(corruptRoot, ".bearing/backups/verified");
    await seedStrictRecoveryBundle(bundleRoot);
    const withBundle = await diagnoseRepositoryRecovery(corruptRoot);
    expect(withBundle.blockers[0]?.recoveryChoices.map((choice) => choice.kind)).toEqual([
      "restore-bundle",
      "explicit-object-disposition",
      "purge",
    ]);
    expect(withBundle.blockers[0]?.recoveryChoices[0]?.mutationScope).toContain(
      "bearing-repository/v0.1.0",
    );

    await writeFile(join(bundleRoot, "unexpected.txt"), "not verified\n");
    const withInvalidatedBundle = await diagnoseRepositoryRecovery(corruptRoot);
    expect(
      withInvalidatedBundle.blockers[0]?.recoveryChoices.map((choice) => choice.kind),
    ).not.toContain("restore-bundle");
  });

  test("routes a broken configured dependency only to its owner without provider fallback", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-recovery-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-recovery-project-");
    await seedRepository(repoRoot, homeDir);
    await writeFile(
      join(repoRoot, "docs/agents/issue-tracker.md"),
      "# Issue tracker: Unsupported\n\nProvider contract: `matt-skills/v1`\n",
    );

    const diagnosis = await diagnoseRepositoryRecovery(repoRoot, homeDir);
    const providerBlocker = diagnosis.blockers.find(
      (blocker) => blocker.unsafeInputs[0] === "docs/agents/issue-tracker.md",
    );

    expect(diagnosis.classification).toBe("invalid-or-unsupported");
    expect(providerBlocker).toMatchObject({
      cause: "owner-dependency",
      recoveryChoices: [
        {
          kind: "owner-repair",
          owner: "matt-skills",
          mutationScope: expect.stringContaining("no provider"),
        },
      ],
    });
    expect(providerBlocker?.recoveryChoices.map((item) => item.kind)).not.toContain(
      "compatible-kit",
    );
  });

  test("real Setup plans expose newer, older, corrupt, invalid-State, and owner-repair truth", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-recovery-home-");
    const newerRoot = await makeTemporaryDirectory("bearing-recovery-newer-");
    const olderRoot = await makeTemporaryDirectory("bearing-recovery-older-");
    const corruptRoot = await makeTemporaryDirectory("bearing-recovery-corrupt-");
    const invalidRoot = await makeTemporaryDirectory("bearing-recovery-invalid-");
    const deactivatedRoot = await makeTemporaryDirectory("bearing-recovery-deactivated-");
    await mkdir(join(newerRoot, ".bearing"), { recursive: true });
    await mkdir(join(olderRoot, ".bearing"), { recursive: true });
    await mkdir(join(corruptRoot, ".bearing/state"), { recursive: true });
    await writeFile(
      join(newerRoot, ".bearing/manifest.json"),
      '{"schemaVersion":2,"packageVersion":"0.2.0"}\n',
    );
    await writeFile(
      join(olderRoot, ".bearing/manifest.json"),
      '{"schemaVersion":1,"packageVersion":"0.1.0","surfaces":["agent-skills"],"executorProfiles":[]}\n',
    );
    await writeFile(join(corruptRoot, ".bearing/manifest.json"), "{broken\n");
    await writeFile(join(corruptRoot, ".bearing/state/project-summary.md"), "invalid\n");
    await seedRepository(invalidRoot, homeDir);
    await seedRepository(deactivatedRoot, homeDir, "recovery-deactivated");
    await writeFile(join(invalidRoot, ".bearing/state/project-summary.md"), "invalid\n");
    await writeFile(
      join(invalidRoot, "docs/agents/issue-tracker.md"),
      "# Issue tracker: Unsupported\n\nProvider contract: `matt-skills/v1`\n",
    );
    const deactivatedManifestPath = join(deactivatedRoot, ".bearing/manifest.json");
    const deactivatedManifest = JSON.parse(await readFile(deactivatedManifestPath, "utf8"));
    await writeFile(
      deactivatedManifestPath,
      `${JSON.stringify({ ...deactivatedManifest, status: "deactivated" }, null, 2)}\n`,
    );
    await writeFile(join(deactivatedRoot, ".bearing/state/project-summary.md"), "invalid\n");

    const [newerResult, olderResult, corruptResult, invalidResult, deactivatedResult] =
      await Promise.all([
        runSetupPlanCli(newerRoot, homeDir),
        runSetupPlanCli(olderRoot, homeDir),
        runSetupPlanCli(corruptRoot, homeDir),
        runSetupPlanCli(invalidRoot, homeDir),
        runSetupPlanCli(deactivatedRoot, homeDir, ["--confirm-reactivate"]),
      ]);
    expect(newerResult.exitCode, newerResult.stderr).toBe(0);
    expect(olderResult.exitCode, olderResult.stderr).toBe(0);
    expect(corruptResult.exitCode, corruptResult.stderr).toBe(0);
    expect(invalidResult.exitCode, invalidResult.stderr).toBe(0);
    expect(deactivatedResult.exitCode, deactivatedResult.stderr).toBe(0);

    const newer = JSON.parse(newerResult.stdout);
    const older = JSON.parse(olderResult.stdout);
    const corrupt = JSON.parse(corruptResult.stdout);
    const invalid = JSON.parse(invalidResult.stdout);
    const deactivated = JSON.parse(deactivatedResult.stdout);
    expect(newer).toMatchObject({
      lifecycle: { kind: "invalid-or-unsupported" },
      recoveryDiagnosis: {
        applied: false,
        blockers: [{ cause: "newer-schema" }],
      },
    });
    expect(older).toMatchObject({
      lifecycle: { kind: "active", legacyTransitionRequired: true },
      canApply: false,
    });
    expect(corrupt).toMatchObject({
      lifecycle: { kind: "invalid-or-unsupported" },
      recoveryDiagnosis: {
        blockers: [{ cause: "corrupt-manifest" }, { cause: "invalid-state-object" }],
      },
    });
    expect(invalid.lifecycle.kind).toBe("invalid-or-unsupported");
    expect(invalid.recoveryDiagnosis.blockers.map((item: { cause: string }) => item.cause)).toEqual(
      expect.arrayContaining(["invalid-state-object", "owner-dependency"]),
    );
    expect(deactivated).toMatchObject({
      canApply: false,
      lifecycle: { kind: "invalid-or-unsupported" },
      recoveryDiagnosis: {
        blockers: [{ cause: "invalid-state-object" }],
      },
    });
  });
});

describe("confirmed repository Purge planning", () => {
  test("real CLI cancellation prints the reviewed plan and confirmation consumes its token", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-recovery-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-recovery-project-");
    await seedRepository(repoRoot, homeDir);

    const cancelled = await runPurgeCli(repoRoot, homeDir, []);
    expect(cancelled.exitCode, cancelled.stderr).toBe(0);
    const plan = JSON.parse(cancelled.stdout);
    const confirmationToken = plan.confirmationToken as string;
    expect(plan).toMatchObject({
      outcome: "cancelled",
      canPurge: true,
      confirmationToken: expect.stringMatching(/^sha256:/),
    });
    await access(join(repoRoot, ".bearing/manifest.json"));

    const applied = await runPurgeCli(repoRoot, homeDir, [
      "--confirm-purge",
      "--purge-plan-token",
      confirmationToken,
      "--accept-no-recovery-export",
    ]);
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(applied.stdout).toContain("Outcome: applied");
    await expectMissing(join(repoRoot, ".bearing"));
  });

  test("returns an exact no-write inventory with a generation-bound token", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-recovery-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-recovery-project-");
    const fixture = await seedRepository(repoRoot, homeDir);

    const plan = await inspectPurgePlan({ homeDir, repoRoot });

    expect(plan).toMatchObject({
      canPurge: true,
      confirmationToken: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      inventory: {
        namespace: expect.arrayContaining([
          expect.objectContaining({ target: ".bearing/manifest.json", kind: "file" }),
          expect.objectContaining({
            target: ".bearing/backups/retained/receipt.json",
            kind: "file",
          }),
        ]),
        managedBlocks: [expect.objectContaining({ target: "AGENTS.md#bearing-managed-block" })],
        catalogEntry: expect.objectContaining({ entryId: "recovery-project" }),
      },
      preserved: [
        "Matt-native work",
        "repository source and documentation",
        "external Asset payloads",
        "global Bearing kit",
      ],
    });
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(fixture.agentsBefore);
    await access(join(repoRoot, ".bearing/manifest.json"));
  });

  test("blocks destructive planning for older/newer schema and an untrustworthy Catalog", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-recovery-home-");
    const degradedHome = await makeTemporaryDirectory("bearing-recovery-degraded-home-");
    const newerRoot = await makeTemporaryDirectory("bearing-recovery-newer-");
    const olderRoot = await makeTemporaryDirectory("bearing-recovery-older-");
    const catalogRoot = await makeTemporaryDirectory("bearing-recovery-catalog-");
    const degradedRoot = await makeTemporaryDirectory("bearing-recovery-degraded-");
    await mkdir(join(newerRoot, ".bearing"), { recursive: true });
    await mkdir(join(olderRoot, ".bearing"), { recursive: true });
    await mkdir(join(catalogRoot, ".bearing/state"), { recursive: true });
    await mkdir(join(degradedRoot, ".bearing/state"), { recursive: true });
    await writeFile(
      join(newerRoot, ".bearing/manifest.json"),
      '{"schemaVersion":2,"packageVersion":"0.2.0"}\n',
    );
    await writeFile(
      join(olderRoot, ".bearing/manifest.json"),
      '{"schemaVersion":1,"packageVersion":"0.1.0","surfaces":["agent-skills"],"executorProfiles":[]}\n',
    );
    await writeFile(join(catalogRoot, ".bearing/manifest.json"), "{broken\n");
    await writeFile(join(degradedRoot, ".bearing/manifest.json"), "{broken\n");
    await mkdir(join(homeDir, ".bearing"), { recursive: true });
    await writeFile(join(homeDir, ".bearing/catalog.json"), "{broken\n");
    await writeFile(join(homeDir, ".bearing/catalog.backup.json"), "{broken\n");
    await mkdir(join(degradedHome, ".bearing"), { recursive: true });
    await writeFile(join(degradedHome, ".bearing/catalog.json"), "{broken\n");
    await writeFile(
      join(degradedHome, ".bearing/catalog.backup.json"),
      '{"version":1,"entries":[]}\n',
    );

    const [newer, older, catalog, degraded] = await Promise.all([
      inspectPurgePlan({ homeDir, repoRoot: newerRoot }),
      inspectPurgePlan({ homeDir, repoRoot: olderRoot }),
      inspectPurgePlan({ homeDir, repoRoot: catalogRoot }),
      inspectPurgePlan({ homeDir: degradedHome, repoRoot: degradedRoot }),
    ]);

    expect(newer.canPurge).toBe(false);
    expect(newer.blockers[0]).toContain("newer repository schema");
    expect(older.canPurge).toBe(false);
    expect(older.blockers[0]).toContain("0.1.0 repository");
    expect(catalog.canPurge).toBe(false);
    expect(catalog.blockers[0]).toContain("Catalog requires owner repair");
    expect(degraded.canPurge).toBe(false);
    expect(degraded.blockers).toContain(
      "The Project Catalog is degraded; repair its trustworthy backup before Purge.",
    );
  });

  test("fails closed for a root namespace file and unregistered managed-block markers", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-recovery-home-");
    const fileRoot = await makeTemporaryDirectory("bearing-recovery-file-root-");
    const ambiguousRoot = await makeTemporaryDirectory("bearing-recovery-ambiguous-root-");
    await writeFile(join(fileRoot, ".bearing"), "not a directory\n");
    await mkdir(join(ambiguousRoot, ".bearing/state"), { recursive: true });
    await writeFile(join(ambiguousRoot, ".bearing/manifest.json"), "{broken\n");
    const agents = `# User rules

<!-- bearing:managed-start -->
For every project request, load and follow the global \`bearing\` skill as the governing runbook.
<!-- bearing:managed-end -->
`;
    await writeFile(join(ambiguousRoot, "AGENTS.md"), agents);

    const filePlan = await inspectPurgePlan({ homeDir, repoRoot: fileRoot });
    const ambiguousPlan = await inspectPurgePlan({ homeDir, repoRoot: ambiguousRoot });
    const ambiguousDiagnosis = await diagnoseRepositoryRecovery(ambiguousRoot);

    expect(filePlan.canPurge).toBe(false);
    expect(filePlan.blockers).toContain(
      "The root `.bearing` namespace is not a directory and Purge fails closed.",
    );
    expect(ambiguousPlan.canPurge).toBe(false);
    expect(ambiguousPlan.inventory.managedBlocks).toEqual([]);
    expect(ambiguousPlan.blockers.join(" ")).toContain("cannot prove registration authority");
    expect(
      ambiguousDiagnosis.blockers.flatMap((blocker) =>
        blocker.recoveryChoices.map((candidate) => candidate.kind),
      ),
    ).not.toContain("purge");
    await expect(
      purgeRepository({
        homeDir,
        repoRoot: ambiguousRoot,
        confirmed: true,
        planToken: ambiguousPlan.confirmationToken,
        acceptNoRecoveryExport: true,
      }),
    ).rejects.toThrow("blocked");
    expect(await readFile(join(ambiguousRoot, "AGENTS.md"), "utf8")).toBe(agents);
  });

  test("distinguishes a trustworthy Catalog backup from a fully failed Catalog", async () => {
    const degradedHome = await makeTemporaryDirectory("bearing-recovery-degraded-home-");
    const failedHome = await makeTemporaryDirectory("bearing-recovery-failed-home-");
    const degradedRoot = await makeTemporaryDirectory("bearing-recovery-degraded-project-");
    const failedRoot = await makeTemporaryDirectory("bearing-recovery-failed-project-");
    await seedRepository(degradedRoot, degradedHome);
    await seedRepository(failedRoot, failedHome);
    await writeFile(join(degradedHome, ".bearing/catalog.json"), "{broken\n");
    await writeFile(join(failedHome, ".bearing/catalog.json"), "{broken\n");
    await writeFile(join(failedHome, ".bearing/catalog.backup.json"), "{also-broken\n");

    const degraded = await diagnoseRepositoryRecovery(degradedRoot, degradedHome);
    const failed = await diagnoseRepositoryRecovery(failedRoot, failedHome);
    const degradedCatalog = degraded.blockers.find((item) => item.cause === "catalog-conflict");
    const failedCatalog = failed.blockers.find((item) => item.cause === "catalog-conflict");

    expect(degradedCatalog?.trustworthyInputs).toContain("$HOME/.bearing/catalog.backup.json");
    expect(degradedCatalog?.recoveryChoices[0]?.nextAction).toContain("trustworthy Catalog backup");
    expect(failedCatalog?.trustworthyInputs).not.toContain("$HOME/.bearing/catalog.backup.json");
    expect(failedCatalog?.recoveryChoices[0]?.nextAction).toContain("empty Catalog reset");
    expect(failedCatalog?.recoveryChoices[0]?.nextAction).not.toContain("backup");
  });

  test("requires the exact inspected token and one explicit export disposition", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-recovery-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-recovery-project-");
    await seedRepository(repoRoot, homeDir);
    const plan = await inspectPurgePlan({ homeDir, repoRoot });

    await expect(
      purgeRepository({
        homeDir,
        repoRoot,
        confirmed: true,
        planToken: plan.confirmationToken,
      }),
    ).rejects.toThrow("recovery export");
    await expect(
      purgeRepository({
        homeDir,
        repoRoot,
        confirmed: true,
        planToken: `sha256:${"0".repeat(64)}`,
        acceptNoRecoveryExport: true,
      }),
    ).rejects.toThrow("generation changed");

    await access(join(repoRoot, ".bearing/manifest.json"));
  });

  test("exports a verified recovery snapshot before removing the reviewed generation", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-recovery-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-recovery-project-");
    await seedRepository(repoRoot, homeDir);
    const exportParent = await makeTemporaryDirectory("bearing-recovery-export-parent-");
    const exportRoot = join(exportParent, "bearing-export");
    const plan = await inspectPurgePlan({ homeDir, repoRoot });

    const result = await purgeRepository({
      homeDir,
      repoRoot,
      confirmed: true,
      planToken: plan.confirmationToken,
      recoveryExport: exportRoot,
    });

    expect(result.outcome).toBe("applied");
    await expectMissing(join(repoRoot, ".bearing"));
    expect(await readFile(join(exportRoot, "repository/.bearing/state/retained.md"), "utf8")).toBe(
      "retained state\n",
    );
    expect(JSON.parse(await readFile(join(exportRoot, "inventory.json"), "utf8"))).toMatchObject({
      kind: "bearing-purge-recovery-export",
      verified: true,
      sourcePlanToken: plan.confirmationToken,
    });
  });

  test("purges an identifiable invalid 0.1.1 namespace but refuses unsafe owned targets", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-recovery-home-");
    const invalidRoot = await makeTemporaryDirectory("bearing-recovery-invalid-");
    const unsafeRoot = await makeTemporaryDirectory("bearing-recovery-unsafe-");
    const outside = await makeTemporaryDirectory("bearing-recovery-outside-");
    await mkdir(join(invalidRoot, ".bearing/state"), { recursive: true });
    await writeFile(join(invalidRoot, ".bearing/manifest.json"), "{broken\n");
    await writeFile(join(invalidRoot, ".bearing/state/retained.md"), "retained\n");
    await mkdir(join(unsafeRoot, ".bearing/state"), { recursive: true });
    await writeFile(join(unsafeRoot, ".bearing/manifest.json"), "{broken\n");
    await writeFile(join(outside, "external.md"), "external\n");
    await symlink(join(outside, "external.md"), join(unsafeRoot, ".bearing/state/external.md"));

    const plan = await inspectPurgePlan({ homeDir, repoRoot: invalidRoot });
    expect(plan.canPurge).toBe(true);
    await purgeRepository({
      homeDir,
      repoRoot: invalidRoot,
      confirmed: true,
      planToken: plan.confirmationToken,
      acceptNoRecoveryExport: true,
    });
    await expectMissing(join(invalidRoot, ".bearing"));

    await expect(inspectPurgePlan({ homeDir, repoRoot: unsafeRoot })).rejects.toThrow(
      "unsafe Bearing-owned target",
    );
    expect(await readFile(join(outside, "external.md"), "utf8")).toBe("external\n");
  });

  test("reports committed repository Purge and resumable Catalog cleanup separately", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-recovery-home-");
    const repoRoot = await makeTemporaryDirectory("bearing-recovery-project-");
    await seedRepository(repoRoot, homeDir);
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
          await writeFile(join(homeDir, ".bearing/catalog.json"), "{broken\n");
        },
      },
    );

    expect(result).toMatchObject({
      outcome: "partial",
      repository: { outcome: "applied", cleanup: { outcome: "complete" } },
      catalog: { outcome: "failed", message: expect.stringContaining("repair") },
    });
    await expectMissing(join(repoRoot, ".bearing"));
  });
});
