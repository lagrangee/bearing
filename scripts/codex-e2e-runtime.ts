import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

export const CODEX_E2E_RUNTIME = Object.freeze({
  model: "gpt-5.6-luna",
  reasoningEffort: "high",
} as const);

export const CODEX_E2E_DISABLED_FEATURES = Object.freeze([
  "apps",
  "browser_use",
  "browser_use_external",
  "chronicle",
  "computer_use",
  "goals",
  "hooks",
  "image_generation",
  "memories",
  "plugin_sharing",
  "plugins",
  "skill_mcp_dependency_install",
  "tool_suggest",
  "workspace_dependencies",
] as const);

export const assertCodexE2EOutputIsolation = (input: {
  stdout: string;
  stderr: string;
  operatorCodexHome: string;
}): void => {
  if (
    input.stdout.includes(input.operatorCodexHome) ||
    input.stderr.includes(input.operatorCodexHome)
  ) {
    throw new Error("Codex E2E output exposed the operator configuration path.");
  }
};

export const prepareIsolatedCodexHome = async (input: {
  operatorCodexHome: string;
  isolatedHome: string;
}): Promise<string> => {
  const operatorCodexHome = await realpath(input.operatorCodexHome);
  const isolatedHome = await realpath(input.isolatedHome);
  const authSource = join(operatorCodexHome, "auth.json");
  const authState = await lstat(authSource);
  if (!authState.isFile()) {
    throw new Error("Codex E2E authentication input must be one regular auth.json file.");
  }
  const agentCodexHome = join(isolatedHome, ".codex");
  const skillDirectory = join(isolatedHome, "skill-directory");
  const shellDirectory = join(isolatedHome, ".shell");
  const runtimeAuthDirectory = join(isolatedHome, ".runtime-auth");
  const runtimeAuth = join(runtimeAuthDirectory, "auth.json");
  await Promise.all([
    mkdir(agentCodexHome, { recursive: false }),
    mkdir(skillDirectory, { recursive: false }),
    mkdir(shellDirectory, { recursive: false }),
    mkdir(runtimeAuthDirectory, { recursive: false }),
  ]);
  await symlink(authSource, runtimeAuth);
  await symlink(relative(agentCodexHome, runtimeAuth), join(agentCodexHome, "auth.json"));
  await symlink(skillDirectory, join(agentCodexHome, "skills"));
  return agentCodexHome;
};

export const assertIsolatedCodexHomeControlLinks = async (isolatedHome: string): Promise<void> => {
  const agentCodexHome = join(isolatedHome, ".codex");
  const agentAuth = join(agentCodexHome, "auth.json");
  const runtimeAuth = join(isolatedHome, ".runtime-auth/auth.json");
  const agentSkills = join(agentCodexHome, "skills");
  const skillDirectory = join(isolatedHome, "skill-directory");
  const [agentAuthState, runtimeAuthState, agentSkillsState] = await Promise.all([
    lstat(agentAuth),
    lstat(runtimeAuth),
    lstat(agentSkills),
  ]);
  if (
    !agentAuthState.isSymbolicLink() ||
    !runtimeAuthState.isSymbolicLink() ||
    !agentSkillsState.isSymbolicLink() ||
    (await realpath(agentAuth)) !== (await realpath(runtimeAuth)) ||
    (await realpath(agentSkills)) !== (await realpath(skillDirectory))
  ) {
    throw new Error("Codex E2E isolated control links changed after preparation.");
  }
};

export const codexE2ERuntimeArguments = (override?: unknown): readonly string[] => {
  if (override !== undefined) {
    throw new Error("The repository Codex E2E runtime does not accept runtime overrides.");
  }
  return [
    "--model",
    CODEX_E2E_RUNTIME.model,
    "--config",
    `model_reasoning_effort=${JSON.stringify(CODEX_E2E_RUNTIME.reasoningEffort)}`,
  ];
};

const CODEX_E2E_PERMISSION_PROFILE = "bearing_live_journey";

const codexE2EPermissionProfileConfiguration = (input: {
  repositoryRoot: string;
  isolatedHome: string;
  readDeniedPaths: readonly string[];
}) => {
  if (
    input.readDeniedPaths.length === 0 ||
    [input.repositoryRoot, input.isolatedHome, ...input.readDeniedPaths].some(
      (path) => !isAbsolute(path),
    )
  ) {
    throw new Error("Codex E2E permission paths must be non-empty absolute paths.");
  }
  const workspaceRoots = [input.repositoryRoot, input.isolatedHome]
    .map((path) => `${JSON.stringify(path)}=true`)
    .join(",");
  const deniedPaths = input.readDeniedPaths
    .map((path) => `${JSON.stringify(path)}="deny"`)
    .join(",");
  const gitMetadata = `${JSON.stringify(join(input.repositoryRoot, ".git"))}="write"`;
  return `permissions.${CODEX_E2E_PERMISSION_PROFILE}={workspace_roots={${workspaceRoots}},filesystem={":root"="read",":workspace_roots"="write",${gitMetadata},${deniedPaths}},network={enabled=false}}`;
};

