import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { CODEX_E2E_RUNTIME, inspectCodexE2EOperatorContext } from "../scripts/codex-e2e-runtime";
import {
  assertJourneyAgentPrompt,
  createCleanJourneyEvaluation,
  createCodexJourneyEnvironment,
  createLiveJourneyObservation,
  loadLiveJourneyMatrix,
  matrixDefinitionDigest,
  observationSupportsSemanticPass,
  prepareCleanJourneyGeneration,
  readCleanJourneyGeneration,
  snapshotDirectory,
  verifyCleanJourneyGeneration,
  verifyLiveJourneyObservation,
} from "../scripts/live-journey-matrix";
import { sha256File } from "../scripts/release-digest";

const run = (cwd: string, ...command: string[]): string => {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
};

const createSourceFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-live-matrix-source-"));
  await mkdir(join(root, "validation/live-journey/fixtures/local-loop/src"), { recursive: true });
  await mkdir(join(root, "validation/live-journey/fixtures/local-loop/tests"), { recursive: true });
  await mkdir(join(root, "validation/live-journey/journeys"), { recursive: true });
  await mkdir(join(root, "docs"));
  for (const locator of [
    "validation/live-journey/matrix.json",
    "validation/live-journey/generation.md",
    "validation/live-journey/journeys/clean-installation-and-local-loop.md",
    "validation/live-journey/journeys/github-and-active-reconciliation.md",
    "validation/live-journey/journeys/safety-and-lifecycle.md",
    "validation/live-journey/fixtures/local-loop/AGENTS.md",
    "validation/live-journey/fixtures/local-loop/README.md",
    "validation/live-journey/fixtures/local-loop/package.json",
    "validation/live-journey/fixtures/local-loop/src/format-label.ts",
    "validation/live-journey/fixtures/local-loop/tests/format-label.test.ts",
    "validation/live-journey/fixtures/safety-lifecycle/.scratch/label-delivery/PRD.md",
    "validation/live-journey/fixtures/safety-lifecycle/.scratch/label-delivery/map.md",
    "validation/live-journey/fixtures/safety-lifecycle/.scratch/label-delivery/issues/01-update-output.md",
    "validation/live-journey/fixtures/safety-lifecycle/.scratch/label-delivery/issues/02-update-output.md",
    "validation/live-journey/fixtures/safety-lifecycle/.scratch/label-delivery/issues/03-run-failing-delivery.md",
    "validation/live-journey/fixtures/safety-lifecycle/.scratch/label-delivery/issues/04-complete-secondary-format.md",
    "validation/live-journey/fixtures/safety-lifecycle/AGENTS.md",
    "validation/live-journey/fixtures/safety-lifecycle/CONTEXT.md",
    "validation/live-journey/fixtures/safety-lifecycle/README.md",
    "validation/live-journey/fixtures/safety-lifecycle/docs/agents/issue-tracker.md",
    "validation/live-journey/fixtures/safety-lifecycle/package.json",
    "validation/live-journey/fixtures/safety-lifecycle/src/format-label.ts",
    "validation/live-journey/fixtures/safety-lifecycle/tests/format-label.test.ts",
  ]) {
    await mkdir(dirname(join(root, locator)), { recursive: true });
    await writeFile(join(root, locator), await readFile(locator));
  }
  await writeFile(join(root, "docs/agent-installation.md"), "# Agent installation\n");
  run(root, "git", "init", "-q");
  run(root, "git", "add", ".");
  run(
    root,
    "git",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  return { root, sourceCommit: run(root, "git", "rev-parse", "HEAD") };
};

