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
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { encodeGitHubMattNativeScope } from "../src/providers/matt-skills-v1/github";
import {
  assertIsolatedCodexHomeControlLinks,
  codexE2ELaunchContract,
  inspectCodexE2EToolchain,
  prepareCodexE2EShellEnvironment,
  prepareIsolatedCodexHome,
  probeCodexE2EPermissionProfile,
  resolveCodexE2EProgram,
  verifyCodexE2EToolchain,
} from "./codex-e2e-runtime";
import {
  captureGitHubRemoteInventory,
  cleanupGitHubMatrixFixture,
  deriveGitHubJourneyScopeKey,
  type GitHubMatrixFixtureLifecycle,
  inspectGitHubRepository,
  operatorGitHubToken,
  prepareGitHubMatrixFixture,
  provisionIsolatedGitHubAccountSelection,
  readFixedGitHubValidationRepository,
} from "./github-live-journey";
import { createCodexJourneyEnvironment } from "./live-journey-matrix";
import { liveScenarioPackageSchema } from "./live-scenario-evidence";
import {
  installLiveScenarioProduct,
  materializeDeclaredPrerequisiteSkills,
  materializeGitHubLiveScenarioPlanningState,
  materializeLiveScenarioProductState,
} from "./live-scenario-product";
import {
  digestLiveScenarioFixture,
  digestLiveScenarioFixtureSet,
  liveScenarioReferencedFixtureSources,
  liveScenarioSchema,
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

const liveScenarioRuntimeContainerName = "bearing-live-scenario-runtimes";

const liveScenarioRuntimeContainer = (temporaryRoot: string) =>
  join(temporaryRoot, liveScenarioRuntimeContainerName);

const liveScenarioRuntimeRoot = (
  temporaryRoot: string,
  generationId: string,
  scenarioId: string,
  workspaceRoot: string,
) =>
  join(
    liveScenarioRuntimeContainer(temporaryRoot),
    `scenario-${sha256(`${generationId}\0${scenarioId}\0${workspaceRoot}`).slice(0, 32)}`,
  );

const ensureLiveScenarioRuntimeContainer = async (temporaryRoot: string): Promise<string> => {
  const container = liveScenarioRuntimeContainer(temporaryRoot);
  try {
    await mkdir(container, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const identity = await lstat(container);
  if (
    !identity.isDirectory() ||
    identity.isSymbolicLink() ||
    (typeof process.getuid === "function" && identity.uid !== process.getuid())
  ) {
    fail("Live Scenario runtime container must be a private owned directory.");
  }
  await chmod(container, 0o700);
  return realpath(container);
};

const liveScenarioReadDeniedPaths = (input: {
  sourceRoot: string;
  registryPath: string;
  operatorCodexHome: string;
  scenarioContainer: string;
}) => [input.sourceRoot, input.registryPath, input.operatorCodexHome, input.scenarioContainer];

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

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  generationId: z.string().uuid(),
  coordinatorIdentity: z.literal(LIVE_SCENARIO_COORDINATOR_IDENTITY),
  evidenceClass: z.enum(["local-rehearsal", "release-candidate"]),
  scenario: liveScenarioSchema,
  package: liveScenarioPackageSchema,
  matrixDefinitionSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  startingStateSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  installationGuideSha256: z.string().regex(/^[0-9a-f]{64}$/u),
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
  }),
  paths: z.object({
    sourceRoot: z.string(),
    registry: z.string(),
    operatorCodexHome: z.string(),
    workspaceRoot: z.string(),
    runtimeRoot: z.string(),
    runtimeTempDirectory: z.string(),
    manifest: z.string(),
    manifestDigest: z.string(),
    installationArtifact: z.string(),
    installationEntry: z.string(),
    installationGuide: z.string(),
    agentHome: z.string(),
    repository: z.string(),
    observations: z.string(),
    events: z.string(),
    conversation: z.string(),
    terminal: z.string(),
    result: z.string(),
    sessionState: z.string(),
    initialPrompt: z.string(),
    remoteInventories: z.string().optional(),
    baselineInventory: z.string().optional(),
  }),
  toolchain: z.object({
    nodeExecutable: z.string(),
    nodeBin: z.string(),
    nodeInstallRoot: z.string(),
    openSslConfig: z.string(),
    selectedDeveloperDirectory: z.string(),
    gitExecutable: z.string(),
    path: z.string(),
  }),
  launch: z.object({
    environment: z.object({
      HOME: z.string(),
      CODEX_HOME: z.string(),
      TMPDIR: z.string(),
      PATH: z.string(),
      DEVELOPER_DIR: z.string(),
      npm_config_script_shell: z.literal("/bin/bash"),
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
      fixtureLifecycle: z.object({
        repositorySlug: z.string().min(1),
        repository: z.object({
          databaseId: z.number().int().positive(),
          nodeId: z.string().min(1),
        }),
        scopeKey: z.string().min(1),
        generationId: z.string().uuid(),
        milestone: z.object({ number: z.number().int().positive(), title: z.string().min(1) }),
        parent: z.object({
          id: z.number().int().positive(),
          nodeId: z.string().min(1),
          number: z.number().int().positive(),
        }),
        child: z.object({
          id: z.number().int().positive(),
          nodeId: z.string().min(1),
          number: z.number().int().positive(),
        }),
      }),
    })
    .optional(),
});

export type LiveScenarioGenerationManifest = z.infer<typeof manifestSchema>;

export const readLiveScenarioGenerationManifest = async (path: string) => {
  const manifestPath = resolve(path);
  const bytes = await readFile(manifestPath, "utf8");
  if ((await readFile(`${manifestPath}.sha256`, "utf8")).trim() !== sha256(bytes)) {
    fail("Live Scenario manifest digest mismatch.");
  }
  const manifest = manifestSchema.parse(JSON.parse(bytes));
  if (
    manifest.paths.manifest !== manifestPath ||
    manifest.paths.manifestDigest !== `${manifestPath}.sha256` ||
    manifest.paths.workspaceRoot !== dirname(manifestPath)
  ) {
    fail("Live Scenario manifest locator mismatch.");
  }
  const registry = await loadLiveScenarioRegistry(manifest.paths.registry);
  const scenario =
    registry.scenarios.find(({ id }) => id === manifest.scenario.id) ??
    fail(`Live Scenario is no longer registered: ${manifest.scenario.id}.`);
  if (JSON.stringify(scenario) !== JSON.stringify(manifest.scenario)) {
    fail("Live Scenario definition changed after preparation.");
  }
  return Object.freeze({ ...manifest, scenario });
};

type LiveScenarioGenerationManifestReadback = Awaited<
  ReturnType<typeof readLiveScenarioGenerationManifest>
>;

const verifyLiveScenarioAgentInputs = async (parsed: LiveScenarioGenerationManifestReadback) => {
  if ((await sha256File(parsed.paths.installationArtifact)) !== parsed.package.artifact.sha256) {
    fail("Live Scenario installation package copy changed after preparation.");
  }
  if (
    (await sha256File(parsed.paths.installationGuide)) !== parsed.installationGuideSha256 ||
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
  const observationNames = await readdir(parsed.paths.observations);
  if (parsed.installedSkillSha256 !== null) {
    const currentSkillSha256 = await digestLiveScenarioFixture(
      join(parsed.paths.agentHome, "skill-directory/bearing"),
    );
    if (currentSkillSha256 !== parsed.installedSkillSha256) {
      fail("Preinstalled Bearing Skill changed outside the recorded Scenario transition.");
    }
  }
  const expectedEnvironment = createCodexJourneyEnvironment(
    process.env,
    parsed.launch.environment,
    {
      includeCanonicalBearingBin:
        parsed.scenario.fixedValidationFixture.profile !== "fresh-installation-repository",
    },
  );
  await assertIsolatedCodexHomeControlLinks(parsed.paths.agentHome, expectedEnvironment["PATH"]);
  const expectedPrompt = parsed.scenario.initialPrompt.replaceAll(
    installationEntryToken,
    parsed.paths.installationEntry,
  );
  if ((await readFile(parsed.paths.initialPrompt, "utf8")) !== `${expectedPrompt}\n`) {
    fail("Live Scenario Initial Prompt changed before Agent behavior.");
  }
  const scenarioContainer = await realpath(dirname(parsed.paths.workspaceRoot));
  const storedLaunch = codexE2ELaunchContract({
    repositoryRoot: parsed.paths.repository,
    isolatedHome: parsed.paths.agentHome,
    codexHome: parsed.launch.environment.CODEX_HOME,
    runtimeTempDirectory: parsed.paths.runtimeTempDirectory,
    toolchain: parsed.toolchain,
    disabledOperatorSkillPaths: [],
    readDeniedPaths: [
      parsed.paths.sourceRoot,
      parsed.paths.registry,
      parsed.paths.operatorCodexHome,
      scenarioContainer,
    ],
    writeAllowedPaths:
      parsed.scenario.fixedValidationFixture.profile === "fresh-installation-repository"
        ? [join(parsed.paths.agentHome, ".agents/skills")]
        : [],
    program: parsed.launch.initial.program,
    ...(parsed.fixtureIdentity.runtime === undefined
      ? {}
      : { shellProgram: parsed.fixtureIdentity.runtime.shell.program }),
  });
  if (JSON.stringify(storedLaunch) !== JSON.stringify(parsed.launch)) {
    fail("Live Scenario Codex launch changed before Agent behavior.");
  }
  return Object.freeze({ launch: storedLaunch, observationNames: Object.freeze(observationNames) });
};

export const verifyLiveScenarioBehaviorBoundary = async (path: string) => {
  const parsed = await readLiveScenarioGenerationManifest(path);
  const verified = await verifyLiveScenarioAgentInputs(parsed);
  return Object.freeze({ ...parsed, launch: verified.launch });
};

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

const CODEX_DARWIN_PLATFORM_SCRATCH_ROOTS = [
  "/tmp",
  "/private/tmp",
  "/var/tmp",
  "/private/var/tmp",
] as const;

const isAtOrBelow = (root: string, candidate: string): boolean => {
  const relation = relative(root, candidate);
  return (
    relation === "" ||
    (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`))
  );
};

export const ensureLiveScenarioCoordinatorWorkspace = async (
  sourceRoot: string,
  workspaceRoot: string,
): Promise<void> => {
  await ensureIndependentNewWorkspace(sourceRoot, workspaceRoot);
  if (process.platform !== "darwin") return;

  const canonicalParent = await realpath(dirname(workspaceRoot));
  const canonicalWorkspace = join(canonicalParent, basename(workspaceRoot));
  const scratchRoots = new Set<string>();
  for (const root of CODEX_DARWIN_PLATFORM_SCRATCH_ROOTS) {
    try {
      scratchRoots.add(await realpath(root));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  if ([...scratchRoots].some((root) => isAtOrBelow(root, canonicalWorkspace))) {
    fail(
      "Scenario Coordinator workspace must stay outside Codex macOS platform scratch roots (/tmp, /private/tmp, /var/tmp, /private/var/tmp).",
    );
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

export const materializeGitHubScenarioRepositoryFixture = async (input: {
  repository: string;
  fixtureRoot: string;
}): Promise<void> => {
  for (const entry of await readdir(input.repository, { withFileTypes: true })) {
    if (entry.name !== ".git") {
      await rm(join(input.repository, entry.name), { recursive: true, force: true });
    }
  }
  for (const entry of await readdir(input.fixtureRoot, { withFileTypes: true })) {
    if (entry.name === ".git") fail("GitHub Live Scenario fixture must not contain .git.");
    await cp(join(input.fixtureRoot, entry.name), join(input.repository, entry.name), {
      recursive: true,
      force: true,
    });
  }
  await rm(join(input.repository, ".scratch"), { recursive: true, force: true });
  git(input.repository, ["add", "-A"]);
  if (git(input.repository, ["status", "--porcelain=v1"]) !== "") {
    git(input.repository, [
      "-c",
      "user.name=Bearing Live Matrix",
      "-c",
      "user.email=live-matrix@example.invalid",
      "commit",
      "-qm",
      "Install tracked GitHub delivery fixture",
    ]);
  }
  git(input.repository, ["switch", "-c", "delivery-work"]);
  if (git(input.repository, ["status", "--porcelain=v1"]) !== "") {
    fail("GitHub Live Scenario fixture did not produce a clean baseline.");
  }
};

export const installGitHubScenarioProviderContract = async (input: {
  sourceRoot: string;
  repository: string;
}): Promise<void> => {
  const relativePath = "docs/agents/issue-tracker.md";
  const sourcePath = join(
    input.sourceRoot,
    "validation/live-journey/fixtures/github-provider/docs/agents/issue-tracker.md",
  );
  await cp(sourcePath, join(input.repository, relativePath), { force: true });
  if (
    !Buffer.from(await readFile(sourcePath)).equals(
      Buffer.from(await readFile(join(input.repository, relativePath))),
    )
  ) {
    fail("GitHub Live Scenario provider contract failed exact readback.");
  }
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
  const requestedWorkspaceRoot = resolve(input.workspaceRoot);
  const workspaceRoot = join(
    await realpath(dirname(requestedWorkspaceRoot)),
    basename(requestedWorkspaceRoot),
  );
  await ensureLiveScenarioCoordinatorWorkspace(sourceRoot, workspaceRoot);
  const operatorCodexHome = await realpath(resolve(input.operatorCodexHome));
  const registryPath = await realpath(resolve(sourceRoot, input.registryPath));
  const registry = await loadLiveScenarioRegistry(registryPath);
  const scenario =
    registry.scenarios.find(({ id }) => id === input.scenarioId) ??
    fail(`Unknown Live Scenario: ${input.scenarioId}.`);
  const fixtureRuntime =
    scenario.fixedValidationFixture.profile === "fresh-installation-repository"
      ? await inspectG1InstallationRuntime()
      : undefined;
  const generationId = z
    .string()
    .uuid()
    .parse(input.generationId ?? randomUUID());
  const temporaryRoot = await realpath(tmpdir());
  const runtimeContainer = await ensureLiveScenarioRuntimeContainer(temporaryRoot);
  const [toolchain, codexProgram] = await Promise.all([
    inspectCodexE2EToolchain(),
    resolveCodexE2EProgram(input.codexProgram ?? "codex"),
  ]);
  const scenarioContainer = await realpath(dirname(workspaceRoot));
  const runtimeRoot = liveScenarioRuntimeRoot(
    temporaryRoot,
    generationId,
    scenario.id,
    workspaceRoot,
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
  let workspaceCreated = false;
  let runtimeCreated = false;
  let githubFixtureLifecycle: GitHubMatrixFixtureLifecycle | undefined;
  try {
    await mkdir(workspaceRoot);
    workspaceCreated = true;
    await mkdir(runtimeRoot);
    runtimeCreated = true;
    const runtimeTempDirectory = join(runtimeRoot, "tmp");
    const agentHome = join(runtimeRoot, "agent-home");
    const repository = join(runtimeRoot, "repository");
    const observations = join(workspaceRoot, "observations");
    const events = join(workspaceRoot, "events");
    const conversation = join(workspaceRoot, "conversation.md");
    const terminal = join(workspaceRoot, "terminal");
    const result = join(workspaceRoot, "result.json");
    const remoteInventories = join(workspaceRoot, "github/remote-inventories");
    const promptDirectory = join(workspaceRoot, "prompts");
    const manifestPath = join(workspaceRoot, "scenario-manifest.json");
    const manifestDigest = `${manifestPath}.sha256`;
    const installationSource = join(agentHome, "install-source");
    const installationArtifact = join(installationSource, matrixPackage.artifact.file);
    const installationGuide = join(installationSource, "agent-installation.md");
    const installationEntryPath = join(installationSource, "README.local.md");
    const installationGuideBytes = await packageFile(
      matrixPackage.artifact.path,
      "package/docs/agent-installation.md",
    );
    const sessionState = join(workspaceRoot, "codex-session.json");
    await Promise.all([
      mkdir(runtimeTempDirectory, { mode: 0o700 }),
      mkdir(agentHome, { recursive: true }),
      mkdir(observations, { recursive: true }),
      mkdir(events, { recursive: true }),
      mkdir(terminal, { recursive: true }),
      mkdir(promptDirectory, { recursive: true }),
    ]);
    await mkdir(installationSource);
    const agentCodexHome = await prepareIsolatedCodexHome({
      operatorCodexHome,
      isolatedHome: agentHome,
    });
    if (scenario.fixedValidationFixture.profile === "fresh-installation-repository") {
      await mkdir(join(agentHome, ".agents/skills"), { recursive: true });
    }
    await Promise.all([
      writeFile(installationArtifact, await readFile(matrixPackage.artifact.path), {
        flag: "wx",
        mode: 0o600,
      }),
      writeFile(installationGuide, installationGuideBytes, { flag: "wx" }),
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
    if (scenario.fixedValidationFixture.profile === "active-github-repository") {
      cloneGitHubFixture({
        checkout:
          input.githubCheckout ??
          fail("GitHub Live Scenario requires the fixed repository checkout."),
        repository,
        workspaceRoot: runtimeRoot,
      });
      await materializeGitHubScenarioRepositoryFixture({
        repository,
        fixtureRoot: join(sourceRoot, scenario.fixedValidationFixture.source),
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
      initializeRepository(repository);
    }
    let installedSkillSha256: string | null = null;
    let github:
      | Readonly<{
          program: string;
          repositorySlug: string;
          repositoryIdentitySha256: string;
          viewerPermission: string;
          scopeKey: string;
          baselineInventorySha256: string;
          preparedGitConfigSha256: string;
          fixtureLifecycle: GitHubMatrixFixtureLifecycle;
        }>
      | undefined;
    let baselineInventory: string | undefined;
    const bearingInstallationUnderTest = scenario.fixedValidationFixture.skills.some(
      ({ skill, role }) => skill === "bearing" && role === "installation-under-test",
    );
    if (!bearingInstallationUnderTest) {
      const productProgram = await installLiveScenarioProduct({
        tarball: matrixPackage.artifact.path,
        installRoot: join(runtimeRoot, "product-install"),
        agentHome,
        installGlobalKit: true,
      });
      if (scenario.fixedValidationFixture.profile === "active-github-repository") {
        const githubProgram = input.githubProgram ?? "gh";
        const fixed = await readFixedGitHubValidationRepository(sourceRoot);
        const remote = await inspectGitHubRepository(
          githubProgram,
          fixed.configuration.repositorySlug,
        );
        await provisionIsolatedGitHubAccountSelection({
          program: githubProgram,
          agentHome,
          nodeProgram: toolchain.nodeExecutable,
        });
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
        githubFixtureLifecycle = await prepareGitHubMatrixFixture({
          sourceRoot,
          program: githubProgram,
          repositorySlug: fixed.configuration.repositorySlug,
          scopeKey,
          generationId,
        });
        const parsedSlug = fixed.configuration.repositorySlug.split("/") as [string, string];
        const nativeScope = encodeGitHubMattNativeScope({
          host: "github.com",
          rootKind: "parent-issue",
          repository: {
            owner: parsedSlug[0],
            name: parsedSlug[1],
            databaseId: String(githubFixtureLifecycle.repository.databaseId),
            nodeId: githubFixtureLifecycle.repository.nodeId,
          },
          root: {
            objectKind: "issue",
            number: githubFixtureLifecycle.parent.number,
            databaseId: String(githubFixtureLifecycle.parent.id),
            nodeId: githubFixtureLifecycle.parent.nodeId,
          },
        });
        await materializeGitHubLiveScenarioPlanningState({
          sourceRoot,
          repositoryRoot: repository,
          productProgram,
          agentHome,
          nativeScope,
          nativeReferences: [
            `https://github.com/${fixed.configuration.repositorySlug}/issues/${githubFixtureLifecycle.parent.number}`,
            `https://github.com/${fixed.configuration.repositorySlug}/issues/${githubFixtureLifecycle.child.number}`,
          ],
          githubToken: await operatorGitHubToken(githubProgram),
        });
        const baseline = await captureGitHubRemoteInventory({
          program: githubProgram,
          repositorySlug: fixed.configuration.repositorySlug,
          scopeKey,
          issueNumbers: [githubFixtureLifecycle.parent.number, githubFixtureLifecycle.child.number],
        });
        if (
          baseline.repositoryIdentitySha256 !== fixed.configuration.repositoryIdentitySha256 ||
          baseline.issues.filter((issue) => issue.candidateScoped).length !== 2
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
          fixtureLifecycle: githubFixtureLifecycle,
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
      }
      installedSkillSha256 = await digestLiveScenarioFixture(
        join(agentHome, "skill-directory/bearing"),
      );
    }
    const declaredPrerequisites = scenario.fixedValidationFixture.skills.filter(
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
    const initialPrompt = scenario.initialPrompt.replaceAll(
      installationEntryToken,
      installationEntryPath,
    );
    if (/\$\{[A-Z_]+\}/u.test(initialPrompt)) {
      fail(`Live Scenario prompt has an unresolved runtime value: ${scenario.id}.`);
    }
    const initialPromptPath = join(promptDirectory, "initial.txt");
    await writeFile(initialPromptPath, `${initialPrompt}\n`, { flag: "wx" });
    const readDeniedPaths = liveScenarioReadDeniedPaths({
      sourceRoot,
      registryPath,
      operatorCodexHome,
      scenarioContainer,
    });
    const writeAllowedPaths =
      scenario.fixedValidationFixture.profile === "fresh-installation-repository"
        ? [join(agentHome, ".agents/skills")]
        : [];
    const launch = codexE2ELaunchContract({
      repositoryRoot: repository,
      isolatedHome: agentHome,
      codexHome: agentCodexHome,
      runtimeTempDirectory,
      toolchain,
      disabledOperatorSkillPaths: [],
      readDeniedPaths,
      writeAllowedPaths,
      ...(fixtureRuntime === undefined ? {} : { shellProgram: fixtureRuntime.shell.program }),
      program: codexProgram,
    });
    const effectiveEnvironment = createCodexJourneyEnvironment(process.env, launch.environment, {
      includeCanonicalBearingBin:
        scenario.fixedValidationFixture.profile !== "fresh-installation-repository",
    });
    await prepareCodexE2EShellEnvironment({
      isolatedHome: agentHome,
      path: effectiveEnvironment["PATH"] ?? fail("Codex E2E PATH is unavailable."),
    });
    const manifest = Object.freeze({
      schemaVersion: 1 as const,
      generationId,
      coordinatorIdentity: LIVE_SCENARIO_COORDINATOR_IDENTITY,
      evidenceClass: matrixPackage.evidenceClass,
      scenario,
      package: matrixPackage,
      matrixDefinitionSha256,
      startingStateSha256: await digestLiveScenarioFixture(repository),
      installationGuideSha256: sha256(installationGuideBytes),
      installedSkillSha256,
      fixtureIdentity: Object.freeze({
        ...(fixtureRuntime === undefined ? {} : { runtime: fixtureRuntime }),
      }),
      paths: Object.freeze({
        sourceRoot,
        registry: registryPath,
        operatorCodexHome,
        workspaceRoot,
        runtimeRoot,
        runtimeTempDirectory,
        manifest: manifestPath,
        manifestDigest,
        installationArtifact,
        installationEntry: installationEntryPath,
        installationGuide,
        agentHome,
        repository,
        observations,
        events,
        conversation,
        terminal,
        result,
        sessionState,
        initialPrompt: initialPromptPath,
        ...(github === undefined ? {} : { remoteInventories, baselineInventory }),
      }),
      toolchain,
      launch,
      ...(github === undefined ? {} : { github }),
    });
    await assertLiveScenarioSourceCurrent(sourceRoot, matrixPackage);
    const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, bytes, { flag: "wx", mode: 0o600 });
    await writeFile(manifestDigest, `${sha256(bytes)}\n`, { flag: "wx", mode: 0o600 });
    if (input.deferPermissionProbe !== true) {
      await probeCodexE2EPermissionProfile({
        launch,
        manifestPath,
        registryPath,
        sourceRoot,
        operatorCodexHome,
        scenarioWorkspace: workspaceRoot,
        installationEntryPath,
        runtimeContainer,
        toolchain,
        isProjectRepository: true,
        writeAllowedPaths,
        effectiveEnvironment,
      });
    }
    return manifest;
  } catch (error) {
    await Promise.all([
      ...(githubFixtureLifecycle === undefined
        ? []
        : [
            cleanupGitHubMatrixFixture({
              lifecycle: githubFixtureLifecycle,
              ...(input.githubProgram === undefined ? {} : { program: input.githubProgram }),
            }),
          ]),
      ...(runtimeCreated ? [rm(runtimeRoot, { recursive: true, force: true })] : []),
      ...(workspaceCreated ? [rm(workspaceRoot, { recursive: true, force: true })] : []),
    ]);
    throw error;
  }
};