export const probeCodexE2EPermissionProfile = async (input: {
  program: string;
  repositoryRoot: string;
  isolatedHome: string;
  codexHome: string;
  manifestPath: string;
  registryPath: string;
  sourceRoot: string;
  scenarioWorkspace: string;
  installationEntryPath: string;
  readDeniedPaths: readonly string[];
}): Promise<void> => {
  const scenarioContainer = dirname(input.scenarioWorkspace);
  const permissionProfile = codexE2EPermissionProfileConfiguration({
    repositoryRoot: input.repositoryRoot,
    isolatedHome: input.isolatedHome,
    readDeniedPaths: input.readDeniedPaths,
  });
  const controlPath = join(input.repositoryRoot, ".bearing-live-journey-permission-probe");
  const siblingProbePath = join(
    scenarioContainer,
    `.bearing-live-journey-sibling-probe-${basename(input.scenarioWorkspace)}`,
  );
  const manifestMode = (await lstat(input.manifestPath)).mode & 0o777;
  let controlCreated = false;
  let siblingCreated = false;
  let manifestHidden = false;
  try {
    await writeFile(controlPath, "repository-control\n", { flag: "wx", mode: 0o600 });
    controlCreated = true;
    await writeFile(siblingProbePath, "sibling-control\n", { flag: "wx", mode: 0o600 });
    siblingCreated = true;
    await chmod(input.manifestPath, 0o000);
    manifestHidden = true;
    const probe = Bun.spawn(
      [
        input.program,
        "sandbox",
        "--include-managed-config",
        "-c",
        permissionProfile,
        "-P",
        CODEX_E2E_PERMISSION_PROFILE,
        "-C",
        input.repositoryRoot,
        "/bin/sh",
        "-c",
        [
          'cat "$1" >/dev/null || exit 81',
          'cat "$2" >/dev/null || exit 82',
          'if cat "$3" >/dev/null 2>&1; then exit 83; fi',
          'if cat "$4" >/dev/null 2>&1; then exit 84; fi',
          'if /usr/bin/git -C "$5" show HEAD:validation/live-journey/registry.json >/dev/null 2>&1; then exit 85; fi',
          'if cat "$6" >/dev/null 2>&1; then exit 86; fi',
        ].join("\n"),
        "bearing-live-journey-permission-probe",
        controlPath,
        input.installationEntryPath,
        input.manifestPath,
        input.registryPath,
        input.sourceRoot,
        siblingProbePath,
      ],
      {
        cwd: input.repositoryRoot,
        env: { ...process.env, HOME: input.isolatedHome, CODEX_HOME: input.codexHome },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([probe.exited, new Response(probe.stderr).text()]);
    if (exitCode !== 0) {
      throw new Error(
        stderr.trim() || `Codex E2E permission profile probe failed with exit ${exitCode}.`,
      );
    }
  } finally {
    await Promise.all([
      ...(manifestHidden ? [chmod(input.manifestPath, manifestMode)] : []),
      ...(controlCreated ? [rm(controlPath, { force: true })] : []),
      ...(siblingCreated ? [rm(siblingProbePath, { force: true })] : []),
    ]);
  }
};

export const codexE2ELaunchContract = (input: {
  repositoryRoot: string;
  isolatedHome: string;
  codexHome: string;
  disabledOperatorSkillPaths: readonly string[];
  readDeniedPaths: readonly string[];
  program?: string;
  skipGitRepositoryCheck?: boolean;
}) => {
  const permissionProfile = codexE2EPermissionProfileConfiguration(input);
  const hardening: string[] = [];
  for (const feature of CODEX_E2E_DISABLED_FEATURES) {
    hardening.push("--disable", feature);
  }
  if (input.disabledOperatorSkillPaths.length > 0) {
    hardening.push(
      "-c",
      `skills.config=[${input.disabledOperatorSkillPaths
        .map((path) => `{path=${JSON.stringify(path)},enabled=false}`)
        .join(",")}]`,
    );
  }
  const program = input.program ?? "codex";
  const repositoryTrust = input.skipGitRepositoryCheck ? ["--skip-git-repo-check"] : [];
  const common = [
    "--strict-config",
    ...codexE2ERuntimeArguments(),
    "--ignore-user-config",
    "--ignore-rules",
    "-c",
    'approval_policy="on-request"',
    "-c",
    'approvals_reviewer="auto_review"',
    "-c",
    `default_permissions=${JSON.stringify(CODEX_E2E_PERMISSION_PROFILE)}`,
    "-c",
    permissionProfile,
  ] as const;
  return Object.freeze({
    environment: Object.freeze({ HOME: input.isolatedHome, CODEX_HOME: input.codexHome }),
    initial: Object.freeze({
      program,
      workingDirectory: input.repositoryRoot,
      arguments: Object.freeze([
        "exec",
        ...common,
        ...repositoryTrust,
        "--cd",
        input.repositoryRoot,
        "--json",
        ...hardening,
      ]),
      appendPromptAsFinalArgument: true as const,
    }),
    resume: Object.freeze({
      program,
      workingDirectory: input.repositoryRoot,
      arguments: Object.freeze([
        "exec",
        "resume",
        ...common,
        ...repositoryTrust,
        "--json",
        ...hardening,
        "<session-id>",
      ]),
      appendPromptAsFinalArgument: true as const,
    }),
  });
};

type OperatorFileDigest = Readonly<{ locator: string; sha256: string }>;

const optionalRegularFile = async (path: string): Promise<Uint8Array | undefined> => {
  let state: Stats;
  try {
    state = await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (!state.isFile()) throw new Error(`Codex operator input must be a regular file: ${path}`);
  return readFile(path);
};

const discoverSkillFiles = async (
  root: string,
  directory = root,
  ancestors = new Set<string>(),
): Promise<string[]> => {
  let canonicalDirectory: string;
  try {
    canonicalDirectory = await realpath(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  if (ancestors.has(canonicalDirectory)) {
    throw new Error(`Codex operator skill inventory contains a directory cycle: ${directory}`);
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(canonicalDirectory);
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await discoverSkillFiles(root, target, nextAncestors)));
    else if (entry.isSymbolicLink()) {
      const targetState = await lstat(await realpath(target));
      if (targetState.isDirectory()) {
        files.push(...(await discoverSkillFiles(root, target, nextAncestors)));
      }
    } else if (entry.isFile() && entry.name === "SKILL.md") files.push(target);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
};

const digestOperatorFiles = (files: readonly OperatorFileDigest[]): string =>
  createHash("sha256")
    .update(files.map((file) => `${file.locator}\0${file.sha256}\n`).join(""))
    .digest("hex");

export const inspectCodexE2EOperatorContext = async (codexHome: string) => {
  let globalInstructions: OperatorFileDigest | null = null;
  for (const filename of ["AGENTS.override.md", "AGENTS.md"] as const) {
    const locator = join(codexHome, filename);
    const bytes = await optionalRegularFile(locator);
    if (bytes !== undefined && new TextDecoder().decode(bytes).trim() !== "") {
      globalInstructions = {
        locator,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      break;
    }
  }
  const disabledSkills = await Promise.all(
    (await discoverSkillFiles(join(codexHome, "skills"))).map(async (locator) => ({
      locator,
      sha256: createHash("sha256")
        .update(await readFile(locator))
        .digest("hex"),
    })),
  );
  return Object.freeze({
    globalInstructions,
    disabledSkills: Object.freeze(disabledSkills),
    fingerprint: digestOperatorFiles([
      ...(globalInstructions === null ? [] : [globalInstructions]),
      ...disabledSkills,
    ]),
  });
};

type CodexE2EEvidenceInput = Readonly<{
  sourceCommit: string;
  packageFile: string;
  packageSha256: string;
  codexCliVersion: string;
  invocationStarted: boolean;
  terminalBoundary: string;
}>;

export const createCodexE2EEvidenceRecord = (input: CodexE2EEvidenceInput) => {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(input.sourceCommit)) {
    throw new Error("Codex E2E evidence requires one full lowercase commit ID.");
  }
  if (
    input.packageFile.length === 0 ||
    input.packageFile.includes("/") ||
    input.packageFile.includes("\\") ||
    !input.packageFile.endsWith(".tgz")
  ) {
    throw new Error("Codex E2E evidence requires one candidate package filename.");
  }
  if (!/^[0-9a-f]{64}$/u.test(input.packageSha256)) {
    throw new Error("Codex E2E evidence requires one lowercase package SHA-256 digest.");
  }
  if (
    input.codexCliVersion.trim() !== input.codexCliVersion ||
    input.codexCliVersion.length === 0
  ) {
    throw new Error("Codex E2E evidence requires one trimmed CLI version.");
  }
  if (
    input.terminalBoundary.trim() !== input.terminalBoundary ||
    input.terminalBoundary.length === 0
  ) {
    throw new Error("Codex E2E evidence requires one trimmed terminal boundary.");
  }
  return Object.freeze({
    candidate: Object.freeze({
      sourceCommit: input.sourceCommit,
      packageFile: input.packageFile,
      packageSha256: input.packageSha256,
    }),
    codex: Object.freeze({
      cliVersion: input.codexCliVersion,
      requestedModel: CODEX_E2E_RUNTIME.model,
      requestedReasoningEffort: CODEX_E2E_RUNTIME.reasoningEffort,
      invocationStarted: input.invocationStarted,
      terminalBoundary: input.terminalBoundary,
    }),
  });
};
