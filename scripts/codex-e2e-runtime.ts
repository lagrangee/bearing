export const CODEX_E2E_RUNTIME = Object.freeze({
  model: "gpt-5.6-luna",
  reasoningEffort: "high",
} as const);

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