export const verifyLiveScenarioGeneration = async (path: string) => {
  const parsed = await readLiveScenarioGenerationManifest(path);
  const scenario = parsed.scenario;
  const runtimeContainer = await realpath(dirname(parsed.paths.runtimeRoot));
  const temporaryRoot = await realpath(dirname(runtimeContainer));
  const expectedRuntimeContainer = liveScenarioRuntimeContainer(temporaryRoot);
  const expectedRuntimeRoot = liveScenarioRuntimeRoot(
    temporaryRoot,
    parsed.generationId,
    scenario.id,
    parsed.paths.workspaceRoot,
  );
  if (
    parsed.paths.operatorCodexHome !== (await realpath(parsed.paths.operatorCodexHome)) ||
    runtimeContainer !== expectedRuntimeContainer ||
    parsed.paths.runtimeRoot !== expectedRuntimeRoot ||
    parsed.paths.runtimeTempDirectory !== join(expectedRuntimeRoot, "tmp") ||
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
  await verifyCodexE2EToolchain(parsed.toolchain);
  const expectsInstallationRuntime =
    scenario.fixedValidationFixture.profile === "fresh-installation-repository";
  if ((parsed.fixtureIdentity.runtime !== undefined) !== expectsInstallationRuntime) {
    fail("Live Scenario Fixture identity does not match its declared Fixture Profile.");
  }
  if (parsed.fixtureIdentity.runtime !== undefined) {
    const currentRuntime = await inspectG1InstallationRuntime();
    if (JSON.stringify(currentRuntime) !== JSON.stringify(parsed.fixtureIdentity.runtime)) {
      fail("G1 installation runtime identity changed after preparation.");
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
  await assertLiveScenarioArtifactPackageIdentity(parsed.package);
  await assertLiveScenarioSourceCurrent(parsed.paths.sourceRoot, parsed.package);
  const { launch: storedLaunch, observationNames } = await verifyLiveScenarioAgentInputs(parsed);
  if (observationNames.length === 0) {
    const currentFixtureSha256 = await digestLiveScenarioFixture(parsed.paths.repository);
    if (currentFixtureSha256 !== parsed.startingStateSha256) {
      fail("Live Scenario fixture changed before Agent behavior.");
    }
  }
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
  return Object.freeze({ ...parsed, scenario, launch: storedLaunch });
};
