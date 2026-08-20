import { expect, test } from "bun:test";
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import packageMetadata from "../package.json";
import {
  bootstrapDevelopmentRuntime,
  developmentRuntimeIdentity,
  developmentRuntimeSkillTreeSha256,
  resolveRepositoryRuntime,
  sha256File,
} from "../src/development-runtime";
import { projectReadModelPath } from "../src/project-read-model/store";
import { withRuntimeExecutionContext } from "../src/runtime-context";
import { makeTemporaryDirectory } from "./helpers";

const writeRepositoryManifest = async (
  root: string,
  runtime?: "stable" | "development",
): Promise<void> => {
  await mkdir(join(root, ".bearing"), { recursive: true });
  await writeFile(
    join(root, ".bearing", "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: packageMetadata.version,
      status: "active",
      ...(runtime === undefined ? {} : { runtime }),
      surfaces: ["agent-skills"],
      executorProfiles: [],
    })}\n`,
  );
};

const fixtureSourceIdentity = {
  gitHead: "0".repeat(40),
  declaredBuildInputSha256: `sha256:${"1".repeat(64)}`,
  dirty: true,
} as const;

const fixture = async (withBinding = true) => {
  const root = await makeTemporaryDirectory("bearing-development-runtime-");
  const publicHomeDir = join(root, "public-home");
  const cliLocator = join(root, "dist", "cli.js");
  const publicSkillRoot = join(root, "skills", "bearing");
  const skillRoot = join(root, "skills", "bearing-dev");
  const runtimeManifest = join(root, "dist", "development-runtime.json");
  const stateHome = join(root, ".bearing", "local", "runtime-home");
  const stateRoot = join(stateHome, ".bearing");
  await writeRepositoryManifest(root, "development");
  await mkdir(publicSkillRoot, { recursive: true });
  await mkdir(skillRoot, { recursive: true });
  await mkdir(join(root, ".agents", "skills"), { recursive: true });
  await symlink("../../skills/bearing-dev", join(root, ".agents", "skills", "bearing-dev"));
  await mkdir(join(root, "dist"), { recursive: true });
  if (withBinding) await mkdir(stateRoot, { recursive: true });
  await mkdir(publicHomeDir, { recursive: true });
  await writeFile(cliLocator, "development cli\n");
  await writeFile(join(publicSkillRoot, "SKILL.md"), "bearing skill\n");
  await writeFile(join(skillRoot, "SKILL.md"), "bearing-dev entry\n");
  const payload = {
    schemaVersion: 1 as const,
    runtimeContractVersion: 1 as const,
    channel: "development" as const,
    packageVersion: packageMetadata.version,
    ...fixtureSourceIdentity,
    cliSha256: await sha256File(cliLocator),
    skillTreeSha256: await developmentRuntimeSkillTreeSha256(root),
  };
  await writeFile(
    runtimeManifest,
    `${JSON.stringify({ ...payload, runtimeIdentity: developmentRuntimeIdentity(payload) })}\n`,
  );
  const binding = {
    schemaVersion: 1,
    channel: "development",
    repositoryRoot: root,
    cliLocator,
    skillRoot,
    runtimeManifest,
    stateRoot,
  };
  const bindingPath = join(root, ".bearing", "local", "development-runtime.json");
  if (withBinding) await writeFile(bindingPath, `${JSON.stringify(binding)}\n`);
  return {
    root,
    publicHomeDir,
    cliLocator,
    publicSkillRoot,
    skillRoot,
    runtimeManifest,
    stateRoot,
    binding,
    bindingPath,
    sourceIdentity: async () => fixtureSourceIdentity,
  };
};

test("Development Runtime bootstrap explicitly materializes one local binding", async () => {
  const value = await fixture(false);
  const result = await bootstrapDevelopmentRuntime({
    repoRoot: value.root,
    packageRoot: value.root,
    publicHomeDir: value.publicHomeDir,
    invokedCliPath: value.cliLocator,
    sourceIdentity: value.sourceIdentity,
  });
  expect(result).toMatchObject({
    outcome: "applied",
    binding: ".bearing/local/development-runtime.json",
    receipt: { channel: "development" },
  });
  if (result.outcome !== "applied" && result.outcome !== "no-op") return;
  expect(JSON.parse(await readFile(value.bindingPath, "utf8"))).toMatchObject({
    channel: "development",
    repositoryRoot: await realpath(value.root),
  });
  await expect(
    resolveRepositoryRuntime({
      repoRoot: value.root,
      packageRoot: value.root,
      publicHomeDir: value.publicHomeDir,
      invokedCliPath: value.cliLocator,
      sourceIdentity: value.sourceIdentity,
    }),
  ).resolves.toMatchObject({ outcome: "resolved", context: { receipt: result.receipt } });
});

test("stable repositories resolve without Development Runtime material", async () => {
  const root = await makeTemporaryDirectory("bearing-stable-runtime-");
  const publicHomeDir = join(root, "home");
  await mkdir(publicHomeDir);
  await writeRepositoryManifest(root);
  const result = await resolveRepositoryRuntime({
    repoRoot: root,
    packageRoot: process.cwd(),
    publicHomeDir,
    invokedCliPath: join(process.cwd(), "dist", "cli.js"),
  });
  expect(result.outcome).toBe("resolved");
  if (result.outcome !== "resolved") return;
  expect(result.context.receipt).toMatchObject({ channel: "stable" });
  expect(result.context.homeDir).toBe(publicHomeDir);
});

test("Development Runtime resolves one coherent receipt and runtime-qualified cache", async () => {
  const value = await fixture();
  const result = await resolveRepositoryRuntime({
    repoRoot: value.root,
    packageRoot: value.root,
    publicHomeDir: value.publicHomeDir,
    invokedCliPath: value.cliLocator,
    sourceIdentity: value.sourceIdentity,
  });
  expect(result.outcome).toBe("resolved");
  if (result.outcome !== "resolved") return;
  expect(result.context.receipt).toMatchObject({
    channel: "development",
    cliSha256: await sha256File(value.cliLocator),
    skillTreeSha256: await developmentRuntimeSkillTreeSha256(value.root),
  });
  expect(result.context.homeDir).toBe(
    join(await realpath(value.root), ".bearing", "local", "runtime-home"),
  );
  expect(result.context.projectReadModelPath).toMatch(
    /\.bearing\/cache\/development\/[0-9a-f]{64}\/project-read-model\.sqlite$/u,
  );
  await withRuntimeExecutionContext(result.context, async () => {
    expect(projectReadModelPath(result.context.repositoryRoot)).toBe(
      result.context.projectReadModelPath,
    );
  });
  expect(projectReadModelPath(value.root)).toBe(
    join(value.root, ".bearing", "cache", "project-read-model.sqlite"),
  );
});

test("Development Runtime fails closed for missing binding without creating state", async () => {
  const root = await makeTemporaryDirectory("bearing-development-missing-");
  const publicHomeDir = join(root, "home");
  await mkdir(publicHomeDir);
  await writeRepositoryManifest(root, "development");
  const before = await readFile(join(root, ".bearing", "manifest.json"));
  const result = await resolveRepositoryRuntime({
    repoRoot: root,
    packageRoot: root,
    publicHomeDir,
    invokedCliPath: join(root, "dist", "cli.js"),
  });
  expect(result).toMatchObject({
    outcome: "unfulfilled",
    diagnostics: [{ code: "development-runtime-binding-missing" }],
  });
  expect(await readFile(join(root, ".bearing", "manifest.json"))).toEqual(before);
});

test("Development Runtime rejects identity drift and newer binding schemas", async () => {
  const sourceDrifted = await fixture();
  await expect(
    resolveRepositoryRuntime({
      repoRoot: sourceDrifted.root,
      packageRoot: sourceDrifted.root,
      publicHomeDir: sourceDrifted.publicHomeDir,
      invokedCliPath: sourceDrifted.cliLocator,
      sourceIdentity: async () => ({ ...fixtureSourceIdentity, dirty: false }),
    }),
  ).resolves.toMatchObject({
    outcome: "unfulfilled",
    diagnostics: [{ code: "development-runtime-identity-mismatch" }],
  });

  const drifted = await fixture();
  await writeFile(drifted.cliLocator, "changed cli\n");
  await expect(
    resolveRepositoryRuntime({
      repoRoot: drifted.root,
      packageRoot: drifted.root,
      publicHomeDir: drifted.publicHomeDir,
      invokedCliPath: drifted.cliLocator,
      sourceIdentity: drifted.sourceIdentity,
    }),
  ).resolves.toMatchObject({
    outcome: "unfulfilled",
    diagnostics: [{ code: "development-runtime-identity-mismatch" }],
  });

  const publicSkillDrifted = await fixture();
  await writeFile(join(publicSkillDrifted.publicSkillRoot, "SKILL.md"), "changed bearing skill\n");
  await expect(
    resolveRepositoryRuntime({
      repoRoot: publicSkillDrifted.root,
      packageRoot: publicSkillDrifted.root,
      publicHomeDir: publicSkillDrifted.publicHomeDir,
      invokedCliPath: publicSkillDrifted.cliLocator,
      sourceIdentity: publicSkillDrifted.sourceIdentity,
    }),
  ).resolves.toMatchObject({
    outcome: "unfulfilled",
    diagnostics: [{ code: "development-runtime-identity-mismatch" }],
  });

  const devEntryDrifted = await fixture();
  await writeFile(join(devEntryDrifted.skillRoot, "SKILL.md"), "changed bearing-dev entry\n");
  await expect(
    resolveRepositoryRuntime({
      repoRoot: devEntryDrifted.root,
      packageRoot: devEntryDrifted.root,
      publicHomeDir: devEntryDrifted.publicHomeDir,
      invokedCliPath: devEntryDrifted.cliLocator,
      sourceIdentity: devEntryDrifted.sourceIdentity,
    }),
  ).resolves.toMatchObject({
    outcome: "unfulfilled",
    diagnostics: [{ code: "development-runtime-identity-mismatch" }],
  });

  const newer = await fixture();
  await writeFile(newer.bindingPath, `${JSON.stringify({ ...newer.binding, schemaVersion: 2 })}\n`);
  await expect(
    resolveRepositoryRuntime({
      repoRoot: newer.root,
      packageRoot: newer.root,
      publicHomeDir: newer.publicHomeDir,
      invokedCliPath: newer.cliLocator,
      sourceIdentity: newer.sourceIdentity,
    }),
  ).resolves.toMatchObject({
    outcome: "need-update",
    diagnostics: [{ code: "development-runtime-binding-newer" }],
  });
});

test("Development Runtime rejects unsafe and public state roots", async () => {
  const unsafe = await fixture();
  const outside = await makeTemporaryDirectory("bearing-development-outside-");
  const outsideState = join(outside, ".bearing");
  await mkdir(outsideState);
  await writeFile(
    unsafe.bindingPath,
    `${JSON.stringify({ ...unsafe.binding, stateRoot: outsideState })}\n`,
  );
  await expect(
    resolveRepositoryRuntime({
      repoRoot: unsafe.root,
      packageRoot: unsafe.root,
      publicHomeDir: unsafe.publicHomeDir,
      invokedCliPath: unsafe.cliLocator,
      sourceIdentity: unsafe.sourceIdentity,
    }),
  ).resolves.toMatchObject({
    outcome: "recovery-required",
    diagnostics: [{ code: "development-runtime-state-root-unsafe" }],
  });

  const publicSelected = await fixture();
  const publicHomeDir = join(publicSelected.root, ".bearing", "local", "public-home");
  const publicRoot = join(publicHomeDir, ".bearing");
  await mkdir(publicRoot, { recursive: true });
  await writeFile(
    publicSelected.bindingPath,
    `${JSON.stringify({ ...publicSelected.binding, stateRoot: publicRoot })}\n`,
  );
  await expect(
    resolveRepositoryRuntime({
      repoRoot: publicSelected.root,
      packageRoot: publicSelected.root,
      publicHomeDir,
      invokedCliPath: publicSelected.cliLocator,
      sourceIdentity: publicSelected.sourceIdentity,
    }),
  ).resolves.toMatchObject({
    outcome: "unfulfilled",
    diagnostics: [{ code: "development-runtime-public-root-selected" }],
  });
});
