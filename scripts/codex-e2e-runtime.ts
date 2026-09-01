import { COPYFILE_EXCL, W_OK } from "node:constants";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, normalize, relative } from "node:path";
import { z } from "zod";

export const CODEX_E2E_RUNTIME = Object.freeze({
  model: "gpt-5.6-luna",
  reasoningEffort: "high",
  fastMode: true,
} as const);

const codexModelCatalogIdentifierSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value);

const codexModelCatalogSchema = z
  .object({
    models: z.array(
      z
        .object({
          slug: codexModelCatalogIdentifierSchema,
          supported_reasoning_levels: z.array(
            z
              .object({
                effort: codexModelCatalogIdentifierSchema,
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .strict();

export const readCodexE2EModelAvailability = async (input: {
  program: string;
  isolatedHome: string;
  codexHome: string;
}) => {
  const probe = Bun.spawn([input.program, "debug", "models"], {
    env: { ...process.env, HOME: input.isolatedHome, CODEX_HOME: input.codexHome },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const [exitCode, stdout] = await Promise.all([probe.exited, new Response(probe.stdout).text()]);
  if (exitCode !== 0) {
    throw new Error(`Codex model availability probe failed with exit ${exitCode}.`);
  }

  let catalog: z.infer<typeof codexModelCatalogSchema>;
  try {
    catalog = codexModelCatalogSchema.parse(JSON.parse(stdout));
  } catch {
    throw new Error("Codex model availability probe returned an untrusted model catalog.");
  }
  const matches = catalog.models.filter((model) => model.slug === CODEX_E2E_RUNTIME.model);
  if (matches.length !== 1) {
    throw new Error(`Required Codex E2E model is unavailable: ${CODEX_E2E_RUNTIME.model}.`);
  }
  const supportedEfforts = matches[0]?.supported_reasoning_levels.map(({ effort }) => effort) ?? [];
  if (
    supportedEfforts.filter((effort) => effort === CODEX_E2E_RUNTIME.reasoningEffort).length !== 1
  ) {
    throw new Error(
      `Required Codex E2E reasoning effort is unavailable: ${CODEX_E2E_RUNTIME.reasoningEffort}.`,
    );
  }
  return Object.freeze({
    catalogIdentitySha256: createHash("sha256").update(stdout).digest("hex"),
    model: CODEX_E2E_RUNTIME.model,
    reasoningEffort: CODEX_E2E_RUNTIME.reasoningEffort,
  });
};

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

const CODEX_E2E_DARWIN_OPENSSL_CONFIG = "/System/Library/OpenSSL/openssl.cnf";
const CODEX_E2E_XCODE_SELECT = "/usr/bin/xcode-select";
const CODEX_E2E_SYSTEM_PATH = Object.freeze(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]);

export type CodexE2EToolchain = Readonly<{
  nodeExecutable: string;
  nodeBin: string;
  nodeInstallRoot: string;
  openSslConfig: string;
  selectedDeveloperDirectory: string;
  gitExecutable: string;
  path: string;
}>;

const readSystemToolOutput = async (program: string, arguments_: readonly string[]) => {
  const probe = Bun.spawn([program, ...arguments_], {
    env: { PATH: CODEX_E2E_SYSTEM_PATH.join(delimiter) },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const [exitCode, stdout] = await Promise.all([probe.exited, new Response(probe.stdout).text()]);
  const output = stdout.trim();
  if (exitCode !== 0 || output.length === 0) {
    throw new Error(`Codex E2E system tool failed: ${program}.`);
  }
  return output;
};

const assertNotOperatorWritable = async (path: string, description: string): Promise<void> => {
  try {
    await access(path, W_OK);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "EACCES" || error.code === "EPERM")
    ) {
      return;
    }
    throw error;
  }
  throw new Error(`Codex E2E ${description} must not be operator-writable.`);
};

export const verifyCodexE2EToolchain = async (
  toolchain: CodexE2EToolchain,
): Promise<CodexE2EToolchain> => {
  const [
    nodeExecutable,
    nodeInstallRoot,
    openSslConfig,
    selectedDeveloperDirectory,
    gitExecutable,
  ] = await Promise.all([
    realpath(toolchain.nodeExecutable),
    realpath(toolchain.nodeInstallRoot),
    realpath(toolchain.openSslConfig),
    realpath(toolchain.selectedDeveloperDirectory),
    realpath(toolchain.gitExecutable),
  ]);
  const [nodeState, installState, openSslState, developerDirectoryState, gitState] =
    await Promise.all([
      lstat(toolchain.nodeExecutable),
      lstat(toolchain.nodeInstallRoot),
      lstat(toolchain.openSslConfig),
      lstat(toolchain.selectedDeveloperDirectory),
      lstat(toolchain.gitExecutable),
    ]);
  const [selectedDeveloperDirectoryOutput, gitVersion] = await Promise.all([
    readSystemToolOutput(CODEX_E2E_XCODE_SELECT, ["-p"]),
    readSystemToolOutput(toolchain.gitExecutable, ["--version"]),
  ]);
  const currentSelectedDeveloperDirectory = await realpath(selectedDeveloperDirectoryOutput);
  const expectedGitExecutable = join(selectedDeveloperDirectory, "usr/bin/git");
  const expectedPath = [toolchain.nodeBin, dirname(gitExecutable), ...CODEX_E2E_SYSTEM_PATH].join(
    delimiter,
  );
  if (
    process.platform !== "darwin" ||
    nodeExecutable !== toolchain.nodeExecutable ||
    dirname(nodeExecutable) !== toolchain.nodeBin ||
    basename(nodeExecutable) !== "node" ||
    basename(toolchain.nodeBin) !== "bin" ||
    nodeInstallRoot !== toolchain.nodeInstallRoot ||
    join(nodeInstallRoot, "bin", "node") !== nodeExecutable ||
    !nodeState.isFile() ||
    (nodeState.mode & 0o111) === 0 ||
    !installState.isDirectory() ||
    openSslConfig !== CODEX_E2E_DARWIN_OPENSSL_CONFIG ||
    openSslConfig !== toolchain.openSslConfig ||
    !openSslState.isFile() ||
    openSslState.isSymbolicLink() ||
    selectedDeveloperDirectory !== toolchain.selectedDeveloperDirectory ||
    currentSelectedDeveloperDirectory !== selectedDeveloperDirectory ||
    !developerDirectoryState.isDirectory() ||
    developerDirectoryState.uid !== 0 ||
    gitExecutable !== toolchain.gitExecutable ||
    gitExecutable !== expectedGitExecutable ||
    !gitState.isFile() ||
    (gitState.mode & 0o111) === 0 ||
    !gitVersion.startsWith("git version ") ||
    toolchain.path !== expectedPath
  ) {
    throw new Error("Codex E2E toolchain identity is not canonical.");
  }
  await Promise.all([
    assertNotOperatorWritable(openSslConfig, "OpenSSL configuration"),
    assertNotOperatorWritable(selectedDeveloperDirectory, "selected developer directory"),
  ]);
  return Object.freeze({ ...toolchain });
};

export const inspectCodexE2EToolchain = async (
  operatorEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<CodexE2EToolchain> => {
  if (process.platform !== "darwin") {
    throw new Error("Codex E2E permission runtime requires macOS.");
  }
  const operatorPath = operatorEnvironment["PATH"];
  if (operatorPath === undefined || operatorPath.length === 0) {
    throw new Error("Codex E2E toolchain requires PATH.");
  }
  const discoveredNode = Bun.which("node", { PATH: operatorPath });
  if (discoveredNode === null) {
    throw new Error("Codex E2E toolchain requires Node on PATH.");
  }
  const nodeExecutable = await realpath(discoveredNode);
  const nodeBin = dirname(nodeExecutable);
  if (basename(nodeExecutable) !== "node" || basename(nodeBin) !== "bin") {
    throw new Error("Codex E2E Node must be one executable <installation>/bin/node.");
  }
  const nodeInstallRoot = await realpath(dirname(nodeBin));
  if (join(nodeInstallRoot, "bin", "node") !== nodeExecutable) {
    throw new Error("Codex E2E Node installation root is not canonical.");
  }
  const selectedDeveloperDirectory = await realpath(
    await readSystemToolOutput(CODEX_E2E_XCODE_SELECT, ["-p"]),
  );
  const gitExecutable = await realpath(join(selectedDeveloperDirectory, "usr/bin/git"));

  return verifyCodexE2EToolchain({
    nodeExecutable,
    nodeBin,
    nodeInstallRoot,
    openSslConfig: CODEX_E2E_DARWIN_OPENSSL_CONFIG,
    selectedDeveloperDirectory,
    gitExecutable,
    path: [nodeBin, dirname(gitExecutable), ...CODEX_E2E_SYSTEM_PATH].join(delimiter),
  });
};

export const resolveCodexE2EProgram = async (
  program: string,
  operatorEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> => {
  const operatorPath = operatorEnvironment["PATH"];
  const discovered =
    operatorPath === undefined ? Bun.which(program) : Bun.which(program, { PATH: operatorPath });
  const resolved = await realpath(discovered ?? program);
  const state = await lstat(resolved);
  if (!state.isFile() || (state.mode & 0o111) === 0) {
    throw new Error("Codex E2E program must be one executable regular file.");
  }
  return resolved;
};

export const assertCodexE2EOutputIsolation = (input: {
  stdout: string;
  stderr: string;
  operatorCodexHome: string;
  ephemeralCapabilityValues?: readonly string[];
}): void => {
  if (
    input.stdout.includes(input.operatorCodexHome) ||
    input.stderr.includes(input.operatorCodexHome)
  ) {
    throw new Error("Codex E2E output exposed the operator configuration path.");
  }
  if (
    input.ephemeralCapabilityValues?.some(
      (value) => value.length > 0 && (input.stdout.includes(value) || input.stderr.includes(value)),
    )
  ) {
    throw new Error("Codex E2E output exposed an ephemeral capability value.");
  }
};

export const redactCodexE2EEphemeralCapabilities = (
  value: string,
  capabilities: readonly string[],
): string =>
  [...new Set(capabilities.filter((capability) => capability.length > 0))].reduce(
    (redacted, capability) => redacted.replaceAll(capability, "<ephemeral-capability-redacted>"),
    value,
  );

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
  const runtimeAuth = join(agentCodexHome, "auth.json");
  await Promise.all([
    mkdir(agentCodexHome, { recursive: false }),
    mkdir(skillDirectory, { recursive: false }),
    mkdir(shellDirectory, { recursive: false }),
  ]);
  await copyFile(authSource, runtimeAuth, COPYFILE_EXCL);
  await chmod(runtimeAuth, 0o400);
  await symlink(skillDirectory, join(agentCodexHome, "skills"));
  return agentCodexHome;
};

export const prepareCodexE2EShellEnvironment = async (input: {
  isolatedHome: string;
  path: string;
}): Promise<void> => {
  const isolatedHome = await realpath(input.isolatedHome);
  await writeFile(
    join(isolatedHome, ".shell", ".zprofile"),
    `export PATH=${JSON.stringify(input.path)}\n`,
    { flag: "wx", mode: 0o600 },
  );
};

export const assertIsolatedCodexHomeControlLinks = async (
  isolatedHome: string,
  shellPath?: string,
): Promise<void> => {
  const agentCodexHome = join(isolatedHome, ".codex");
  const agentAuth = join(agentCodexHome, "auth.json");
  const agentSkills = join(agentCodexHome, "skills");
  const skillDirectory = join(isolatedHome, "skill-directory");
  const [agentAuthState, agentSkillsState] = await Promise.all([
    lstat(agentAuth),
    lstat(agentSkills),
  ]);
  if (
    !agentAuthState.isFile() ||
    (agentAuthState.mode & 0o777) !== 0o400 ||
    !agentSkillsState.isSymbolicLink() ||
    (await realpath(agentSkills)) !== (await realpath(skillDirectory))
  ) {
    throw new Error("Codex E2E isolated control links changed after preparation.");
  }
  if (
    shellPath !== undefined &&
    (await readFile(join(isolatedHome, ".shell", ".zprofile"), "utf8")) !==
      `export PATH=${JSON.stringify(shellPath)}\n`
  ) {
    throw new Error("Codex E2E isolated shell environment changed after preparation.");
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
    "--enable",
    "fast_mode",
  ];
};

const CODEX_E2E_PERMISSION_PROFILE = "bearing_live_journey";

const isCanonicalAbsolutePath = (path: string): boolean => {
  if (!isAbsolute(path) || normalize(path) !== path) return false;
  try {
    return realpathSync(path) === path;
  } catch {
    return false;
  }
};

const codexE2EPermissionProfileConfiguration = (input: {
  repositoryRoot: string;
  isolatedHome: string;
  codexHome: string;
  runtimeTempDirectory: string;
  toolchain: CodexE2EToolchain;
  boundedNpmControlRoot?: string;
  readDeniedPaths: readonly string[];
  writeAllowedPaths: readonly string[];
}) => {
  const readDeniedPaths = [
    ...new Set([...input.readDeniedPaths, join(input.codexHome, "auth.json")]),
  ];
  if (
    input.boundedNpmControlRoot !== undefined &&
    (!isCanonicalAbsolutePath(input.boundedNpmControlRoot) ||
      input.boundedNpmControlRoot !==
        join(dirname(input.runtimeTempDirectory), "bounded-update-capability"))
  ) {
    throw new Error("Codex E2E bounded npm control root must be the canonical runtime directory.");
  }
  if (
    input.readDeniedPaths.length === 0 ||
    [
      input.repositoryRoot,
      input.isolatedHome,
      input.codexHome,
      input.runtimeTempDirectory,
      input.toolchain.nodeInstallRoot,
      input.toolchain.openSslConfig,
      input.toolchain.selectedDeveloperDirectory,
      ...input.readDeniedPaths,
      ...input.writeAllowedPaths,
    ].some((path) => !isAbsolute(path)) ||
    input.writeAllowedPaths.some((path) => {
      const relation = relative(input.isolatedHome, path);
      return relation === "" || relation.startsWith("..") || isAbsolute(relation);
    })
  ) {
    throw new Error("Codex E2E permission paths must be non-empty absolute paths.");
  }
  const workspaceRoots = [input.repositoryRoot, input.isolatedHome]
    .map((path) => `${JSON.stringify(path)}=true`)
    .join(",");
  const deniedPaths = readDeniedPaths.map((path) => `${JSON.stringify(path)}="deny"`).join(",");
  const allowedPaths = input.writeAllowedPaths
    .map((path) => `${JSON.stringify(path)}="write"`)
    .join(",");
  const boundedNpmControlRoot =
    input.boundedNpmControlRoot === undefined
      ? ""
      : `,${JSON.stringify(input.boundedNpmControlRoot)}="read"`;
  const gitMetadata = `${JSON.stringify(join(input.repositoryRoot, ".git"))}="write"`;
  const runtimeTemp = `${JSON.stringify(input.runtimeTempDirectory)}="write"`;
  const nodeInstall = `${JSON.stringify(input.toolchain.nodeInstallRoot)}="read"`;
  const openSslConfig = `${JSON.stringify(input.toolchain.openSslConfig)}="read"`;
  const selectedDeveloperDirectory = `${JSON.stringify(input.toolchain.selectedDeveloperDirectory)}="read"`;
  return `permissions.${CODEX_E2E_PERMISSION_PROFILE}={workspace_roots={${workspaceRoots}},filesystem={":minimal"="read",":workspace_roots"="write",${gitMetadata},${runtimeTemp},${nodeInstall},${openSslConfig},${selectedDeveloperDirectory}${boundedNpmControlRoot}${allowedPaths.length === 0 ? "" : `,${allowedPaths}`},${deniedPaths}},network={enabled=false}}`;
};

export const probeCodexE2EPermissionProfile = async (input: {
  launch: Readonly<{
    environment: Readonly<{
      HOME: string;
      CODEX_HOME: string;
      TMPDIR: string;
      PATH: string;
      DEVELOPER_DIR: string;
      npm_config_script_shell: string;
      SHELL?: string;
    }>;
    initial: Readonly<{
      program: string;
      workingDirectory: string;
      arguments: readonly string[];
    }>;
    resume: Readonly<{ arguments: readonly string[] }>;
  }>;
  manifestPath: string;
  registryPath: string;
  sourceRoot: string;
  operatorCodexHome: string;
  scenarioWorkspace: string;
  installationEntryPath: string;
  runtimeContainer: string;
  siblingRuntimeRoot?: string;
  toolchain: CodexE2EToolchain;
  isProjectRepository: boolean;
  writeAllowedPaths: readonly string[];
  effectiveEnvironment: Readonly<Record<string, string>>;
}): Promise<void> => {
  const scenarioContainer = dirname(input.scenarioWorkspace);
  const profilePrefix = `permissions.${CODEX_E2E_PERMISSION_PROFILE}=`;
  const initialProfiles = input.launch.initial.arguments.filter((argument) =>
    argument.startsWith(profilePrefix),
  );
  const resumeProfiles = input.launch.resume.arguments.filter((argument) =>
    argument.startsWith(profilePrefix),
  );
  if (
    initialProfiles.length !== 1 ||
    resumeProfiles.length !== 1 ||
    initialProfiles[0] !== resumeProfiles[0]
  ) {
    throw new Error("Codex E2E launch must use one exact permission profile.");
  }
  const permissionProfile = initialProfiles[0] as string;
  for (const [key, value] of Object.entries(input.launch.environment)) {
    const effectiveValue = input.effectiveEnvironment[key];
    const canonicalBearingPath = `${join(
      input.launch.environment.HOME,
      ".bearing",
      "bin",
    )}${delimiter}${value}`;
    if (effectiveValue !== value && !(key === "PATH" && effectiveValue === canonicalBearingPath)) {
      throw new Error(`Codex E2E effective environment changed ${key}.`);
    }
  }
  const repositoryRoot = input.launch.initial.workingDirectory;
  const controlPath = join(repositoryRoot, ".bearing-live-journey-permission-probe");
  const siblingProbePath = join(
    scenarioContainer,
    `.bearing-live-journey-sibling-probe-${basename(input.scenarioWorkspace)}`,
  );
  const ambientRuntimeProbePath = join(
    input.runtimeContainer,
    `.bearing-live-journey-runtime-probe-${basename(dirname(input.launch.environment.HOME))}`,
  );
  const siblingRuntimeProbePath =
    input.siblingRuntimeRoot === undefined
      ? undefined
      : join(
          input.siblingRuntimeRoot,
          `.bearing-live-journey-sibling-runtime-probe-${basename(dirname(input.launch.environment.HOME))}`,
        );
  let controlCreated = false;
  let siblingCreated = false;
  let ambientRuntimeProbeCreated = false;
  let siblingRuntimeProbeCreated = false;
  try {
    await writeFile(controlPath, "repository-control\n", { flag: "wx", mode: 0o600 });
    controlCreated = true;
    await writeFile(siblingProbePath, "sibling-control\n", { flag: "wx", mode: 0o600 });
    siblingCreated = true;
    await writeFile(ambientRuntimeProbePath, "ambient-runtime-control\n", {
      flag: "wx",
      mode: 0o600,
    });
    ambientRuntimeProbeCreated = true;
    if (siblingRuntimeProbePath !== undefined) {
      await writeFile(siblingRuntimeProbePath, "sibling-runtime-control\n", {
        flag: "wx",
        mode: 0o600,
      });
      siblingRuntimeProbeCreated = true;
    }
    const probe = Bun.spawn(
      [
        input.launch.initial.program,
        "sandbox",
        "--include-managed-config",
        "-c",
        permissionProfile,
        "-P",
        CODEX_E2E_PERMISSION_PROFILE,
        "-C",
        repositoryRoot,
        "/bin/sh",
        "-c",
        [
          'control="$1"',
          'cat "$control" >/dev/null || exit 81',
          'cat "$2" >/dev/null || exit 82',
          'if cat "$3" >/dev/null 2>&1; then exit 83; fi',
          'if readlink "$3" >/dev/null 2>&1; then exit 84; fi',
          'if cat "$4" >/dev/null 2>&1; then exit 85; fi',
          'if readlink "$4" >/dev/null 2>&1; then exit 86; fi',
          'if cat "$5" >/dev/null 2>&1; then exit 87; fi',
          'if /usr/bin/git -C "$6" show HEAD:validation/live-journey/registry.json >/dev/null 2>&1; then exit 88; fi',
          'if cat "$7" >/dev/null 2>&1; then exit 89; fi',
          'if cat "$8" >/dev/null 2>&1; then exit 90; fi',
          'if cat "$9" >/dev/null 2>&1; then exit 91; fi',
          "shift 9",
          'if cat "$1" >/dev/null 2>&1; then exit 92; fi',
          'if readlink "$1" >/dev/null 2>&1; then exit 93; fi',
          'if [ -n "$2" ] && cat "$2" >/dev/null 2>&1; then exit 94; fi',
          'if [ -n "$2" ] && readlink "$2" >/dev/null 2>&1; then exit 95; fi',
          'node_executable="$3"',
          'runtime_tmp="$4"',
          'project_repository="$5"',
          'developer_directory="$6"',
          'npm_script_shell="$7"',
          'git_executable="$8"',
          'node_probe="$runtime_tmp/permission-probe.sqlite"',
          '/usr/bin/env node -e \'const { realpathSync } = require("node:fs"); const { DatabaseSync } = require("node:sqlite"); if (realpathSync(process.execPath) !== process.argv[1]) process.exit(41); for (const value of [process.cwd(), process.env.HOME, process.env.CODEX_HOME, process.env.TMPDIR]) realpathSync(value); const database = new DatabaseSync(process.argv[2]); database.exec("CREATE TABLE probe(value INTEGER)"); database.close();\' "$node_executable" "$node_probe" || exit 96',
          'rm "$node_probe" || exit 97',
          '"$git_executable" --version >/dev/null || exit 98',
          'if [ "$project_repository" = "yes" ]; then "$git_executable" -C "$PWD" rev-parse --is-inside-work-tree >/dev/null || exit 99; fi',
          `/bin/zsh -lc '[[ "$(command -v node)" = "$1" ]] && [ "$DEVELOPER_DIR" = "$2" ] && [ "$npm_config_script_shell" = "$3" ] && [[ "$(command -v git)" = "$4" ]] && git --version >/dev/null' bearing-login-probe "$node_executable" "$developer_directory" "$npm_script_shell" "$git_executable" || exit 102`,
          "shift 8",
          'for path in "$@"; do',
          '  probe="$path/.bearing-live-journey-write-probe"',
          '  ln -s "$control" "$probe" || exit 100',
          '  rm "$probe" || exit 101',
          "done",
        ].join("\n"),
        "bearing-live-journey-permission-probe",
        controlPath,
        input.installationEntryPath,
        input.manifestPath,
        input.registryPath,
        join(input.sourceRoot, "package.json"),
        input.sourceRoot,
        siblingProbePath,
        join(input.operatorCodexHome, "auth.json"),
        join(input.launch.environment.CODEX_HOME, "auth.json"),
        ambientRuntimeProbePath,
        siblingRuntimeProbePath ?? "",
        input.toolchain.nodeExecutable,
        input.launch.environment.TMPDIR,
        input.isProjectRepository ? "yes" : "no",
        input.toolchain.selectedDeveloperDirectory,
        "/bin/bash",
        input.toolchain.gitExecutable,
        ...input.writeAllowedPaths,
      ],
      {
        cwd: repositoryRoot,
        env: input.effectiveEnvironment,
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
      ...(controlCreated ? [rm(controlPath, { force: true })] : []),
      ...(siblingCreated ? [rm(siblingProbePath, { force: true })] : []),
      ...(ambientRuntimeProbeCreated ? [rm(ambientRuntimeProbePath, { force: true })] : []),
      ...(siblingRuntimeProbeCreated && siblingRuntimeProbePath !== undefined
        ? [rm(siblingRuntimeProbePath, { force: true })]
        : []),
    ]);
  }
};

export const codexE2ELaunchContract = (input: {
  repositoryRoot: string;
  isolatedHome: string;
  codexHome: string;
  runtimeTempDirectory: string;
  toolchain: CodexE2EToolchain;
  disabledOperatorSkillPaths: readonly string[];
  boundedNpmControlRoot?: string;
  readDeniedPaths: readonly string[];
  writeAllowedPaths: readonly string[];
  program?: string;
  skipGitRepositoryCheck?: boolean;
  shellProgram?: string;
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
    environment: Object.freeze({
      HOME: input.isolatedHome,
      CODEX_HOME: input.codexHome,
      TMPDIR: input.runtimeTempDirectory,
      PATH: input.toolchain.path,
      DEVELOPER_DIR: input.toolchain.selectedDeveloperDirectory,
      npm_config_script_shell: "/bin/bash",
      ...(input.shellProgram === undefined ? {} : { SHELL: input.shellProgram }),
    }),
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
      requestedFastMode: CODEX_E2E_RUNTIME.fastMode,
      invocationStarted: input.invocationStarted,
      terminalBoundary: input.terminalBoundary,
    }),
  });
};
