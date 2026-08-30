import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  assertIsolatedCodexHomeControlLinks,
  codexE2ELaunchContract,
  inspectCodexE2EOperatorContext,
  prepareIsolatedCodexHome,
  probeCodexE2EPermissionProfile,
} from "./codex-e2e-runtime";
import {
  captureGitHubRemoteInventory,
  deriveGitHubJourneyScopeKey,
  inspectGitHubRepository,
  provisionIsolatedGitHubAccountSelection,
  readFixedGitHubValidationRepository,
} from "./github-live-journey";
import { liveScenarioArtifactSchema, liveScenarioPackageSchema } from "./live-scenario-evidence";
import {
  installLiveScenarioProduct,
  materializeCompleteGlobalKitFromPackage,
  materializeDeclaredPrerequisiteSkills,
  materializeGitHubLiveScenarioPlanningState,
  materializeLiveScenarioProductState,
} from "./live-scenario-product";
import {
  digestLiveScenarioFixture,
  digestLiveScenarioFixtureSet,
  liveScenarioReferencedFixtureSources,
  loadLiveScenarioRegistry,
  materializeLiveScenarioFixture,
} from "./live-scenario-registry";
import { localRehearsalWorktreeDigest } from "./local-rehearsal-identity";
import { readReleaseTarGz } from "./release-archive";
import { sha256File } from "./release-digest";

const fail = (message: string): never => {
  throw new Error(message);
};

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
const liveScenarioHarnessFiles = Object.freeze([
  ".gitleaks.toml",
  "docs/agents/codex-e2e.md",
  "package-lock.json",
  "package.json",
]);
export const liveScenarioHarnessIdentitySha256 = async (input: {
  sourceRoot: string;
}): Promise<string> => {
  const sourceRoot = resolve(input.sourceRoot);
  const fileFrames = await Promise.all(
    liveScenarioHarnessFiles.map(async (locator) => {
      const bytes = await readFile(join(sourceRoot, locator));
      return `${locator}\0${bytes.byteLength}\0${sha256(bytes)}\n`;
    }),
  );
  const scriptsSha256 = await digestLiveScenarioFixture(join(sourceRoot, "scripts"));
  return sha256(`live-scenario-harness-v1\0scripts\0${scriptsSha256}\n${fileFrames.join("")}`);
};
const installationEntryToken = ["$", "{INSTALL_ENTRY}"].join("");
export const LIVE_SCENARIO_COORDINATOR_IDENTITY = "codex-coordinator" as const;
const G1_INSTALLATION_SHELL = "/bin/zsh" as const;

const liveScenarioRuntimePrefix = "bearing-live-scenario-";

const liveScenarioRuntimeRoot = (
  temporaryRoot: string,
  generationId: string,
  scenarioId: string,
  workspaceRoot: string,
) =>
  join(
    temporaryRoot,
    `${liveScenarioRuntimePrefix}${sha256(`${generationId}\0${scenarioId}\0${workspaceRoot}`).slice(
      0,
      32,
    )}`,
  );

const liveScenarioReadDeniedPaths = (input: {
  sourceRoot: string;
  registryPath: string;
  operatorCodexHome: string;
  scenarioContainer: string;
  existingRuntimeRoots: readonly string[];
}) => [
  input.sourceRoot,
  input.registryPath,
  input.operatorCodexHome,
  input.scenarioContainer,
  ...new Set(input.existingRuntimeRoots),
];

const existingLiveScenarioRuntimeRoots = async (temporaryRoot: string): Promise<string[]> =>
  (await readdir(temporaryRoot, { withFileTypes: true }))
    .filter(({ name }) => name.startsWith(liveScenarioRuntimePrefix))
    .map(({ name }) => join(temporaryRoot, name))
    .sort((left, right) => left.localeCompare(right, "en"));

export const deriveLiveScenarioGitHubScopeKey = (
  input: Parameters<typeof deriveGitHubJourneyScopeKey>[0],
): string =>
  deriveGitHubJourneyScopeKey(input).replace(/[0-9a-f]{64}$/u, (identity) => identity.slice(0, 20));

const git = (root: string, args: readonly string[]): string => {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    fail(result.stderr.toString().trim() || `git ${args.join(" ")} failed.`);
  }
  return result.stdout.toString().trim();
};

const initializeRepository = (root: string): void => {
  git(root, ["init", "-q"]);
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.name=Bearing Live Matrix",
    "-c",
    "user.email=live-matrix@example.invalid",
    "commit",
    "-qm",
    "Initialize independent Live Scenario fixture",
  ]);
};

const packageFile = async (artifactPath: string, locator: string): Promise<Buffer> => {
  const entries = (await readReleaseTarGz(artifactPath)).filter(({ path }) => path === locator);
  if (entries.length !== 1) {
    fail(`Matrix package requires one regular archive entry: ${locator}.`);
  }
  const entry = entries[0] ?? fail(`Matrix package archive entry is unavailable: ${locator}.`);
  if (entry.type !== "file") {
    fail(`Matrix package requires one regular archive entry: ${locator}.`);
  }
  return entry.bytes;
};

const assertLiveScenarioArtifactPackageIdentity = async (input: unknown): Promise<void> => {
  const matrixPackage = liveScenarioPackageSchema.parse(input);
  const metadata = z
    .object({ name: z.string(), version: z.string() })
    .passthrough()
    .parse(
      JSON.parse(
        (await packageFile(matrixPackage.artifact.path, "package/package.json")).toString("utf8"),
      ),
    );
  if (
    metadata.name !== matrixPackage.packageName ||
    metadata.version !== matrixPackage.packageVersion
  ) {
    fail("Live Scenario package metadata does not match the package basis.");
  }
};

const inspectG1InstallationRuntime = async () => {
  if (process.platform !== "darwin") {
    fail("G1 installation rehearsal requires macOS.");
  }
  const shellProgram = await realpath(G1_INSTALLATION_SHELL);
  const shell = Bun.spawnSync([shellProgram, "--version"], { stdout: "pipe", stderr: "pipe" });
  const version = shell.stdout.toString().trim();
  if (shell.exitCode !== 0 || !/^zsh\s/u.test(version)) {
    fail("G1 installation rehearsal requires a verified zsh executable.");
  }
  return Object.freeze({
    operatingSystem: "darwin" as const,
    shell: { program: shellProgram, version },
  });
};

