import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
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
import { liveScenarioPackageSchema } from "./live-scenario-evidence";
import {
  installLiveScenarioProduct,
  materializeGitHubLiveScenarioPlanningState,
  materializeLiveScenarioProductState,
} from "./live-scenario-product";
import {
  digestLiveScenarioFixture,
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
const installationEntryToken = ["$", "{INSTALL_ENTRY}"].join("");
export const LIVE_SCENARIO_COORDINATOR_IDENTITY = "codex-coordinator" as const;

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
  paths: z.object({
    sourceRoot: z.string(),
    registry: z.string(),
    workspaceRoot: z.string(),
    manifest: z.string(),
    manifestDigest: z.string(),
    installationEntry: z.string(),
    installationGuide: z.string(),
    agentHome: z.string(),
    repository: z.string(),
    observations: z.string(),
    attempts: z.string(),
    transcripts: z.string(),
    sessionState: z.string(),
    prompts: z.array(z.string()).min(1),
    remoteInventories: z.string().optional(),
    baselineInventory: z.string().optional(),
  }),
  launch: z.object({
    environment: z.object({ HOME: z.string(), CODEX_HOME: z.string() }),
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
      journeyAttempt: z.number().int().positive().default(1),
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
  await loadLiveScenarioRegistry(registryPath);
  const frames = [
    `registry\0${relative(sourceRoot, registryPath)}\0${sha256(await readFile(registryPath))}\n`,
  ];
  const fixtureRoot = resolve(sourceRoot, "validation/live-journey/fixtures");
  frames.push(
    `fixtures\0${relative(sourceRoot, fixtureRoot)}\0${await digestLiveScenarioFixture(fixtureRoot)}\n`,
  );
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
  const registryRelative = relative(sourceRoot, resolve(sourceRoot, input.registryPath));
  const fixturesRelative = relative(
    sourceRoot,
    resolve(sourceRoot, "validation/live-journey/fixtures"),
  );
  if (
    registryRelative.startsWith("..") ||
    isAbsolute(registryRelative) ||
    fixturesRelative.startsWith("..") ||
    isAbsolute(fixturesRelative)
  ) {
    fail("Live Scenario Candidate definitions must stay inside the source checkout.");
  }
  const definition = {
    sourceRoot,
    sourceCommit,
    pathspecs: [registryRelative, fixturesRelative],
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
  journeyAttempt?: number;
}) => {
  const sourceRoot = resolve(input.sourceRoot);
  const workspaceRoot = resolve(input.workspaceRoot);
  await ensureIndependentNewWorkspace(sourceRoot, workspaceRoot);
  const registryPath = await realpath(resolve(sourceRoot, input.registryPath));
  const registry = await loadLiveScenarioRegistry(registryPath);
  const scenario =
    registry.scenarios.find(({ id }) => id === input.scenarioId) ??
    fail(`Unknown Live Scenario: ${input.scenarioId}.`);
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

  const agentHome = join(workspaceRoot, "agent-home");
  const repository = join(workspaceRoot, "repository");
  const observations = join(workspaceRoot, "observations");
  const attempts = join(workspaceRoot, "attempts");
  const transcripts = join(workspaceRoot, "transcripts");
  const remoteInventories = join(workspaceRoot, "github/remote-inventories");
  const promptDirectory = join(workspaceRoot, "prompts");
  const manifestPath = join(workspaceRoot, "scenario-manifest.json");
  const manifestDigest = `${manifestPath}.sha256`;
  const installationGuide = join(workspaceRoot, "agent-installation.md");
  const installationEntryPath = join(workspaceRoot, "README.local.md");
  const sessionState = join(workspaceRoot, "codex-session.json");
  await Promise.all([
    mkdir(agentHome, { recursive: true }),
    mkdir(observations, { recursive: true }),
    mkdir(attempts, { recursive: true }),
    mkdir(transcripts, { recursive: true }),
    mkdir(promptDirectory, { recursive: true }),
  ]);
  const agentCodexHome = await prepareIsolatedCodexHome({
    operatorCodexHome: resolve(input.operatorCodexHome),
    isolatedHome: agentHome,
  });
  const operatorContext = await inspectCodexE2EOperatorContext(agentCodexHome);
  await writeFile(
    installationGuide,
    await packageFile(matrixPackage.artifact.path, "package/docs/agent-installation.md"),
    { flag: "wx" },
  );
  await writeFile(
    installationEntryPath,
    installationEntry({
      packageName: matrixPackage.packageName,
      packageVersion: matrixPackage.packageVersion,
      artifactPath: matrixPackage.artifact.path,
      artifactSha256: matrixPackage.artifact.sha256,
      installationGuide,
    }),
    { flag: "wx" },
  );
  if (scenario.fixture.materializer === "active-github-repository") {
    cloneGitHubFixture({
      checkout:
        input.githubCheckout ??
        fail("GitHub Live Scenario requires the fixed repository checkout."),
      repository,
      workspaceRoot,
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
    if (scenario.fixture.materializer !== "non-project-directory") {
      initializeRepository(repository);
    }
  }
  let installedSkillSha256: string | null = null;
  const journeyAttempt = z
    .number()
    .int()
    .positive()
    .parse(input.journeyAttempt ?? 1);
  if (
    scenario.fixture.materializer !== "active-github-repository" &&
    input.journeyAttempt !== undefined
  ) {
    fail("Journey attempt is only available for the GitHub Live Scenario.");
  }
  let github:
    | Readonly<{
        program: string;
        repositorySlug: string;
        repositoryIdentitySha256: string;
        viewerPermission: string;
        journeyAttempt: number;
        scopeKey: string;
        baselineInventorySha256: string;
        preparedGitConfigSha256: string;
      }>
    | undefined;
  let baselineInventory: string | undefined;
  if (scenario.id !== "INSTALL-01") {
    const productProgram = await installLiveScenarioProduct({
      tarball: matrixPackage.artifact.path,
      installRoot: join(workspaceRoot, "product-install"),
      agentHome,
    });
    if (scenario.fixture.materializer === "active-github-repository") {
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
        journeyAttempt,
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
        journeyAttempt,
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
      if (inspected.exitCode !== 0 || !inspected.stdout.toString().includes('"state": "active"')) {
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
  const launch = codexE2ELaunchContract({
    repositoryRoot: repository,
    isolatedHome: agentHome,
    codexHome: agentCodexHome,
    disabledOperatorSkillPaths: operatorContext.disabledSkills.map(({ locator }) => locator),
    readDeniedPaths: [sourceRoot, registryPath],
    skipGitRepositoryCheck: scenario.fixture.materializer === "non-project-directory",
    ...(input.codexProgram === undefined ? {} : { program: input.codexProgram }),
  });
  const manifest = Object.freeze({
    schemaVersion: 1 as const,
    generationId: z
      .string()
      .uuid()
      .parse(input.generationId ?? randomUUID()),
    coordinatorIdentity: LIVE_SCENARIO_COORDINATOR_IDENTITY,
    evidenceClass: matrixPackage.evidenceClass,
    scenario,
    package: matrixPackage,
    matrixDefinitionSha256,
    operatorContextFingerprint: operatorContext.fingerprint,
    startingStateSha256: await digestLiveScenarioFixture(repository),
    installedSkillSha256,
    paths: Object.freeze({
      sourceRoot,
      registry: registryPath,
      workspaceRoot,
      manifest: manifestPath,
      manifestDigest,
      installationEntry: installationEntryPath,
      installationGuide,
      agentHome,
      repository,
      observations,
      attempts,
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
  await probeCodexE2EPermissionProfile({
    program: launch.initial.program,
    repositoryRoot: repository,
    isolatedHome: agentHome,
    codexHome: agentCodexHome,
    manifestPath,
    registryPath,
    sourceRoot,
  });
  return manifest;
};

export const verifyLiveScenarioGeneration = async (path: string) => {
  const manifestPath = resolve(path);
  const bytes = await readFile(manifestPath, "utf8");
  if ((await readFile(`${manifestPath}.sha256`, "utf8")).trim() !== sha256(bytes)) {
    fail("Live Scenario manifest digest mismatch.");
  }
  const parsed = manifestSchema.parse(JSON.parse(bytes));
  if (
    parsed.paths.manifest !== manifestPath ||
    parsed.paths.manifestDigest !== `${manifestPath}.sha256`
  ) {
    fail("Live Scenario manifest locator mismatch.");
  }
  const registry = await loadLiveScenarioRegistry(parsed.paths.registry);
  const scenario =
    registry.scenarios.find(({ id }) => id === parsed.scenario.id) ??
    fail(`Live Scenario is no longer registered: ${parsed.scenario.id}.`);
  if (JSON.stringify(scenario) !== JSON.stringify(parsed.scenario)) {
    fail("Live Scenario definition changed after preparation.");
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
  const observationNames = await readdir(parsed.paths.observations);
  if (observationNames.length === 0) {
    const currentFixtureSha256 = await digestLiveScenarioFixture(parsed.paths.repository);
    if (currentFixtureSha256 !== parsed.startingStateSha256) {
      fail("Live Scenario fixture changed before Agent behavior.");
    }
  }
  if (
    parsed.installedSkillSha256 !== null &&
    (await digestLiveScenarioFixture(join(parsed.paths.agentHome, "skill-directory/bearing"))) !==
      parsed.installedSkillSha256
  ) {
    fail("Preinstalled Bearing Skill changed after Scenario preparation.");
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
  const expectedLaunch = codexE2ELaunchContract({
    repositoryRoot: parsed.paths.repository,
    isolatedHome: parsed.paths.agentHome,
    codexHome: parsed.launch.environment.CODEX_HOME,
    disabledOperatorSkillPaths: [],
    readDeniedPaths: [parsed.paths.sourceRoot, parsed.paths.registry],
    program: parsed.launch.initial.program,
    skipGitRepositoryCheck: scenario.fixture.materializer === "non-project-directory",
  });
  if (JSON.stringify(expectedLaunch) !== JSON.stringify(parsed.launch)) {
    fail("Live Scenario Codex launch changed before Agent behavior.");
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
      journeyAttempt: parsed.github.journeyAttempt,
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
  return Object.freeze({ ...parsed, scenario });
};
