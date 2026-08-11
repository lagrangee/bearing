import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

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

export const codexE2ELaunchContract = (input: {
  repositoryRoot: string;
  isolatedHome: string;
  codexHome: string;
  disabledOperatorSkillPaths: readonly string[];
  program?: string;
}) => {
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
  const common = [
    ...codexE2ERuntimeArguments(),
    "--ignore-user-config",
    "--ignore-rules",
    "-c",
    'approval_policy="on-request"',
    "-c",
    'approvals_reviewer="auto_review"',
  ] as const;
  return Object.freeze({
    environment: Object.freeze({ HOME: input.isolatedHome, CODEX_HOME: input.codexHome }),
    initial: Object.freeze({
      program,
      arguments: Object.freeze([
        "exec",
        ...common,
        "--sandbox",
        "workspace-write",
        "--add-dir",
        input.isolatedHome,
        "--cd",
        input.repositoryRoot,
        "--json",
        ...hardening,
      ]),
      appendPromptAsFinalArgument: true as const,
    }),
    resume: Object.freeze({
      program,
      arguments: Object.freeze([
        "exec",
        "resume",
        ...common,
        "-c",
        'sandbox_mode="workspace-write"',
        "-c",
        `sandbox_workspace_write.writable_roots=[${JSON.stringify(input.isolatedHome)}]`,
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