const installBoundedLocalNpmCapability = async (input: {
  sourceRoot: string;
  runtimeRoot: string;
  agentHome: string;
  targetArtifact: string;
  targetFile: string;
  targetSha256: string;
  targetVersion: string;
}): Promise<void> => {
  const realNpm = Bun.which("npm") ?? fail("Bounded update rehearsal requires npm.");
  const controlRoot = join(input.runtimeRoot, "bounded-update-capability");
  const capability = join(controlRoot, "npm.mjs");
  const configuration = join(controlRoot, "config.json");
  const targetBytes = await readFile(input.targetArtifact);
  await mkdir(controlRoot);
  await cp(join(input.sourceRoot, "scripts/g1-local-npm-capability.mjs"), capability);
  await writeFile(
    configuration,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        targetArtifact: input.targetArtifact,
        targetFile: input.targetFile,
        targetSha256: input.targetSha256,
        targetIntegrity: `sha512-${createHash("sha512").update(targetBytes).digest("base64")}`,
        targetVersion: input.targetVersion,
        realNpm: await realpath(realNpm),
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o400 },
  );
  await chmod(capability, 0o555);
  await symlink(capability, join(input.agentHome, ".bearing/bin/npm"));
};

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  generationId: z.string().uuid(),
  coordinatorIdentity: z.literal(LIVE_SCENARIO_COORDINATOR_IDENTITY),
  evidenceClass: z.enum(["local-rehearsal", "release-candidate"]),
  scenario: z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough(),
  package: liveScenarioPackageSchema,
  matrixDefinitionSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  operatorContextFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  startingStateSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  installedSkillSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .nullable(),
  fixtureIdentity: z.object({
    runtime: z
      .object({
        operatingSystem: z.literal("darwin"),
        shell: z.object({ program: z.string().min(1), version: z.string().min(1) }).strict(),
      })
      .strict()
      .optional(),
    olderGlobalKit: z
      .object({
        packageName: z.literal("@lagrangee/bearing"),
        packageVersion: z.literal("0.1.1"),
        source: z
          .object({ kind: z.literal("npm"), spec: z.literal("@lagrangee/bearing@0.1.1") })
          .strict(),
        artifact: liveScenarioArtifactSchema,
        installedKitSha256: z.string().regex(/^[0-9a-f]{64}$/u),
        targetSkillSha256: z.string().regex(/^[0-9a-f]{64}$/u),
      })
      .strict()
      .optional(),
  }),
  paths: z.object({
    sourceRoot: z.string(),
    registry: z.string(),
    operatorCodexHome: z.string(),
    workspaceRoot: z.string(),
    runtimeRoot: z.string(),
    runtimeDenyRoots: z.array(z.string()),
    manifest: z.string(),
    manifestDigest: z.string(),
    installationArtifact: z.string(),
    installationEntry: z.string(),
    installationGuide: z.string(),
    agentHome: z.string(),
    repository: z.string(),
    observations: z.string(),
    transcripts: z.string(),
    sessionState: z.string(),
    prompts: z.array(z.string()).min(1),
    remoteInventories: z.string().optional(),
    baselineInventory: z.string().optional(),
  }),
  launch: z.object({
    environment: z.object({
      HOME: z.string(),
      CODEX_HOME: z.string(),
      SHELL: z.string().optional(),
    }),
    initial: z.object({
      program: z.string(),
      workingDirectory: z.string(),
      arguments: z.array(z.string()),
      appendPromptAsFinalArgument: z.literal(true),
    }),
    resume: z.object({
      program: z.string(),
      workingDirectory: z.string(),
      arguments: z.array(z.string()),
      appendPromptAsFinalArgument: z.literal(true),
    }),
  }),
  github: z
    .object({
      program: z.string().min(1),
      repositorySlug: z.string().min(1),
      repositoryIdentitySha256: z.string().regex(/^[0-9a-f]{64}$/u),
      viewerPermission: z.string().min(1),
      scopeKey: z.string().min(1),
      baselineInventorySha256: z.string().regex(/^[0-9a-f]{64}$/u),
      preparedGitConfigSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    })
    .optional(),
});