describe("reusable Agent Live E2E Matrix", () => {
  test("exposes prepare, real Codex turn, and Coordinator evaluation commands", () => {
    const result = Bun.spawnSync([process.execPath, "scripts/run-live-journey.ts", "--help"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("prepare-clean");
    expect(result.stdout.toString()).toContain("run-clean-turn");
    expect(result.stdout.toString()).toContain("evaluate-clean");
  });

  test("pins three Journey names and 18 stable Case identities", async () => {
    const matrix = await loadLiveJourneyMatrix("validation/live-journey/matrix.json");

    expect(matrix.journeys.map(({ name }) => name)).toEqual([
      "Clean Installation and Local Loop",
      "GitHub and Active Reconciliation",
      "Safety and Lifecycle",
    ]);
    expect(matrix.journeys.flatMap(({ cases }) => cases.map(({ id }) => id))).toEqual([
      "CLEAN-01",
      "CLEAN-02",
      "CLEAN-03",
      "CLEAN-04",
      "CLEAN-05",
      "GITHUB-01",
      "GITHUB-02",
      "GITHUB-03",
      "GITHUB-04",
      "SAFETY-01",
      "SAFETY-02",
      "SAFETY-03",
      "SAFETY-04",
      "SAFETY-05",
      "SAFETY-06",
      "SAFETY-07",
      "SAFETY-08",
      "SAFETY-09",
    ]);
  });

  test("binds tracked Journey instructions and fixtures into the Matrix identity", async () => {
    const source = await createSourceFixture();
    const matrixPath = join(source.root, "validation/live-journey/matrix.json");
    const before = await matrixDefinitionDigest(matrixPath);
    await writeFile(
      join(source.root, "validation/live-journey/journeys/github-and-active-reconciliation.md"),
      "# Changed GitHub Journey\n",
    );

    expect(await matrixDefinitionDigest(matrixPath)).not.toBe(before);
  });

  test("prepares an ignored exact-candidate overlay, fresh fixture, and fixed launch", async () => {
    const source = await createSourceFixture();
    const parent = await mkdtemp(join(tmpdir(), "bearing-live-matrix-generation-"));
    const workspaceRoot = join(parent, "generation");
    const tarballPath = join(parent, "lagrangee-bearing-0.1.1.tgz");
    const codexHome = join(parent, "codex-home");
    const candidateReceiptPath = join(parent, "candidate-receipt.json");
    await writeFile(tarballPath, "exact candidate bytes");
    await writeFile(candidateReceiptPath, "candidate receipt fixture");
    await mkdir(codexHome);
    const matrixDigest = await matrixDefinitionDigest(
      join(source.root, "validation/live-journey/matrix.json"),
    );
    const operatorContextFingerprint = (await inspectCodexE2EOperatorContext(codexHome))
      .fingerprint;

    const prepared = await prepareCleanJourneyGeneration({
      sourceRoot: source.root,
      workspaceRoot,
      codexHome,
      candidate: {
        packageName: "@lagrangee/bearing",
        packageVersion: "0.1.1",
        sourceCommit: source.sourceCommit,
        workflow: { name: "Prepare candidate artifact", runId: "123456", runAttempt: 1 },
        artifact: {
          path: tarballPath,
          file: basename(tarballPath),
          sha256: await sha256File(tarballPath),
        },
        matrixDefinitionSha256: matrixDigest,
      },
      candidateReceipt: {
        path: candidateReceiptPath,
        sha256: await sha256File(candidateReceiptPath),
      },
      disabledOperatorSkillPaths: [join(codexHome, "skills/operator/SKILL.md")],
      operatorContextFingerprint,
    });

    expect(prepared.candidate.matrixDefinitionSha256).toBe(matrixDigest);
    expect(prepared.operatorContextFingerprint).toBe(operatorContextFingerprint);
    expect(prepared.paths.overlay).toBe(join(source.root, "README.local.md"));
    expect(await readFile(prepared.paths.overlay, "utf8")).toContain(tarballPath);
    expect(await readFile(prepared.paths.overlay, "utf8")).toContain(source.sourceCommit);
    expect(await readFile(join(source.root, ".git/info/exclude"), "utf8")).toContain(
      "/README.local.md",
    );
    expect(run(source.root, "git", "status", "--short")).toBe("");
    await access(join(prepared.paths.repository, "src/format-label.ts"));
    await access(prepared.paths.agentHome);
    await access(prepared.paths.candidateManifest);
    expect(prepared.launch.initial.arguments).toContain(CODEX_E2E_RUNTIME.model);
    expect(prepared.launch.initial.arguments).toContain(
      `model_reasoning_effort=${JSON.stringify(CODEX_E2E_RUNTIME.reasoningEffort)}`,
    );
    expect(prepared.launch.initial.arguments).not.toContain(prepared.paths.candidateManifest);
    expect(prepared.launch.initial.arguments).not.toContain("CLEAN-01");
    const firstHomeSnapshot = await snapshotDirectory(prepared.paths.agentHome);
    await symlink(source.root, join(prepared.paths.agentHome, "bearing-skill"));
    expect(await snapshotDirectory(prepared.paths.agentHome)).not.toBe(firstHomeSnapshot);
    await writeFile(tarballPath, "changed candidate bytes");
    await expect(verifyCleanJourneyGeneration(prepared)).rejects.toThrow(
      "Candidate tarball digest mismatch",
    );
    await writeFile(prepared.paths.candidateManifest, "{}\n");
    await expect(readCleanJourneyGeneration(prepared.paths.candidateManifest)).rejects.toThrow(
      "Candidate Manifest digest mismatch",
    );
  });

  test("fails before launch when any exact identity member changes", async () => {
    const source = await createSourceFixture();
    const parent = await mkdtemp(join(tmpdir(), "bearing-live-matrix-mismatch-"));
    const tarballPath = join(parent, "candidate.tgz");
    const codexHome = join(parent, "codex-home");
    const candidateReceiptPath = join(parent, "candidate-receipt.json");
    await Promise.all([
      writeFile(tarballPath, "candidate"),
      writeFile(candidateReceiptPath, "candidate receipt fixture"),
      mkdir(codexHome),
    ]);
    const candidate = {
      packageName: "@lagrangee/bearing" as const,
      packageVersion: "0.1.1",
      sourceCommit: source.sourceCommit,
      workflow: { name: "Prepare candidate artifact", runId: "123456", runAttempt: 1 },
      artifact: {
        path: tarballPath,
        file: basename(tarballPath),
        sha256: await sha256File(tarballPath),
      },
      matrixDefinitionSha256: await matrixDefinitionDigest(
        join(source.root, "validation/live-journey/matrix.json"),
      ),
    };
    const operatorContextFingerprint = (await inspectCodexE2EOperatorContext(codexHome))
      .fingerprint;

    await expect(
      prepareCleanJourneyGeneration({
        sourceRoot: source.root,
        workspaceRoot: join(parent, "digest-mismatch"),
        codexHome,
        candidate: { ...candidate, matrixDefinitionSha256: "f".repeat(64) },
        candidateReceipt: {
          path: candidateReceiptPath,
          sha256: await sha256File(candidateReceiptPath),
        },
        disabledOperatorSkillPaths: [],
        operatorContextFingerprint,
      }),
    ).rejects.toThrow("Matrix definition digest mismatch");
    await expect(
      prepareCleanJourneyGeneration({
        sourceRoot: source.root,
        workspaceRoot: join(parent, "tarball-mismatch"),
        codexHome,
        candidate: {
          ...candidate,
          artifact: { ...candidate.artifact, sha256: "e".repeat(64) },
        },
        candidateReceipt: {
          path: candidateReceiptPath,
          sha256: await sha256File(candidateReceiptPath),
        },
        disabledOperatorSkillPaths: [],
        operatorContextFingerprint,
      }),
    ).rejects.toThrow("Candidate tarball digest mismatch");
  });

  test("keeps prompts and environment black-box and verifies hard observables", async () => {
    expect(assertJourneyAgentPrompt("请按 README.local.md 安装 Bearing。不要设置当前项目。")).toBe(
      "请按 README.local.md 安装 Bearing。不要设置当前项目。",
    );
    expect(() => assertJourneyAgentPrompt("Make CLEAN-01 pass with expected commands")).toThrow(
      "black-box",
    );
    expect(
      createCodexJourneyEnvironment(
        {
          PATH: "/usr/bin",
          MATRIX_CASE: "CLEAN-01",
          GITHUB_TOKEN: "secret",
        },
        { HOME: "/private/fresh-home", CODEX_HOME: "/private/operator-home" },
      ),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/private/fresh-home",
      CODEX_HOME: "/private/operator-home",
    });

    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "session-private" }),
      JSON.stringify({ type: "item.completed", item: { type: "command_execution" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10 } }),
    ].join("\n");
    const observation = createLiveJourneyObservation({
      turn: 2,
      codexCliVersion: "codex-cli 0.147.0",
      exitCode: 0,
      stdout,
      stderr: "",
      before: { repository: "a".repeat(64), agentHome: "b".repeat(64) },
      after: { repository: "c".repeat(64), agentHome: "d".repeat(64) },
      transcriptPointer: "transcripts/turn-02.jsonl",
      stderrPointer: "transcripts/turn-02.stderr.log",
    });

    expect(observation).toEqual({
      schemaVersion: 1,
      turn: 2,
      invocationStarted: true,
      exitCode: 0,
      terminalBoundary: "turn.completed",
      codex: {
        cliVersion: "codex-cli 0.147.0",
        requestedModel: "gpt-5.6-luna",
        requestedReasoningEffort: "high",
      },
      eventCounts: { "item.completed": 1, "thread.started": 1, "turn.completed": 1 },
      state: {
        before: { repository: "a".repeat(64), agentHome: "b".repeat(64) },
        after: { repository: "c".repeat(64), agentHome: "d".repeat(64) },
      },
      privateEvidence: {
        transcript: {
          pointer: "transcripts/turn-02.jsonl",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          bytes: expect.any(Number),
        },
        stderr: {
          pointer: "transcripts/turn-02.stderr.log",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          bytes: 0,
        },
      },
    });
    expect(JSON.stringify(observation)).not.toContain("session-private");
    expect(JSON.stringify(observation)).not.toContain("input_tokens");
    expect(observationSupportsSemanticPass(observation)).toBe(true);
    expect(observationSupportsSemanticPass({ ...observation, exitCode: 1 })).toBe(false);
    const workspaceRoot = await mkdtemp(join(tmpdir(), "bearing-live-observation-"));
    await mkdir(join(workspaceRoot, "transcripts"));
    await mkdir(join(workspaceRoot, "observations"));
    await writeFile(join(workspaceRoot, "transcripts/turn-02.jsonl"), stdout);
    await writeFile(join(workspaceRoot, "transcripts/turn-02.stderr.log"), "");
    await writeFile(
      join(workspaceRoot, "observations/turn-02.json"),
      `${JSON.stringify(observation)}\n`,
    );
    await expect(
      verifyLiveJourneyObservation({
        workspaceRoot,
        pointer: "observations/turn-02.json",
        expectedCodexCliVersion: "codex-cli 0.147.0",
      }),
    ).resolves.toMatchObject({ terminalBoundary: "turn.completed", invocationStarted: true });
    await expect(
      verifyLiveJourneyObservation({
        workspaceRoot,
        pointer: "transcripts/turn-02.jsonl",
        expectedCodexCliVersion: "codex-cli 0.147.0",
      }),
    ).rejects.toThrow("generated observation");
  });

  test("accepts only Coordinator judgments and emits bounded Clean evidence", () => {
    const candidate = {
      packageName: "@lagrangee/bearing" as const,
      packageVersion: "0.1.1",
      sourceCommit: "a".repeat(40),
      workflow: { name: "Prepare candidate artifact", runId: "123456", runAttempt: 1 },
      artifact: {
        path: "/private/generated/candidate.tgz",
        file: "candidate.tgz",
        sha256: "b".repeat(64),
      },
      matrixDefinitionSha256: "c".repeat(64),
    };
    const verdicts = (["CLEAN-01", "CLEAN-02", "CLEAN-03", "CLEAN-04", "CLEAN-05"] as const).map(
      (caseId, index) => ({
        caseId,
        outcome: "pass" as const,
        judgmentBasis: `Observed owner-separated behavior in turns ${index + 1}-${index + 2}.`,
        observationPointers: [`observations/turn-0${index + 1}.json`],
      }),
    );

    const result = createCleanJourneyEvaluation({
      generationId: "00000000-0000-4000-8000-000000000010",
      candidate,
      codexCliVersion: "codex-cli 0.147.0",
      coordinatorIdentity: "Codex coordinating agent",
      fixtureSha256: "d".repeat(64),
      durationMs: 1234,
      verdicts,
    });

    expect(result.outcome).toBe("pass");
    expect(result.cases).toEqual(verdicts);
    expect(JSON.stringify(result)).not.toContain(candidate.artifact.path);
    expect(JSON.stringify(result)).not.toContain("transcript");
    expect(() =>
      createCleanJourneyEvaluation({
        generationId: "00000000-0000-4000-8000-000000000010",
        candidate,
        codexCliVersion: "codex-cli 0.147.0",
        coordinatorIdentity: "Codex coordinating agent",
        fixtureSha256: "d".repeat(64),
        durationMs: 1234,
        verdicts: verdicts.slice(1),
      }),
    ).toThrow("Case exactly once");
  });
});
