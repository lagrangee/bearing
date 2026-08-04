import { beforeAll, describe, expect, test } from "bun:test";
import { access, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeInstallTarget } from "../src/installer";
import { cutOverLegacyRepository, inspectLegacyCutoverPlan } from "../src/repository-cutover";
import { prepareSync } from "../src/sync-plan";
import { standardGitHubMattContract } from "./fixtures/github-matt-api";
import {
  LOCAL_MATT_CONTRACT,
  LOCAL_MATT_TRIAGE_LABELS,
  makeTemporaryDirectory,
  standardMattAgentSurface,
  writeFixture,
} from "./helpers";

const CUTOVER_AT = "2026-07-26T12:34:56.000Z";
const BUNDLE_NAME = "0.1.0-to-0.1.1-20260726T123456000Z";

const runSetupCli = async (
  repoRoot: string,
  homeDir: string,
  extraArgs: readonly string[],
): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>> => {
  const child = Bun.spawn(
    [
      "node",
      join(process.cwd(), "dist/cli.js"),
      "setup",
      "--repo",
      repoRoot,
      "--surface",
      "agent-skills",
      "--provider-contract",
      "docs/agents/issue-tracker.md",
      "--cutover-at",
      CUTOVER_AT,
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

const legacyEffort = (id = "effort:test", gate = "gate:test"): string => `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: ${id}
Title: Test Effort
Roadmap: roadmap:test
Target gate: ${gate}
Authorities: []
Citations: []
---

# Effort: Test

## Intent

Preserve this planning meaning.

## Work

- [Map](map.md)
`;

const createLegacyRepository = async (): Promise<string> => {
  const root = await makeTemporaryDirectory("bearing-cutover-");
  await writeFixture(
    root,
    ".bearing/manifest.json",
    `${JSON.stringify(
      {
        schemaVersion: 1,
        packageVersion: "0.1.0",
        surfaces: ["agent-skills"],
        executorProfiles: ["generic-agent"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFixture(root, ".bearing/executor-profiles/generic-agent.md", "# Generic legacy\n");
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    `---
Type: project-summary
ID: project-summary:current
Title: Test
---

# Project Summary: Test

## Purpose

Test cutover.

## Current Design

Legacy sidecar.

## Boundaries

- Preserve native work.

## Future Candidates

- None.

## Material Revisions

- None.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmap-index.md",
    `---
Type: roadmap-index
Roadmaps:
  - roadmap:test
---

# Roadmap Index
`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    `---
Type: roadmap
ID: roadmap:test
Title: Test
Status: active
Focused gate: gate:test
Gate order:
  - gate:test
---

# Roadmap: Test

## Intent

Test.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    `---
Type: milestone-gate
ID: gate:test
Title: Test
Roadmap: roadmap:test
Status: active
Effort order:
  - effort:test
---

# Milestone Gate: Test

## Intent

Test.

## Exit Criteria

- Done.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets: []
---

# Asset Registry
`,
  );
  await writeFixture(root, ".scratch/test/effort.md", legacyEffort());
  await writeFixture(
    root,
    ".scratch/test/map.md",
    "# Native Map\n\nStatus: resolved\n\n## Destination\n\nTest.\n\n## Decisions so far\n\n- [Finish](issues/01-finish.md) — Done.\n\n## Fog\n",
  );
  await writeFixture(
    root,
    ".scratch/test/issues/01-finish.md",
    "# Native Ticket\n\nType: task\n\nStatus: resolved\n\n## Question\n\nTest?\n\n## Answer\n\nYes.\n",
  );
  await writeFixture(root, "docs/agents/issue-tracker.md", LOCAL_MATT_CONTRACT);
  await writeFixture(root, "docs/agents/triage-labels.md", LOCAL_MATT_TRIAGE_LABELS);
  await writeFixture(
    root,
    "AGENTS.md",
    `${standardMattAgentSurface()}
<!-- bearing:managed-start -->
Legacy Bearing pointer.
<!-- bearing:managed-end -->
`,
  );
  await writeFixture(root, ".bearing/cache/stale.txt", "discard me\n");
  return root;
};

const expectMissing = async (target: string): Promise<void> => {
  await expect(access(target)).rejects.toThrow();
};

const inspectCliToken = async (repoRoot: string, homeDir: string): Promise<string> => {
  const result = await runSetupCli(repoRoot, homeDir, ["--plan"]);
  expect(result.exitCode, result.stderr).toBe(0);
  return JSON.parse(result.stdout).cutover.confirmationToken as string;
};

describe("0.1.0 repository cutover", () => {
  beforeAll(async () => {
    const result = await Bun.build({
      entrypoints: [join(process.cwd(), "src/cli.ts")],
      outdir: join(process.cwd(), "dist"),
      target: "node",
    });
    if (!result.success) throw new Error("Cutover tests could not build the CLI.");
  });

  test("returns the exact read-only cutover plan before either consent", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    const manifestBefore = await readFile(join(repoRoot, ".bearing/manifest.json"));

    const result = await runSetupCli(repoRoot, homeDir, ["--plan"]);

    expect(result.exitCode, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout);
    expect(plan).toMatchObject({
      lifecycle: { kind: "invalid-or-unsupported" },
      recoveryDiagnosis: {
        classification: "legacy-cutover",
        blockers: [{ cause: "recognized-older-schema" }],
      },
      canApply: false,
      cutover: {
        sourceSchema: "bearing-repository/v0.1.0",
        targetSchema: "bearing-repository/v0.1.1",
        recoveryBundlePath: `.bearing/backups/${BUNDLE_NAME}`,
        confirmationToken: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        objectCounts: {
          efforts: 1,
          legacyProfiles: 1,
          managedBlocks: 1,
        },
        preservedNativeScopes: [".scratch/test"],
        excludedFromRecoveryBundle: [
          "cache",
          "Matt-native work",
          "unmanaged content",
          "external Assets",
        ],
      },
    });
    expect(plan.cutover.pathDispositions).toEqual(
      expect.arrayContaining([
        {
          target: ".bearing/state/efforts/test.md",
          disposition: "create-or-replace",
        },
        {
          target: ".scratch/test/effort.md",
          disposition: "remove",
        },
      ]),
    );
    expect(await readFile(join(repoRoot, ".bearing/manifest.json"))).toEqual(manifestBefore);
    await expectMissing(join(repoRoot, ".bearing/backups"));
  });

  test("validates reference-rich legacy truth only through the explicit cutover route", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    await writeFixture(
      repoRoot,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:legacy-proof
    Title: Legacy Proof
    Kind: verification-report
    Location: .scratch/test/issues/01-finish.md
    Owner: effort:test
    Producer:
      Kind: agent-surface
      Name: codex
    Lifecycle source: native
---

# Asset Registry
`,
    );

    const normal = await prepareSync(repoRoot);
    expect(normal.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "broken-canonical-reference",
        target: ".bearing/state/assets.md",
      }),
    );

    const result = await runSetupCli(repoRoot, homeDir, ["--plan"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).cutover.objectCounts.efforts).toBe(1);
    expect(await readFile(join(repoRoot, ".bearing/state/assets.md"), "utf8")).toContain(
      "Owner: effort:test",
    );
  });

  test("requires distinct upgrade-direction and inspected-Apply consent without mutation", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    const manifestBefore = await readFile(join(repoRoot, ".bearing/manifest.json"));

    const firstRefusal = await runSetupCli(repoRoot, homeDir, []);
    expect(firstRefusal.exitCode).toBe(1);
    expect(firstRefusal.stderr).toContain("accept-upgrade-direction");
    expect(await readFile(join(repoRoot, ".bearing/manifest.json"))).toEqual(manifestBefore);
    await expectMissing(join(repoRoot, ".bearing/backups"));

    const secondRefusal = await runSetupCli(repoRoot, homeDir, ["--accept-upgrade-direction"]);
    expect(secondRefusal.exitCode).toBe(1);
    expect(secondRefusal.stderr).toContain("confirm-cutover");
    expect(await readFile(join(repoRoot, ".bearing/manifest.json"))).toEqual(manifestBefore);
    await expectMissing(join(repoRoot, ".bearing/backups"));
  });

  test("reports a consented plan as applicable only with the exact generation token", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    const confirmationToken = await inspectCliToken(repoRoot, homeDir);

    const wrong = await runSetupCli(repoRoot, homeDir, [
      "--plan",
      "--accept-upgrade-direction",
      "--confirm-cutover",
      "--cutover-plan-token",
      "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    ]);
    const exact = await runSetupCli(repoRoot, homeDir, [
      "--plan",
      "--accept-upgrade-direction",
      "--confirm-cutover",
      "--cutover-plan-token",
      confirmationToken,
    ]);

    expect(wrong.exitCode, wrong.stderr).toBe(0);
    expect(JSON.parse(wrong.stdout).canApply).toBe(false);
    expect(exact.exitCode, exact.stderr).toBe(0);
    expect(JSON.parse(exact.stdout).canApply).toBe(true);
    await expectMissing(join(repoRoot, ".bearing/backups"));
  });

  test("refuses to infer a GitHub scope root from legacy local sidecars", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    await writeFile(join(repoRoot, "docs/agents/issue-tracker.md"), standardGitHubMattContract);

    const result = await runSetupCli(repoRoot, homeDir, ["--plan"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("explicit GitHub scope root");
    await expectMissing(join(repoRoot, ".bearing/backups"));
  });

  test("rejects an unsafe optional legacy source before reading it", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    const externalRoot = await makeTemporaryDirectory("bearing-cutover-external-");
    const externalProvider = join(externalRoot, "provider.json");
    await writeFile(externalProvider, '{"external":true}\n');
    await symlink(externalProvider, join(repoRoot, ".bearing/provider.json"));

    const result = await runSetupCli(repoRoot, homeDir, ["--plan"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Optional cutover source must be one safe single-link file");
    expect(await readFile(externalProvider, "utf8")).toBe('{"external":true}\n');
    await expectMissing(join(repoRoot, ".bearing/backups"));
  });

  test("cuts over through a verified retained Recovery Bundle and preserves native work", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    const nativeMap = await readFile(join(repoRoot, ".scratch/test/map.md"));
    const nativeTicket = await readFile(join(repoRoot, ".scratch/test/issues/01-finish.md"));
    const confirmationToken = await inspectCliToken(repoRoot, homeDir);

    const result = await runSetupCli(repoRoot, homeDir, [
      "--accept-upgrade-direction",
      "--confirm-cutover",
      "--cutover-plan-token",
      confirmationToken,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Outcome: applied");
    expect(result.stdout).toContain(`Recovery bundle: .bearing/backups/${BUNDLE_NAME}`);
    expect(result.stdout).toContain(
      "Cutover schema: bearing-repository/v0.1.0 -> bearing-repository/v0.1.1",
    );
    expect(result.stdout).toContain("Recovery verification: verified");
    expect(result.stdout).toContain("Target validation: zero-diagnostics");
    expect(JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      packageVersion: "0.1.0",
      status: "active",
      surfaces: ["agent-skills"],
      executorProfiles: [],
    });
    const effort = await readFile(join(repoRoot, ".bearing/state/efforts/test.md"), "utf8");
    expect(effort).toContain("Work binding:");
    expect(effort).toContain("Provider: matt-skills/v1");
    expect(effort).not.toContain("Driver:");
    expect(effort).toContain("Native scope: .scratch/test");
    await expectMissing(join(repoRoot, ".scratch/test/effort.md"));
    await expectMissing(join(repoRoot, ".bearing/executor-profiles/generic-agent.md"));
    await expectMissing(join(repoRoot, ".bearing/cache/stale.txt"));
    expect(await readFile(join(repoRoot, ".scratch/test/map.md"))).toEqual(nativeMap);
    expect(await readFile(join(repoRoot, ".scratch/test/issues/01-finish.md"))).toEqual(
      nativeTicket,
    );
    const postCutover = await prepareSync(repoRoot);
    expect(postCutover.inputs).toContain(".bearing/state/efforts/test.md");
    const effortContext = postCutover.planningGraph.contextFor({
      kind: "effort",
      id: "effort:test",
    });
    expect(effortContext.state, JSON.stringify(effortContext)).toBe("complete");
    expect(effortContext.context?.effort.value.workBinding?.provider).toBe("matt-skills/v1");
    expect(String(effortContext.context?.effort.value.workBinding?.nativeScope)).toBe(
      ".scratch/test",
    );
    const capture = effortContext.context?.providerCapture;
    if (capture === undefined || (capture.state !== "available" && capture.state !== "partial")) {
      throw new Error("Expected the cut-over provider capture.");
    }
    expect(String(capture.projection.map?.ref)).toBe(".scratch/test/map.md");
    expect(capture.projection.wayfinderTickets.map((ticket) => String(ticket.ref))).toEqual([
      ".scratch/test/issues/01-finish.md",
    ]);

    const bundleRoot = join(repoRoot, ".bearing/backups", BUNDLE_NAME);
    const inventory = JSON.parse(await readFile(join(bundleRoot, "inventory.json"), "utf8"));
    const receipt = JSON.parse(await readFile(join(bundleRoot, "receipt.json"), "utf8"));
    expect(inventory).toMatchObject({
      sourceSchema: "bearing-repository/v0.1.0",
      targetSchema: "bearing-repository/v0.1.1",
    });
    expect(inventory.entries.map((entry: { source: string }) => entry.source)).toEqual(
      expect.arrayContaining([
        ".bearing/manifest.json",
        ".bearing/state/project-summary.md",
        ".scratch/test/effort.md",
        "AGENTS.md#bearing-managed-block",
      ]),
    );
    expect(inventory.entries.map((entry: { source: string }) => entry.source)).not.toContain(
      ".scratch/test/map.md",
    );
    expect(
      inventory.entries.find(
        (entry: { source: string }) => entry.source === "AGENTS.md#bearing-managed-block",
      ),
    ).toMatchObject({
      bundlePath: "managed-blocks/AGENTS.md",
      filePrecondition: {
        sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        bytes: expect.any(Number),
        mode: 0o644,
      },
    });
    expect(receipt).toMatchObject({ verified: true, inventoryHash: expect.any(String) });

    const replay = await runSetupCli(repoRoot, homeDir, [
      "--accept-upgrade-direction",
      "--confirm-cutover",
      "--cutover-plan-token",
      confirmationToken,
    ]);
    expect(replay.exitCode, replay.stderr).toBe(0);
    expect(replay.stdout).toContain("Outcome: no-op");
    expect(replay.stdout).toContain("Repository: no-op");
    expect(replay.stdout).toContain("Catalog: no-op");
  });

  test("replays consumed cutover flags through Active reconciliation after Catalog partial", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    await writeFixture(homeDir, ".bearing/catalog.json", "{malformed\n");
    const confirmationToken = await inspectCliToken(repoRoot, homeDir);
    const cutoverArgs = [
      "--accept-upgrade-direction",
      "--confirm-cutover",
      "--cutover-plan-token",
      confirmationToken,
    ] as const;

    const partial = await runSetupCli(repoRoot, homeDir, cutoverArgs);

    expect(partial.exitCode).toBe(1);
    expect(partial.stdout).toContain("Outcome: partial");
    expect(partial.stdout).toContain("Repository: applied");
    expect(partial.stdout).toContain("Catalog: failed");
    expect(
      JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({ status: "active", executorProfiles: [] });
    await access(join(repoRoot, ".bearing/state/efforts/test.md"));
    await access(join(repoRoot, ".bearing/backups", BUNDLE_NAME, "receipt.json"));

    await writeFile(join(homeDir, ".bearing/catalog.json"), '{"version":1,"entries":[]}\n');
    const replay = await runSetupCli(repoRoot, homeDir, cutoverArgs);

    expect(replay.exitCode, replay.stderr).toBe(0);
    expect(replay.stdout).toContain("Outcome: applied");
    expect(replay.stdout).toContain("Repository: no-op");
    expect(replay.stdout).toContain("Catalog: applied");
  });

  test("rejects a pre-existing invalid bundle before conversion", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    const manifestBefore = await readFile(join(repoRoot, ".bearing/manifest.json"));
    const confirmationToken = await inspectCliToken(repoRoot, homeDir);
    await writeFixture(
      repoRoot,
      `.bearing/backups/${BUNDLE_NAME}/inventory.json`,
      '{"invalid":true}\n',
    );

    const result = await runSetupCli(repoRoot, homeDir, [
      "--accept-upgrade-direction",
      "--confirm-cutover",
      "--cutover-plan-token",
      confirmationToken,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Recovery Bundle");
    expect(await readFile(join(repoRoot, ".bearing/manifest.json"))).toEqual(manifestBefore);
    expect(
      await readFile(join(repoRoot, `.bearing/backups/${BUNDLE_NAME}/inventory.json`), "utf8"),
    ).toBe('{"invalid":true}\n');
  });

  test("invalidates final consent when the reviewed repository generation changes", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    const confirmationToken = await inspectCliToken(repoRoot, homeDir);
    const reviewedAgents = await readFile(join(repoRoot, "AGENTS.md"), "utf8");
    await writeFile(
      join(repoRoot, "AGENTS.md"),
      `# Concurrent user instruction\n\n${reviewedAgents}`,
    );

    const result = await runSetupCli(repoRoot, homeDir, [
      "--accept-upgrade-direction",
      "--confirm-cutover",
      "--cutover-plan-token",
      confirmationToken,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("generation changed");
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(
      `# Concurrent user instruction\n\n${reviewedAgents}`,
    );
    await expectMissing(join(repoRoot, ".bearing/backups"));
  });

  test("fails closed on broken references and duplicate Effort identities", async () => {
    const brokenRoot = await createLegacyRepository();
    const duplicateRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    await writeFile(
      join(brokenRoot, ".scratch/test/effort.md"),
      legacyEffort("effort:test", "gate:missing"),
    );
    await writeFixture(duplicateRoot, ".scratch/other/effort.md", legacyEffort());

    const broken = await runSetupCli(brokenRoot, homeDir, [
      "--accept-upgrade-direction",
      "--confirm-cutover",
      "--cutover-plan-token",
      "sha256:invalid",
    ]);
    const duplicate = await runSetupCli(duplicateRoot, homeDir, [
      "--accept-upgrade-direction",
      "--confirm-cutover",
      "--cutover-plan-token",
      "sha256:invalid",
    ]);

    expect(broken.exitCode).toBe(1);
    expect(broken.stderr).toContain("broken");
    expect(duplicate.exitCode).toBe(1);
    expect(duplicate.stderr).toContain("Duplicate Effort identity");
    await expectMissing(join(brokenRoot, ".bearing/backups"));
    await expectMissing(join(duplicateRoot, ".bearing/backups"));
  });

  test("fails closed on an ambiguous legacy profile directory", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    await writeFixture(
      repoRoot,
      ".bearing/executor-profiles/unregistered-template.md",
      "# Unknown copied template\n",
    );

    const result = await runSetupCli(repoRoot, homeDir, ["--plan"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Profile inventory is ambiguous");
    await expectMissing(join(repoRoot, ".bearing/backups"));
  });

  test("does not issue a cutover token before the selected surface points at the provider", async () => {
    const repoRoot = await createLegacyRepository();
    const homeDir = await makeTemporaryDirectory("bearing-cutover-home-");
    await writeFile(
      join(repoRoot, "AGENTS.md"),
      "<!-- bearing:managed-start -->\nLegacy Bearing pointer.\n<!-- bearing:managed-end -->\n",
    );

    const result = await runSetupCli(repoRoot, homeDir, ["--plan"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "every selected Agent Surface to point at one trustworthy matt-skills/v1 provider contract",
    );
    expect(result.stdout).not.toContain("confirmationToken");
    await expectMissing(join(repoRoot, ".bearing/backups"));
  });

  test("removes a partial Recovery Bundle when its atomic write fails", async () => {
    const repoRoot = await createLegacyRepository();
    const plan = await inspectLegacyCutoverPlan(repoRoot, {
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider: {
        key: "matt-skills/v1",
        contractLocator: "docs/agents/issue-tracker.md",
      },
      cutoverAt: CUTOVER_AT,
    });

    await expect(
      cutOverLegacyRepository(
        repoRoot,
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: [],
          provider: {
            key: "matt-skills/v1",
            contractLocator: "docs/agents/issue-tracker.md",
          },
          acceptUpgradeDirection: true,
          confirmCutover: true,
          cutoverAt: CUTOVER_AT,
          cutoverPlanToken: plan.confirmationToken,
        },
        {
          writeRecoveryTarget: async (target, ordinal) => {
            if (ordinal === 1) throw new Error("simulated Recovery Bundle write failure");
            await writeInstallTarget(target, ordinal);
          },
        },
      ),
    ).rejects.toThrow("all written targets were restored");

    await expectMissing(join(repoRoot, ".bearing/backups"));
    expect(
      JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")),
    ).not.toHaveProperty("status");
  });

  test("rolls conversion back while retaining verified recovery evidence", async () => {
    const repoRoot = await createLegacyRepository();
    const manifestBefore = await readFile(join(repoRoot, ".bearing/manifest.json"));
    const plan = await inspectLegacyCutoverPlan(repoRoot, {
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider: {
        key: "matt-skills/v1",
        contractLocator: "docs/agents/issue-tracker.md",
      },
      cutoverAt: CUTOVER_AT,
    });
    let writes = 0;

    await expect(
      cutOverLegacyRepository(
        repoRoot,
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: [],
          provider: {
            key: "matt-skills/v1",
            contractLocator: "docs/agents/issue-tracker.md",
          },
          acceptUpgradeDirection: true,
          confirmCutover: true,
          cutoverAt: CUTOVER_AT,
          cutoverPlanToken: plan.confirmationToken,
        },
        {
          writeTarget: async (plan, ordinal) => {
            writes += 1;
            if (writes === 3) throw new Error("simulated conversion write failure");
            await writeInstallTarget(plan, ordinal);
          },
        },
      ),
    ).rejects.toThrow("restored");

    expect(await readFile(join(repoRoot, ".bearing/manifest.json"))).toEqual(manifestBefore);
    expect(await readFile(join(repoRoot, ".scratch/test/effort.md"), "utf8")).toBe(legacyEffort());
    await expect(
      access(join(repoRoot, ".bearing/backups", BUNDLE_NAME, "receipt.json")),
    ).resolves.toBeNull();
    await writeFile(
      join(repoRoot, ".bearing/backups", BUNDLE_NAME, "receipt.json"),
      '{"verified":false}\n',
    );
    await expect(
      cutOverLegacyRepository(repoRoot, {
        repoRoot,
        packageRoot: process.cwd(),
        surfaces: ["agent-skills"],
        profiles: [],
        provider: {
          key: "matt-skills/v1",
          contractLocator: "docs/agents/issue-tracker.md",
        },
        acceptUpgradeDirection: true,
        confirmCutover: true,
        cutoverAt: CUTOVER_AT,
        cutoverPlanToken: plan.confirmationToken,
      }),
    ).rejects.toThrow("Recovery Bundle receipt is invalid");
    expect(await readFile(join(repoRoot, ".bearing/manifest.json"))).toEqual(manifestBefore);
  });
});