const ensureIndependentNewWorkspace = async (
  sourceRoot: string,
  workspaceRoot: string,
): Promise<void> => {
  if (!isAbsolute(sourceRoot) || !isAbsolute(workspaceRoot)) {
    fail("Source and Scenario workspace roots must be absolute paths.");
  }
  const canonicalSource = await realpath(sourceRoot);
  const canonicalParent = await realpath(dirname(workspaceRoot));
  const canonicalWorkspace = join(canonicalParent, basename(workspaceRoot));
  const relation = relative(canonicalSource, canonicalWorkspace);
  const reverse = relative(canonicalWorkspace, canonicalSource);
  if (
    relation === "" ||
    (!relation.startsWith("..") && !isAbsolute(relation)) ||
    (!reverse.startsWith("..") && !isAbsolute(reverse))
  ) {
    fail("Scenario workspace and source checkout must be independent.");
  }
  try {
    await lstat(workspaceRoot);
    fail(`Scenario workspace already exists: ${workspaceRoot}`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
};

export const liveScenarioDefinitionDigest = async (input: {
  sourceRoot: string;
  registryPath: string;
}): Promise<string> => {
  const sourceRoot = await realpath(resolve(input.sourceRoot));
  const registryPath = await realpath(resolve(sourceRoot, input.registryPath));
  const registry = await loadLiveScenarioRegistry(registryPath);
  const frames = [
    `registry\0${relative(sourceRoot, registryPath)}\0${sha256(await readFile(registryPath))}\n`,
  ];
  frames.push(`fixtures\0${await digestLiveScenarioFixtureSet({ sourceRoot, registry })}\n`);
  return sha256(frames.join(""));
};

const runCandidateDefinitionGit = (
  sourceRoot: string,
  args: readonly string[],
): Readonly<{ exitCode: number; stdout: Buffer; stderr: string }> => {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: sourceRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: Buffer.from(result.stdout),
    stderr: result.stderr.toString().trim(),
  };
};

export const assertExactCandidateSourceCheckout = async (input: {
  sourceRoot: string;
  sourceCommit: string;
}): Promise<void> => {
  const sourceRoot = await realpath(resolve(input.sourceRoot));
  const sourceCommit = z
    .string()
    .regex(/^[0-9a-f]{40}$/u)
    .parse(input.sourceCommit);
  const head = runCandidateDefinitionGit(sourceRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const tracked = runCandidateDefinitionGit(sourceRoot, [
    "diff",
    "--quiet",
    "--no-ext-diff",
    sourceCommit,
    "--",
    ".",
  ]);
  const untracked = runCandidateDefinitionGit(sourceRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
  ]);
  if (
    head.exitCode !== 0 ||
    head.stdout.toString("utf8").trim() !== sourceCommit ||
    tracked.exitCode !== 0 ||
    untracked.exitCode !== 0 ||
    untracked.stdout.byteLength > 0
  ) {
    fail("Release Candidate source does not match the exact Candidate source commit.");
  }
};

const liveScenarioSourceIdentitySchema = z.discriminatedUnion("evidenceClass", [
  z.object({ evidenceClass: z.literal("release-candidate"), sourceCommit: z.string().min(1) }),
  z.object({ evidenceClass: z.literal("local-rehearsal"), worktreeSha256: z.string().min(1) }),
]);

export const assertLiveScenarioSourceCurrent = async (
  sourceRoot: string,
  input: unknown,
): Promise<void> => {
  const identity = liveScenarioSourceIdentitySchema.parse(input);
  if (identity.evidenceClass === "release-candidate") {
    const canonicalSourceRoot = await realpath(resolve(sourceRoot));
    const executingRunnerSourceRoot = await realpath(resolve(import.meta.dir, ".."));
    if (canonicalSourceRoot !== executingRunnerSourceRoot) {
      fail("Release Candidate source must be the executing runner checkout.");
    }
    await assertExactCandidateSourceCheckout({
      sourceRoot: canonicalSourceRoot,
      sourceCommit: identity.sourceCommit,
    });
    return;
  }
  if ((await localRehearsalWorktreeDigest(sourceRoot)) !== identity.worktreeSha256) {
    fail("Local rehearsal product or Matrix source changed after packaging.");
  }
};

const assertExactCandidateDefinitionBytes = (input: {
  sourceRoot: string;
  sourceCommit: string;
  pathspecs: readonly string[];
}): void => {
  const tracked = runCandidateDefinitionGit(input.sourceRoot, [
    "diff",
    "--quiet",
    "--no-ext-diff",
    input.sourceCommit,
    "--",
    ...input.pathspecs,
  ]);
  if (tracked.exitCode !== 0) {
    if (tracked.exitCode === 1) {
      fail("Live Scenario definitions do not match the exact Candidate source commit.");
    }
    fail(tracked.stderr || "Candidate definition tracked-state verification failed.");
  }
  for (const args of [
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ...input.pathspecs],
    ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ...input.pathspecs],
  ] as const) {
    const untracked = runCandidateDefinitionGit(input.sourceRoot, args);
    if (untracked.exitCode !== 0) {
      fail(untracked.stderr || "Candidate definition untracked-state verification failed.");
    }
    if (untracked.stdout.byteLength > 0) {
      fail("Live Scenario definitions do not match the exact Candidate source commit.");
    }
  }
};

