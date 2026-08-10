import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  CODEX_E2E_RUNTIME,
  codexE2ERuntimeArguments,
  createCodexE2EEvidenceRecord,
} from "../scripts/codex-e2e-runtime";

describe("repository Codex E2E policy", () => {
  test("keeps one fixed runtime owner and rejects caller overrides", () => {
    expect(CODEX_E2E_RUNTIME).toEqual({
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
    });
    expect(codexE2ERuntimeArguments()).toEqual([
      "--model",
      "gpt-5.6-luna",
      "--config",
      'model_reasoning_effort="high"',
    ]);
    expect(() => codexE2ERuntimeArguments({ model: "fallback" })).toThrow(
      "does not accept runtime overrides",
    );
  });

  test("records only the required exact-candidate and runtime evidence", () => {
    expect(
      createCodexE2EEvidenceRecord({
        sourceCommit: "a".repeat(40),
        packageFile: "lagrangee-bearing-0.1.1.tgz",
        packageSha256: "b".repeat(64),
        codexCliVersion: "codex-cli 1.2.3",
        invocationStarted: true,
        terminalBoundary: "completed:orientation-declined",
      }),
    ).toEqual({
      candidate: {
        sourceCommit: "a".repeat(40),
        packageFile: "lagrangee-bearing-0.1.1.tgz",
        packageSha256: "b".repeat(64),
      },
      codex: {
        cliVersion: "codex-cli 1.2.3",
        requestedModel: "gpt-5.6-luna",
        requestedReasoningEffort: "high",
        invocationStarted: true,
        terminalBoundary: "completed:orientation-declined",
      },
    });
    expect(() =>
      createCodexE2EEvidenceRecord({
        sourceCommit: "HEAD",
        packageFile: "candidate.tgz",
        packageSha256: "b".repeat(64),
        codexCliVersion: "codex-cli 1.2.3",
        invocationStarted: false,
        terminalBoundary: "blocked:model-unavailable",
      }),
    ).toThrow("full lowercase commit");
  });

  test("documents the repository-wide fail-closed journey boundary", async () => {
    const policy = await readFile("docs/agents/codex-e2e.md", "utf8");
    expect(policy).toContain("Every Codex E2E journey must run with:");
    expect(policy).toContain("Model: `gpt-5.6-luna`");
    expect(policy).toContain("Reasoning effort: `high`");
    expect(policy).toContain("Do not select a low-cost substitute");
    expect(policy).toContain("resumed, retried, negative, reproduction, release-smoke");
    expect(policy).toContain(
      "Historical reports and receipts remain historical and are not rewritten",
    );
  });
});
