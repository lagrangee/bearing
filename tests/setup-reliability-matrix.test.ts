import { describe, expect, test } from "bun:test";
import {
  createSetupReliabilityEvidence,
  freshOrientationOfferEligible,
  SETUP_RELIABILITY_CASES,
  SETUP_RELIABILITY_PLAN_ID,
  setupReliabilityLaunchContract,
} from "../scripts/setup-reliability-matrix";

describe("Historical-only Setup Reliability Codex matrix", () => {
  test("pins the smallest decision-distinct synthetic journey set", () => {
    expect(SETUP_RELIABILITY_PLAN_ID).toBe("bearing-0.1.1-setup-reliability-v1");
    expect(SETUP_RELIABILITY_CASES).toEqual([
      {
        id: "nominate-accept-orientation",
        executorDecision: "nominate",
        continuation: "direct",
        orientationDecision: "accept",
      },
      {
        id: "invalid-then-skip-decline-orientation",
        executorDecision: "invalid-then-skip",
        continuation: "direct",
        orientationDecision: "decline",
      },
      {
        id: "skip-after-assisted-prerequisite",
        executorDecision: "skip",
        continuation: "assisted-prerequisite",
        orientationDecision: "accept",
      },
    ]);
  });

  test("offers only after every successful Fresh completion boundary", () => {
    for (const portalHandoff of ["compatible", "incompatible", "absent"] as const) {
      expect(
        freshOrientationOfferEligible({
          journey: "fresh",
          outcome: "applied",
          repositoryResultReported: true,
          catalogResultReported: true,
          portalHandoff,
        }),
      ).toBe(true);
    }

    for (const input of [
      {
        journey: "fresh",
        outcome: "partial",
        repositoryResultReported: true,
        catalogResultReported: true,
        portalHandoff: "absent",
      },
      {
        journey: "fresh",
        outcome: "blocked",
        repositoryResultReported: true,
        catalogResultReported: true,
        portalHandoff: "absent",
      },
      {
        journey: "fresh",
        outcome: "cancelled",
        repositoryResultReported: true,
        catalogResultReported: true,
        portalHandoff: "absent",
      },
      {
        journey: "active",
        outcome: "no-op",
        repositoryResultReported: true,
        catalogResultReported: true,
        portalHandoff: "compatible",
      },
      {
        journey: "reactivation",
        outcome: "applied",
        repositoryResultReported: true,
        catalogResultReported: true,
        portalHandoff: "compatible",
      },
      {
        journey: "cutover",
        outcome: "applied",
        repositoryResultReported: true,
        catalogResultReported: true,
        portalHandoff: "compatible",
      },
      {
        journey: "catalog-recovery",
        outcome: "applied",
        repositoryResultReported: true,
        catalogResultReported: true,
        portalHandoff: "compatible",
      },
      {
        journey: "fresh",
        outcome: "applied",
        repositoryResultReported: true,
        catalogResultReported: false,
        portalHandoff: "compatible",
      },
      {
        journey: "fresh",
        outcome: "applied",
        repositoryResultReported: false,
        catalogResultReported: true,
        portalHandoff: "compatible",
      },
      {
        journey: "fresh",
        outcome: "applied",
        repositoryResultReported: true,
        catalogResultReported: true,
        portalHandoff: null,
      },
    ] as const) {
      expect(freshOrientationOfferEligible(input)).toBe(false);
    }
  });

  test("launches through explicit repository-wide Codex runtime arguments", () => {
    expect(
      setupReliabilityLaunchContract({
        codexProgram: "/Applications/ChatGPT.app/Contents/Resources/codex",
        repositoryRoot: "/private/tmp/setup-reliability/repo",
        isolatedHome: "/private/tmp/setup-reliability/home",
        codexHome: "/Users/example/.codex",
        disabledOperatorSkillPaths: ["/Users/example/.codex/skills/operator/SKILL.md"],
      }),
    ).toMatchObject({
      environment: {
        HOME: "/private/tmp/setup-reliability/home",
        CODEX_HOME: "/Users/example/.codex",
      },
      initial: {
        program: "/Applications/ChatGPT.app/Contents/Resources/codex",
        arguments: [
          "exec",
          "--model",
          "gpt-5.6-luna",
          "--config",
          'model_reasoning_effort="high"',
          "--ignore-user-config",
          "--ignore-rules",
          "-c",
          'approval_policy="on-request"',
          "-c",
          'approvals_reviewer="auto_review"',
          "--sandbox",
          "workspace-write",
          "--add-dir",
          "/private/tmp/setup-reliability/home",
          "--cd",
          "/private/tmp/setup-reliability/repo",
          "--json",
          "--disable",
          "apps",
          "--disable",
          "browser_use",
          "--disable",
          "browser_use_external",
          "--disable",
          "chronicle",
          "--disable",
          "computer_use",
          "--disable",
          "goals",
          "--disable",
          "hooks",
          "--disable",
          "image_generation",
          "--disable",
          "memories",
          "--disable",
          "plugin_sharing",
          "--disable",
          "plugins",
          "--disable",
          "skill_mcp_dependency_install",
          "--disable",
          "tool_suggest",
          "--disable",
          "workspace_dependencies",
          "-c",
          'skills.config=[{path="/Users/example/.codex/skills/operator/SKILL.md",enabled=false}]',
        ],
      },
    });
  });

  test("rejects mixed candidates and emits transcript-free bounded evidence", () => {
    const candidate = {
      sourceCommit: "a".repeat(40),
      packageFile: "lagrangee-bearing-0.1.0.tgz",
      packageSha256: "b".repeat(64),
    };
    const cases = SETUP_RELIABILITY_CASES.map(({ id }) => ({
      id,
      candidate,
      invocationStarted: true,
      terminalBoundary: "pass" as const,
    }));
    const firstCase = cases[0];
    const thirdCase = cases[2];
    if (firstCase === undefined || thirdCase === undefined) {
      throw new Error("Expected the first and third matrix cases.");
    }

    expect(
      createSetupReliabilityEvidence({
        codexCliVersion: "codex-cli 0.142.5",
        candidate,
        cases,
      }),
    ).toEqual({
      schemaVersion: 1,
      planId: SETUP_RELIABILITY_PLAN_ID,
      candidate: {
        sourceCommit: candidate.sourceCommit,
        package: {
          file: candidate.packageFile,
          sha256: candidate.packageSha256,
        },
      },
      codex: {
        cliVersion: "codex-cli 0.142.5",
        requestedModel: "gpt-5.6-luna",
        requestedReasoningEffort: "high",
      },
      cases: cases.map(({ id }) => ({ id, invocationStarted: true, terminalBoundary: "pass" })),
    });

    expect(() =>
      createSetupReliabilityEvidence({
        codexCliVersion: "codex-cli 0.142.5",
        candidate,
        cases: [
          ...cases.slice(0, 2),
          {
            ...thirdCase,
            candidate: { ...candidate, packageSha256: "c".repeat(64) },
          },
        ],
      }),
    ).toThrow("same exact candidate");

    expect(() =>
      createSetupReliabilityEvidence({
        codexCliVersion: "codex-cli 0.142.5",
        candidate,
        cases: [firstCase, firstCase, thirdCase],
      }),
    ).toThrow("each required matrix case exactly once");

    const blockedCases = cases.map((entry, index) =>
      index === 1
        ? { ...entry, invocationStarted: false, terminalBoundary: "blocked:runtime-unavailable" }
        : entry,
    );
    expect(
      createSetupReliabilityEvidence({
        codexCliVersion: "codex-cli 0.142.5",
        candidate,
        cases: blockedCases,
      }).cases[1],
    ).toEqual({
      id: "invalid-then-skip-decline-orientation",
      invocationStarted: false,
      terminalBoundary: "blocked:runtime-unavailable",
    });
  });
});