export const liveScenarioCandidateDefinitionDigest = async (input: {
  sourceRoot: string;
  registryPath: string;
  sourceCommit: string;
}): Promise<string> => {
  const sourceRoot = await realpath(resolve(input.sourceRoot));
  const sourceCommit = z
    .string()
    .regex(/^[0-9a-f]{40}$/u)
    .parse(input.sourceCommit);
  const head = runCandidateDefinitionGit(sourceRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (head.exitCode !== 0 || head.stdout.toString("utf8").trim() !== sourceCommit) {
    fail("Live Scenario definitions require the exact Candidate source commit checkout.");
  }
  const registryPath = resolve(sourceRoot, input.registryPath);
  const registryRelative = relative(sourceRoot, registryPath);
  const registry = await loadLiveScenarioRegistry(registryPath);
  const fixtureRelatives = liveScenarioReferencedFixtureSources(registry).map((fixtureSource) =>
    relative(sourceRoot, resolve(sourceRoot, fixtureSource)),
  );
  if (
    [registryRelative, ...fixtureRelatives].some(
      (locator) => locator.startsWith("..") || isAbsolute(locator),
    )
  ) {
    fail("Live Scenario Candidate definitions must stay inside the source checkout.");
  }
  const definition = {
    sourceRoot,
    sourceCommit,
    pathspecs: [registryRelative, ...fixtureRelatives],
  } as const;
  assertExactCandidateDefinitionBytes(definition);
  const digest = await liveScenarioDefinitionDigest({
    sourceRoot,
    registryPath: registryRelative,
  });
  assertExactCandidateDefinitionBytes(definition);
  return digest;
};

const installationEntry = (input: {
  packageName: string;
  packageVersion: string;
  artifactPath: string;
  artifactSha256: string;
  installationGuide: string;
}): string => `# Install the exact local Bearing package

Follow the real Agent installation guidance at ${input.installationGuide}, but use this exact local
package instead of a registry locator:

- Package: ${input.packageName}@${input.packageVersion}
- Tarball: ${input.artifactPath}
- SHA-256: ${input.artifactSha256}

Installation and repository setup are separate outcomes. After installation, tell the Human the
appropriate next step and wait for repository setup consent.
`;

const cloneGitHubFixture = (input: {
  checkout: string;
  repository: string;
  workspaceRoot: string;
}): void => {
  const checkout = resolve(input.checkout);
  if (git(checkout, ["status", "--porcelain=v1"]) !== "") {
    fail("Fixed GitHub Validation Repository checkout must be clean.");
  }
  const origin = git(checkout, ["remote", "get-url", "origin"]);
  git(input.workspaceRoot, ["clone", "--quiet", "--no-hardlinks", checkout, input.repository]);
  git(input.repository, ["remote", "set-url", "origin", origin]);
  git(input.repository, ["config", "--local", "user.name", "Bearing Live Matrix"]);
  git(input.repository, ["config", "--local", "user.email", "live-matrix@example.invalid"]);
};

export const installGitHubScenarioProviderContract = async (input: {
  sourceRoot: string;
  repository: string;
}): Promise<void> => {
  const relativePath = "docs/agents/issue-tracker.md";
  await cp(
    join(
      input.sourceRoot,
      "validation/live-journey/fixtures/github-provider/docs/agents/issue-tracker.md",
    ),
    join(input.repository, relativePath),
    { force: true },
  );
  if (git(input.repository, ["status", "--porcelain=v1", "--", relativePath]) !== "") {
    git(input.repository, ["add", "--", relativePath]);
    git(input.repository, [
      "-c",
      "user.name=Bearing Live Matrix",
      "-c",
      "user.email=live-matrix@example.invalid",
      "commit",
      "-qm",
      "Install GitHub provider contract fixture",
    ]);
  }
  if (git(input.repository, ["status", "--porcelain=v1"]) !== "") {
    fail("GitHub Live Scenario provider contract did not produce a clean baseline.");
  }
};

export const prepareLiveScenarioGeneration = async (input: {
  sourceRoot: string;
  workspaceRoot: string;
  operatorCodexHome: string;
  registryPath: string;
  scenarioId: string;
  package: unknown;
  generationId?: string;
  codexProgram?: string;
  githubCheckout?: string;
  githubProgram?: string;
  prerequisiteSkillRoot?: string;
  deferPermissionProbe?: boolean;
}) => {
  const sourceRoot = resolve(input.sourceRoot);
  const workspaceRoot = resolve(input.workspaceRoot);
  const operatorCodexHome = await realpath(resolve(input.operatorCodexHome));
  await ensureIndependentNewWorkspace(sourceRoot, workspaceRoot);
  const registryPath = await realpath(resolve(sourceRoot, input.registryPath));
  const registry = await loadLiveScenarioRegistry(registryPath);
  const scenario =
    registry.scenarios.find(({ id }) => id === input.scenarioId) ??
    fail(`Unknown Live Scenario: ${input.scenarioId}.`);
  const fixtureRuntime =
    scenario.composition.fixtureProfile === "fresh-installation-repository"
      ? await inspectG1InstallationRuntime()
      : undefined;
  const generationId = z
    .string()
    .uuid()
    .parse(input.generationId ?? randomUUID());
  const temporaryRoot = await realpath(tmpdir());
  const scenarioContainer = await realpath(dirname(workspaceRoot));
  const runtimeRoot = liveScenarioRuntimeRoot(
    temporaryRoot,
    generationId,
    scenario.id,
    workspaceRoot,
  );
  const existingRuntimeRoots = (await existingLiveScenarioRuntimeRoots(temporaryRoot)).filter(
    (path) => path !== runtimeRoot,
  );
  const runtimeRelation = relative(scenarioContainer, runtimeRoot);
  if (
    runtimeRelation === "" ||
    (!runtimeRelation.startsWith("..") && !isAbsolute(runtimeRelation))
  ) {
    fail("Scenario runtime must stay outside Coordinator evidence storage.");
  }
  await ensureIndependentNewWorkspace(sourceRoot, runtimeRoot);
  const matrixPackage = liveScenarioPackageSchema.parse(input.package);
  await assertLiveScenarioSourceCurrent(sourceRoot, matrixPackage);
  const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
    sourceRoot,
    registryPath: relative(sourceRoot, registryPath),
  });
  if (matrixPackage.matrixDefinitionSha256 !== matrixDefinitionSha256) {
    fail("Live Scenario package uses a different Matrix definition.");
  }
  if ((await sha256File(matrixPackage.artifact.path)) !== matrixPackage.artifact.sha256) {
    fail("Live Scenario package artifact digest mismatch.");
  }
  await assertLiveScenarioArtifactPackageIdentity(matrixPackage);
  const olderGlobalKit =
    scenario.composition.fixtureProfile === "older-kit-active-stable-repository"
      ? matrixPackage.evidenceClass === "local-rehearsal"
        ? (matrixPackage.fixtures?.olderGlobalKit ??
          fail("G1 update rehearsal requires the fixed 0.1.1 package artifact."))
        : fail("G1 update rehearsal currently requires a local rehearsal package basis.")
      : undefined;
  if (olderGlobalKit !== undefined) {
    if ((await sha256File(olderGlobalKit.artifact.path)) !== olderGlobalKit.artifact.sha256) {
      fail("G1 older Global Kit artifact digest mismatch.");
    }
    const metadata = z
      .object({ name: z.string(), version: z.string() })
      .parse(
        JSON.parse(
          (await packageFile(olderGlobalKit.artifact.path, "package/package.json")).toString(
            "utf8",
          ),
        ),
      );
    if (
      metadata.name !== olderGlobalKit.packageName ||
      metadata.version !== olderGlobalKit.packageVersion
    ) {
      fail("G1 older Global Kit artifact identity mismatch.");
    }
  }

  let workspaceCreated = false;
  let runtimeCreated = false;
  try {
    await mkdir(workspaceRoot);
    workspaceCreated = true;
    await mkdir(runtimeRoot);
    runtimeCreated = true;
    const agentHome = join(runtimeRoot, "agent-home");
    const repository = join(runtimeRoot, "repository");
    const observations = join(workspaceRoot, "observations");
    const transcripts = join(workspaceRoot, "transcripts");
    const remoteInventories = join(workspaceRoot, "github/remote-inventories");
    const promptDirectory = join(workspaceRoot, "prompts");
    const manifestPath = join(workspaceRoot, "scenario-manifest.json");
    const manifestDigest = `${manifestPath}.sha256`;
    const installationSource = join(agentHome, "install-source");
    const installationArtifact = join(installationSource, matrixPackage.artifact.file);
    const installationGuide = join(installationSource, "agent-installation.md");
    const installationEntryPath = join(installationSource, "README.local.md");
    const sessionState = join(workspaceRoot, "codex-session.json");
    await Promise.all([
      mkdir(agentHome, { recursive: true }),
      mkdir(observations, { recursive: true }),
      mkdir(transcripts, { recursive: true }),
      mkdir(promptDirectory, { recursive: true }),
    ]);
    await mkdir(installationSource);
    const agentCodexHome = await prepareIsolatedCodexHome({
      operatorCodexHome,
      isolatedHome: agentHome,
    });
    if (scenario.composition.fixtureProfile === "fresh-installation-repository") {
      await mkdir(join(agentHome, ".agents/skills"), { recursive: true });
    }
    const operatorContext = await inspectCodexE2EOperatorContext(agentCodexHome);
    await Promise.all([
      writeFile(installationArtifact, await readFile(matrixPackage.artifact.path), {
        flag: "wx",
        mode: 0o600,
      }),
      writeFile(
        installationGuide,
        await packageFile(matrixPackage.artifact.path, "package/docs/agent-installation.md"),
        { flag: "wx" },
      ),
      writeFile(
        installationEntryPath,
        installationEntry({
          packageName: matrixPackage.packageName,
          packageVersion: matrixPackage.packageVersion,
          artifactPath: installationArtifact,
          artifactSha256: matrixPackage.artifact.sha256,
          installationGuide,
        }),
        { flag: "wx" },
      ),
    ]);
    if ((await sha256File(installationArtifact)) !== matrixPackage.artifact.sha256) {
      fail("Scenario installation package copy digest mismatch.");
    }
    if (scenario.composition.fixtureProfile === "active-github-repository") {
      cloneGitHubFixture({
        checkout:
          input.githubCheckout ??
          fail("GitHub Live Scenario requires the fixed repository checkout."),
        repository,
        workspaceRoot: runtimeRoot,
      });
      await installGitHubScenarioProviderContract({ sourceRoot, repository });
      await mkdir(remoteInventories, { recursive: true });
    } else {
      await materializeLiveScenarioFixture({
        registry,
        scenarioId: scenario.id,
        sourceRoot,
        outputRoot: repository,
      });
      if (scenario.composition.fixtureProfile !== "non-project-directory") {
        initializeRepository(repository);
      }
    }
    let installedSkillSha256: string | null = null;
    let installedOlderKitSha256: string | undefined;
    let targetSkillSha256: string | undefined;
    let github:
      | Readonly<{
          program: string;
          repositorySlug: string;
          repositoryIdentitySha256: string;
          viewerPermission: string;
          scopeKey: string;
          baselineInventorySha256: string;
          preparedGitConfigSha256: string;
        }>
      | undefined;
    let baselineInventory: string | undefined;
    const bearingInstallationUnderTest = scenario.composition.skills.some(
      ({ skill, role }) => skill === "bearing" && role === "installation-under-test",
    );
    if (!bearingInstallationUnderTest) {
      const productProgram = await installLiveScenarioProduct({
        tarball: matrixPackage.artifact.path,
        installRoot: join(runtimeRoot, "product-install"),
        agentHome,
        installGlobalKit:
          scenario.composition.fixtureProfile !== "older-kit-active-stable-repository",
      });
      if (scenario.composition.fixtureProfile === "older-kit-active-stable-repository") {
        targetSkillSha256 = await digestLiveScenarioFixture(
          join(runtimeRoot, "product-install/node_modules/@lagrangee/bearing/skills/bearing"),
        );
      }
      if (scenario.composition.fixtureProfile === "active-github-repository") {
        await materializeGitHubLiveScenarioPlanningState({
          sourceRoot,
          repositoryRoot: repository,
          productProgram,
          agentHome,
        });
        const githubProgram = input.githubProgram ?? "gh";
        const fixed = await readFixedGitHubValidationRepository(sourceRoot);
        const remote = await inspectGitHubRepository(
          githubProgram,
          fixed.configuration.repositorySlug,
        );
        await provisionIsolatedGitHubAccountSelection({ program: githubProgram, agentHome });
        const scopeKey = deriveLiveScenarioGitHubScopeKey({
          packageVersion: matrixPackage.packageVersion,
          sourceIdentity:
            matrixPackage.evidenceClass === "release-candidate"
              ? matrixPackage.sourceCommit
              : matrixPackage.sourceHead,
          packIdentity:
            matrixPackage.evidenceClass === "release-candidate"
              ? `${matrixPackage.workflow.runId}/${matrixPackage.workflow.runAttempt}`
              : matrixPackage.worktreeSha256,
          artifactSha256: matrixPackage.artifact.sha256,
          matrixDefinitionSha256,
          generationId:
            input.generationId ?? fail("GitHub Live Scenario requires an explicit Generation ID."),
          journeyAttempt: 1,
        });
        const baseline = await captureGitHubRemoteInventory({
          program: githubProgram,
          repositorySlug: fixed.configuration.repositorySlug,
          scopeKey,
        });
        if (
          baseline.repositoryIdentitySha256 !== fixed.configuration.repositoryIdentitySha256 ||
          baseline.issues.some((issue) => issue.candidateScoped)
        ) {
          fail("GitHub Live Scenario fixed identity or fresh scope boundary is invalid.");
        }
        baselineInventory = join(remoteInventories, "baseline.json");
        const baselineBytes = `${JSON.stringify(baseline, null, 2)}\n`;
        await writeFile(baselineInventory, baselineBytes, { flag: "wx" });
        github = Object.freeze({
          program: githubProgram,
          repositorySlug: fixed.configuration.repositorySlug,
          repositoryIdentitySha256: baseline.repositoryIdentitySha256,
          viewerPermission: remote.viewerPermission,
          scopeKey,
          baselineInventorySha256: sha256(baselineBytes),
          preparedGitConfigSha256: await sha256File(join(repository, ".git/config")),
        });
        const inspected = Bun.spawnSync(
          [join(agentHome, ".bearing/bin/bearing"), "configure", "inspect", "--repo", repository],
          {
            cwd: repository,
            env: { ...process.env, HOME: agentHome },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        if (
          inspected.exitCode !== 0 ||
          !inspected.stdout.toString().includes('"state": "active"')
        ) {
          fail("GitHub Live Scenario repository is not an Active candidate baseline.");
        }
      } else {
        await materializeLiveScenarioProductState({
          scenario,
          sourceRoot,
          repositoryRoot: repository,
          productProgram,
          agentHome,
        });
        if (scenario.composition.fixtureProfile === "older-kit-active-stable-repository") {
          const fixturePackage =
            olderGlobalKit ?? fail("G1 update rehearsal older Global Kit package is unavailable.");
          await materializeCompleteGlobalKitFromPackage({
            tarball: fixturePackage.artifact.path,
            installRoot: join(runtimeRoot, "older-product-install"),
            agentHome,
            repositoryRoot: repository,
          });
          const installedMetadata = z
            .object({
              name: z.literal("@lagrangee/bearing"),
              version: z.literal("0.1.1"),
            })
            .passthrough()
            .parse(
              JSON.parse(
                await readFile(join(agentHome, ".bearing/kit/current/package.json"), "utf8"),
              ),
            );
          if (
            installedMetadata.name !== fixturePackage.packageName ||
            installedMetadata.version !== fixturePackage.packageVersion
          ) {
            fail("G1 update rehearsal did not establish the fixed older Global Kit.");
          }
          installedOlderKitSha256 = await digestLiveScenarioFixture(
            join(agentHome, ".bearing/kit/current"),
          );
          await installBoundedLocalNpmCapability({
            sourceRoot,
            runtimeRoot,
            agentHome,
            targetArtifact: installationArtifact,
            targetFile: matrixPackage.artifact.file,
            targetSha256: matrixPackage.artifact.sha256,
            targetVersion: matrixPackage.packageVersion,
          });
        }
      }
      installedSkillSha256 = await digestLiveScenarioFixture(
        join(agentHome, "skill-directory/bearing"),
      );
    }
    const declaredPrerequisites = scenario.composition.skills.filter(
      ({ skill, role }) => skill !== "bearing" && role === "prerequisite",
    );
    if (declaredPrerequisites.length > 0) {
      await materializeDeclaredPrerequisiteSkills({
        scenario,
        trustedSkillRoot:
          input.prerequisiteSkillRoot ??
          fail(`Live Scenario ${scenario.id} requires an explicit prerequisite Skill root.`),
        targetSkillRoot: join(agentHome, "skill-directory"),
      });
    }
    const prompts = scenario.prompts.map((prompt) =>
      prompt.replaceAll(installationEntryToken, installationEntryPath),
    );
    if (prompts.some((prompt) => /\$\{[A-Z_]+\}/u.test(prompt))) {
      fail(`Live Scenario prompt has an unresolved runtime value: ${scenario.id}.`);
    }
    const promptPaths = prompts.map((_, index) =>
      join(promptDirectory, `turn-${String(index + 1).padStart(2, "0")}.txt`),
    );
    await Promise.all(
      prompts.map((prompt, index) =>
        writeFile(promptPaths[index] as string, `${prompt}\n`, { flag: "wx" }),
      ),
    );
    const readDeniedPaths = liveScenarioReadDeniedPaths({
      sourceRoot,
      registryPath,
      operatorCodexHome,
      scenarioContainer,
      existingRuntimeRoots,
    });
    const writeAllowedPaths =
      scenario.composition.fixtureProfile === "fresh-installation-repository"
        ? [join(agentHome, ".agents/skills")]
        : [];
    const runtimeDenyRoots = [...new Set(existingRuntimeRoots)];
    const launch = codexE2ELaunchContract({
      repositoryRoot: repository,
      isolatedHome: agentHome,
      codexHome: agentCodexHome,
      disabledOperatorSkillPaths: operatorContext.disabledSkills.map(({ locator }) => locator),
      readDeniedPaths,
      writeAllowedPaths,
      skipGitRepositoryCheck: scenario.composition.fixtureProfile === "non-project-directory",
      ...(fixtureRuntime === undefined ? {} : { shellProgram: fixtureRuntime.shell.program }),
      ...(input.codexProgram === undefined ? {} : { program: input.codexProgram }),
    });
    const manifest = Object.freeze({
      schemaVersion: 1 as const,
      generationId,
      coordinatorIdentity: LIVE_SCENARIO_COORDINATOR_IDENTITY,
      evidenceClass: matrixPackage.evidenceClass,
      scenario,
      package: matrixPackage,
      matrixDefinitionSha256,
      operatorContextFingerprint: operatorContext.fingerprint,
      startingStateSha256: await digestLiveScenarioFixture(repository),
      installedSkillSha256,
      fixtureIdentity: Object.freeze({
        ...(fixtureRuntime === undefined ? {} : { runtime: fixtureRuntime }),
        ...(olderGlobalKit === undefined
          ? {}
          : {
              olderGlobalKit: Object.freeze({
                ...olderGlobalKit,
                installedKitSha256:
                  installedOlderKitSha256 ??
                  fail("G1 update rehearsal older Global Kit digest is unavailable."),
                targetSkillSha256:
                  targetSkillSha256 ??
                  fail("G1 update rehearsal target Skill digest is unavailable."),
              }),
            }),
      }),
      paths: Object.freeze({
        sourceRoot,
        registry: registryPath,
        operatorCodexHome,
        workspaceRoot,
        runtimeRoot,
        runtimeDenyRoots,
        manifest: manifestPath,
        manifestDigest,
        installationArtifact,
        installationEntry: installationEntryPath,
        installationGuide,
        agentHome,
        repository,
        observations,
        transcripts,
        sessionState,
        prompts: promptPaths,
        ...(github === undefined ? {} : { remoteInventories, baselineInventory }),
      }),
      launch,
      ...(github === undefined ? {} : { github }),
    });
    await assertLiveScenarioSourceCurrent(sourceRoot, matrixPackage);
    const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, bytes, { flag: "wx", mode: 0o600 });
    await writeFile(manifestDigest, `${sha256(bytes)}\n`, { flag: "wx", mode: 0o600 });
    if (input.deferPermissionProbe !== true) {
      await probeCodexE2EPermissionProfile({
        program: launch.initial.program,
        repositoryRoot: repository,
        isolatedHome: agentHome,
        codexHome: agentCodexHome,
        manifestPath,
        registryPath,
        sourceRoot,
        operatorCodexHome,
        scenarioWorkspace: workspaceRoot,
        installationEntryPath,
        readDeniedPaths,
        writeAllowedPaths,
      });
    }
    return manifest;
  } catch (error) {
    await Promise.all([
      ...(runtimeCreated ? [rm(runtimeRoot, { recursive: true, force: true })] : []),
      ...(workspaceCreated ? [rm(workspaceRoot, { recursive: true, force: true })] : []),
    ]);
    throw error;
  }
};

export const verifyLiveScenarioGeneration = async (
  path: string,
  options: Readonly<{ behaviorCompleted?: boolean }> = {},
) => {
  const manifestPath = resolve(path);
  const bytes = await readFile(manifestPath, "utf8");
  if ((await readFile(`${manifestPath}.sha256`, "utf8")).trim() !== sha256(bytes)) {
    fail("Live Scenario manifest digest mismatch.");
  }
  const parsed = manifestSchema.parse(JSON.parse(bytes));
  if (
    parsed.paths.manifest !== manifestPath ||
    parsed.paths.manifestDigest !== `${manifestPath}.sha256` ||
    parsed.paths.workspaceRoot !== dirname(manifestPath)
  ) {
    fail("Live Scenario manifest locator mismatch.");
  }
  const registry = await loadLiveScenarioRegistry(parsed.paths.registry);
  const scenario =
    registry.scenarios.find(({ id }) => id === parsed.scenario.id) ??
    fail(`Live Scenario is no longer registered: ${parsed.scenario.id}.`);
  const temporaryRoot = await realpath(dirname(parsed.paths.runtimeRoot));
  const expectedRuntimeRoot = liveScenarioRuntimeRoot(
    temporaryRoot,
    parsed.generationId,
    scenario.id,
    parsed.paths.workspaceRoot,
  );
  const scenarioContainer = await realpath(dirname(parsed.paths.workspaceRoot));
  const currentRuntimeRoots = (await existingLiveScenarioRuntimeRoots(temporaryRoot)).filter(
    (path) => path !== expectedRuntimeRoot,
  );
  const runtimeDenyRootSet = new Set(parsed.paths.runtimeDenyRoots);
  if (
    parsed.paths.operatorCodexHome !== (await realpath(parsed.paths.operatorCodexHome)) ||
    parsed.paths.runtimeRoot !== expectedRuntimeRoot ||
    runtimeDenyRootSet.size !== parsed.paths.runtimeDenyRoots.length ||
    parsed.paths.runtimeDenyRoots.some(
      (path) =>
        dirname(path) !== temporaryRoot ||
        !basename(path).startsWith(liveScenarioRuntimePrefix) ||
        path === expectedRuntimeRoot,
    ) ||
    parsed.paths.agentHome !== join(expectedRuntimeRoot, "agent-home") ||
    parsed.paths.repository !== join(expectedRuntimeRoot, "repository") ||
    parsed.paths.installationArtifact !==
      join(expectedRuntimeRoot, "agent-home/install-source", parsed.package.artifact.file) ||
    parsed.paths.installationGuide !==
      join(expectedRuntimeRoot, "agent-home/install-source/agent-installation.md") ||
    parsed.paths.installationEntry !==
      join(expectedRuntimeRoot, "agent-home/install-source/README.local.md")
  ) {
    fail("Live Scenario runtime locator does not match its opaque Generation identity.");
  }
  if (JSON.stringify(scenario) !== JSON.stringify(parsed.scenario)) {
    fail("Live Scenario definition changed after preparation.");
  }
  const expectsInstallationRuntime =
    scenario.composition.fixtureProfile === "fresh-installation-repository";
  const expectsOlderGlobalKit =
    scenario.composition.fixtureProfile === "older-kit-active-stable-repository";
  if (
    (parsed.fixtureIdentity.runtime !== undefined) !== expectsInstallationRuntime ||
    (parsed.fixtureIdentity.olderGlobalKit !== undefined) !== expectsOlderGlobalKit
  ) {
    fail("Live Scenario Fixture identity does not match its declared Fixture Profile.");
  }
  if (parsed.fixtureIdentity.runtime !== undefined) {
    const currentRuntime = await inspectG1InstallationRuntime();
    if (JSON.stringify(currentRuntime) !== JSON.stringify(parsed.fixtureIdentity.runtime)) {
      fail("G1 installation runtime identity changed after preparation.");
    }
  }
  if (parsed.fixtureIdentity.olderGlobalKit !== undefined) {
    const fixturePackage = parsed.fixtureIdentity.olderGlobalKit;
    if (
      (await sha256File(fixturePackage.artifact.path)) !== fixturePackage.artifact.sha256 ||
      JSON.stringify(
        z
          .object({ name: z.string(), version: z.string() })
          .parse(
            JSON.parse(
              (await packageFile(fixturePackage.artifact.path, "package/package.json")).toString(
                "utf8",
              ),
            ),
          ),
      ) !==
        JSON.stringify({
          name: fixturePackage.packageName,
          version: fixturePackage.packageVersion,
        })
    ) {
      fail("G1 older Global Kit artifact changed after preparation.");
    }
  }
  if (
    (await liveScenarioDefinitionDigest({
      sourceRoot: parsed.paths.sourceRoot,
      registryPath: relative(parsed.paths.sourceRoot, parsed.paths.registry),
    })) !== parsed.matrixDefinitionSha256 ||
    parsed.package.matrixDefinitionSha256 !== parsed.matrixDefinitionSha256
  ) {
    fail("Live Scenario Matrix identity changed after preparation.");
  }
  if ((await sha256File(parsed.package.artifact.path)) !== parsed.package.artifact.sha256) {
    fail("Live Scenario package changed after preparation.");
  }
  if ((await sha256File(parsed.paths.installationArtifact)) !== parsed.package.artifact.sha256) {
    fail("Live Scenario installation package copy changed after preparation.");
  }
  if (
    !(await readFile(parsed.paths.installationGuide)).equals(
      await packageFile(parsed.package.artifact.path, "package/docs/agent-installation.md"),
    ) ||
    (await readFile(parsed.paths.installationEntry, "utf8")) !==
      installationEntry({
        packageName: parsed.package.packageName,
        packageVersion: parsed.package.packageVersion,
        artifactPath: parsed.paths.installationArtifact,
        artifactSha256: parsed.package.artifact.sha256,
        installationGuide: parsed.paths.installationGuide,
      })
  ) {
    fail("Live Scenario installation guidance changed after preparation.");
  }
  await assertLiveScenarioArtifactPackageIdentity(parsed.package);
  await assertLiveScenarioSourceCurrent(parsed.paths.sourceRoot, parsed.package);
  const observationNames = await readdir(parsed.paths.observations);
  if (observationNames.length === 0 && options.behaviorCompleted !== true) {
    const currentFixtureSha256 = await digestLiveScenarioFixture(parsed.paths.repository);
    if (currentFixtureSha256 !== parsed.startingStateSha256) {
      fail("Live Scenario fixture changed before Agent behavior.");
    }
    if (
      parsed.fixtureIdentity.olderGlobalKit !== undefined &&
      (await digestLiveScenarioFixture(join(parsed.paths.agentHome, ".bearing/kit/current"))) !==
        parsed.fixtureIdentity.olderGlobalKit.installedKitSha256
    ) {
      fail("G1 older Global Kit changed before Agent behavior.");
    }
  }
  if (parsed.installedSkillSha256 !== null) {
    const currentSkillSha256 = await digestLiveScenarioFixture(
      join(parsed.paths.agentHome, "skill-directory/bearing"),
    );
    const acceptedSkillDigests =
      (observationNames.length > 0 || options.behaviorCompleted === true) &&
      parsed.fixtureIdentity.olderGlobalKit !== undefined
        ? [parsed.installedSkillSha256, parsed.fixtureIdentity.olderGlobalKit.targetSkillSha256]
        : [parsed.installedSkillSha256];
    if (!acceptedSkillDigests.includes(currentSkillSha256)) {
      fail("Preinstalled Bearing Skill changed outside the recorded Scenario transition.");
    }
  }
  await assertIsolatedCodexHomeControlLinks(parsed.paths.agentHome);
  const expectedPrompts = scenario.prompts.map((prompt) =>
    prompt.replaceAll(installationEntryToken, parsed.paths.installationEntry),
  );
  for (const [index, promptPath] of parsed.paths.prompts.entries()) {
    if ((await readFile(promptPath, "utf8")) !== `${expectedPrompts[index]}\n`) {
      fail("Live Scenario prompt changed before Agent behavior.");
    }
  }
  const storedLaunch = codexE2ELaunchContract({
    repositoryRoot: parsed.paths.repository,
    isolatedHome: parsed.paths.agentHome,
    codexHome: parsed.launch.environment.CODEX_HOME,
    disabledOperatorSkillPaths: [],
    readDeniedPaths: [
      parsed.paths.sourceRoot,
      parsed.paths.registry,
      parsed.paths.operatorCodexHome,
      scenarioContainer,
      ...parsed.paths.runtimeDenyRoots,
    ],
    writeAllowedPaths:
      scenario.composition.fixtureProfile === "fresh-installation-repository"
        ? [join(parsed.paths.agentHome, ".agents/skills")]
        : [],
    program: parsed.launch.initial.program,
    skipGitRepositoryCheck: scenario.composition.fixtureProfile === "non-project-directory",
    ...(parsed.fixtureIdentity.runtime === undefined
      ? {}
      : { shellProgram: parsed.fixtureIdentity.runtime.shell.program }),
  });
  if (JSON.stringify(storedLaunch) !== JSON.stringify(parsed.launch)) {
    fail("Live Scenario Codex launch changed before Agent behavior.");
  }
  const currentRuntimeDenyRoots = [
    ...new Set([...parsed.paths.runtimeDenyRoots, ...currentRuntimeRoots]),
  ];
  const currentLaunch = codexE2ELaunchContract({
    repositoryRoot: parsed.paths.repository,
    isolatedHome: parsed.paths.agentHome,
    codexHome: parsed.launch.environment.CODEX_HOME,
    disabledOperatorSkillPaths: [],
    readDeniedPaths: [
      parsed.paths.sourceRoot,
      parsed.paths.registry,
      parsed.paths.operatorCodexHome,
      scenarioContainer,
      ...currentRuntimeDenyRoots,
    ],
    writeAllowedPaths:
      scenario.composition.fixtureProfile === "fresh-installation-repository"
        ? [join(parsed.paths.agentHome, ".agents/skills")]
        : [],
    program: parsed.launch.initial.program,
    skipGitRepositoryCheck: scenario.composition.fixtureProfile === "non-project-directory",
    ...(parsed.fixtureIdentity.runtime === undefined
      ? {}
      : { shellProgram: parsed.fixtureIdentity.runtime.shell.program }),
  });
  if (parsed.github !== undefined) {
    const expectedScopeKey = deriveLiveScenarioGitHubScopeKey({
      packageVersion: parsed.package.packageVersion,
      sourceIdentity:
        parsed.package.evidenceClass === "release-candidate"
          ? parsed.package.sourceCommit
          : parsed.package.sourceHead,
      packIdentity:
        parsed.package.evidenceClass === "release-candidate"
          ? `${parsed.package.workflow.runId}/${parsed.package.workflow.runAttempt}`
          : parsed.package.worktreeSha256,
      artifactSha256: parsed.package.artifact.sha256,
      matrixDefinitionSha256: parsed.matrixDefinitionSha256,
      generationId: parsed.generationId,
      journeyAttempt: 1,
    });
    const fixed = await readFixedGitHubValidationRepository(parsed.paths.sourceRoot);
    const remote = await inspectGitHubRepository(
      parsed.github.program,
      parsed.github.repositorySlug,
    );
    const baselinePath = parsed.paths.baselineInventory ?? fail("GitHub baseline is unavailable.");
    if (
      parsed.github.scopeKey !== expectedScopeKey ||
      fixed.configuration.repositorySlug !== parsed.github.repositorySlug ||
      fixed.configuration.repositoryIdentitySha256 !== parsed.github.repositoryIdentitySha256 ||
      remote.viewerPermission !== parsed.github.viewerPermission ||
      sha256(await readFile(baselinePath)) !== parsed.github.baselineInventorySha256
    ) {
      fail("GitHub Live Scenario remote identity changed after preparation.");
    }
  }
  return Object.freeze({ ...parsed, scenario, launch: currentLaunch });
};
