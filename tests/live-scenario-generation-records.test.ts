import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  createLiveMatrixAttemptRecord,
  liveMatrixPrivateControlRoot,
  liveMatrixRecordCandidateRoot,
} from "../scripts/live-matrix-evidence-bundle";
import { writeLiveScenarioPackageBasis } from "../scripts/live-scenario-evidence";
import {
  createLiveScenarioExecutionRecord,
  createLiveScenarioGenerationRecord,
  inspectLiveScenarioGenerationRecords,
  liveScenarioHarnessIdentitySha256,
  publishLiveScenarioAttemptReceipt,
  publishLiveScenarioResultRecord,
  publishLiveScenarioTurnReceipt,
  terminateLiveScenarioGeneration,
} from "../scripts/live-scenario-generation-records";
import { loadLiveScenarioRegistry } from "../scripts/live-scenario-registry";
import { liveScenarioDefinitionDigest } from "../scripts/live-scenario-runner";
import { localRehearsalWorktreeDigest } from "../scripts/local-rehearsal-identity";
import { sha256File } from "../scripts/release-digest";

describe("immutable Live Matrix Generation records", () => {
  test("changes Harness identity when an executable dependency changes", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "bearing-harness-identity-"));
    await Promise.all([
      cp(join(process.cwd(), "scripts"), join(sourceRoot, "scripts"), { recursive: true }),
      mkdir(join(sourceRoot, "docs/agents"), { recursive: true }),
    ]);
    await Promise.all(
      ["package.json", "package-lock.json", ".gitleaks.toml"].map((locator) =>
        cp(join(process.cwd(), locator), join(sourceRoot, locator)),
      ),
    );
    await cp(
      join(process.cwd(), "docs/agents/codex-e2e.md"),
      join(sourceRoot, "docs/agents/codex-e2e.md"),
    );
    const before = await liveScenarioHarnessIdentitySha256({ sourceRoot });
    const dependency = join(sourceRoot, "scripts/release-digest.ts");
    await writeFile(dependency, `${await readFile(dependency, "utf8")}\n// changed dependency\n`);

    expect(await liveScenarioHarnessIdentitySha256({ sourceRoot })).not.toBe(before);
  });

  test("allows exactly one creator to publish a Generation record", async () => {
    const generationRoot = await mkdtemp(join(tmpdir(), "bearing-generation-create-once-"));
    const matrixDefinitionSha256 = "1".repeat(64);
    const create = (generationId: string) =>
      createLiveScenarioGenerationRecord({
        generationRoot,
        generationId,
        package: {
          evidenceClass: "local-rehearsal",
          packageName: "@lagrangee/bearing",
          packageVersion: "0.1.2-dev",
          sourceHead: "fixture-head",
          worktreeSha256: "2".repeat(64),
          artifact: {
            path: join(generationRoot, "bearing.tgz"),
            file: "bearing.tgz",
            sha256: "3".repeat(64),
          },
          matrixDefinitionSha256,
        },
        matrixDefinitionSha256,
        harnessIdentitySha256: "4".repeat(64),
        admissionIdentitySha256: "5".repeat(64),
        admissionBasisIdentitySha256: "6".repeat(64),
        admittedScenarioCount: 1,
        scenarioId: "ENTRY-01",
      });

    const outcomes = await Promise.allSettled([
      create("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      create("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const inspected = await inspectLiveScenarioGenerationRecords(generationRoot);
    expect([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]).toContain(inspected.generationId);
  });

  test("closes one registered local Scenario as an inspectable identity chain without claiming a semantic pass", async () => {
    const registry = await loadLiveScenarioRegistry("validation/live-journey/registry.json");
    const scenario =
      registry.scenarios.find(({ id }) => id === "ENTRY-01") ??
      (() => {
        throw new Error("ENTRY-01 is unavailable.");
      })();
    const generationRoot = await mkdtemp(join(tmpdir(), "bearing-generation-records-"));
    const generationId = "11111111-1111-4111-8111-111111111111";
    const matrixDefinitionSha256 = "1".repeat(64);

    const generation = await createLiveScenarioGenerationRecord({
      generationRoot,
      generationId,
      package: {
        evidenceClass: "local-rehearsal",
        packageName: "@lagrangee/bearing",
        packageVersion: "0.1.2-dev",
        sourceHead: "fixture-head",
        worktreeSha256: "2".repeat(64),
        artifact: {
          path: join(generationRoot, "bearing.tgz"),
          file: "bearing.tgz",
          sha256: "3".repeat(64),
        },
        matrixDefinitionSha256,
      },
      matrixDefinitionSha256,
      harnessIdentitySha256: "4".repeat(64),
      admissionIdentitySha256: "5".repeat(64),
      admissionBasisIdentitySha256: "6".repeat(64),
      admittedScenarioCount: 1,
      scenarioId: scenario.id,
    });
    const scenarioRecord = await createLiveScenarioExecutionRecord({
      generationRoot,
      generationId,
      scenarioId: scenario.id,
      compositionReadbackIdentitySha256: "4".repeat(64),
      scenarioDefinitionSha256: "5".repeat(64),
      fixtureIdentitySha256: "6".repeat(64),
      declaredTurnCount: scenario.prompts.length,
    });
    const attempt = await publishLiveScenarioAttemptReceipt({
      generationRoot,
      generationId,
      scenarioId: scenario.id,
      turn: 1,
      attempt: 1,
      promptSha256: "7".repeat(64),
      invocationStarted: true,
      terminalBoundary: "turn.completed",
      observationSha256: "8".repeat(64),
    });
    const turn = await publishLiveScenarioTurnReceipt({
      generationRoot,
      generationId,
      scenarioId: scenario.id,
      turn: 1,
      promptSha256: "7".repeat(64),
      terminalAttemptRecordId: attempt.recordId,
      terminalBoundary: "turn.completed",
    });
    const result = await publishLiveScenarioResultRecord({
      generationRoot,
      generationId,
      scenarioId: scenario.id,
      outcome: "fail",
      evaluationSha256: "9".repeat(64),
      turnRecordIds: [turn.recordId],
    });
    const terminal = await terminateLiveScenarioGeneration({
      generationRoot,
      generationId,
      disposition: "completed",
      scenarioResultRecordId: result.recordId,
    });

    const inspected = await inspectLiveScenarioGenerationRecords(generationRoot);
    expect(inspected).toMatchObject({
      generationId,
      lifecycle: "completed",
      resumable: false,
      semanticPassClaim: false,
      nextOperation: "fresh-generation-required",
      records: {
        generation: { recordId: generation.recordId },
        scenario: { recordId: scenarioRecord.recordId },
        attempts: [{ recordId: attempt.recordId }],
        turns: [{ recordId: turn.recordId }],
        scenarioResult: { recordId: result.recordId, outcome: "fail" },
        terminal: { recordId: terminal.recordId, disposition: "completed" },
      },
    });
    expect(
      [
        generation.recordId,
        scenarioRecord.recordId,
        attempt.recordId,
        turn.recordId,
        result.recordId,
        terminal.recordId,
      ].every((identity) => /^sha256:[0-9a-f]{64}$/u.test(identity)),
    ).toBe(true);
    expect(
      new Set([
        scenarioRecord.generationRecordId,
        attempt.generationRecordId,
        turn.generationRecordId,
        result.generationRecordId,
        terminal.generationRecordId,
      ]),
    ).toEqual(new Set([generation.recordId]));
    await expect(
      publishLiveScenarioAttemptReceipt({
        generationRoot,
        generationId,
        scenarioId: scenario.id,
        turn: 2,
        attempt: 1,
        promptSha256: "a".repeat(64),
        invocationStarted: true,
        terminalBoundary: "turn.completed",
        observationSha256: "b".repeat(64),
      }),
    ).rejects.toThrow("Terminal Generation cannot append behavior or resume");
    await expect(
      createLiveScenarioGenerationRecord({
        generationRoot,
        generationId,
        package: {
          evidenceClass: "local-rehearsal",
          packageName: "@lagrangee/bearing",
          packageVersion: "0.1.2-dev",
          sourceHead: "fixture-head",
          worktreeSha256: "2".repeat(64),
          artifact: {
            path: join(generationRoot, "bearing.tgz"),
            file: "bearing.tgz",
            sha256: "3".repeat(64),
          },
          matrixDefinitionSha256,
        },
        matrixDefinitionSha256,
        harnessIdentitySha256: "4".repeat(64),
        admissionIdentitySha256: "5".repeat(64),
        admissionBasisIdentitySha256: "6".repeat(64),
        admittedScenarioCount: 1,
        scenarioId: scenario.id,
      }),
    ).rejects.toThrow("root must be empty");
  });

  test("runs one existing local Scenario through the recorded CLI lifecycle", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-generation-tracer-cli-"));
    const packageRoot = join(root, "package-root");
    const tarball = join(root, "bearing.tgz");
    const packageManifest = join(root, "local-package.json");
    const operatorCodexHome = join(root, "operator-codex-home");
    const workspace = join(root, "scenario-workspace");
    const generationRoot = join(root, "generation");
    const fakeCodex = join(root, "codex-fixture");
    const fakeCodexInvoked = join(root, "codex-invoked");
    const fakeGitleaks = join(root, "gitleaks-bin", "gitleaks");
    const output = join(root, "scenario-result.json");
    const verdicts = join(root, "verdicts.json");
    const generationId = "22222222-2222-4222-8222-222222222222";
    const admissionRegistry = "tests/fixtures/live-scenario-admission-registry.json";
    const registry = await loadLiveScenarioRegistry(admissionRegistry);
    const scenario =
      registry.scenarios.find(({ id }) => id === "TEST-01") ??
      (() => {
        throw new Error("TEST-01 is unavailable.");
      })();

    await Promise.all([
      mkdir(join(packageRoot, "package/docs"), { recursive: true }),
      mkdir(operatorCodexHome),
      mkdir(join(root, "gitleaks-bin")),
    ]);
    await Promise.all([
      writeFile(join(packageRoot, "package/docs/agent-installation.md"), "# Install\n"),
      writeFile(
        join(packageRoot, "package/package.json"),
        '{"name":"@lagrangee/bearing","version":"0.1.2-dev"}\n',
      ),
      writeFile(join(operatorCodexHome, "auth.json"), "{}\n"),
      writeFile(
        fakeCodex,
        `#!/bin/sh
touch ${JSON.stringify(fakeCodexInvoked)}
if [ "$1" = "--version" ]; then
  echo "codex-fixture"
  exit 0
fi
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '%s\n' '{"models":[{"slug":"gpt-5.6-luna","supported_reasoning_levels":[{"effort":"high"}]}]}'
  exit 0
fi
if [ "$1" = "sandbox" ]; then
  exit 0
fi
printf '%s\n' '{"type":"thread.started","thread_id":"33333333-3333-4333-8333-333333333333"}'
printf '%s\n' '{"type":"turn.started"}'
printf '%s\n' '{"type":"turn.completed"}'
`,
      ),
      writeFile(
        fakeGitleaks,
        '#!/bin/sh\nif [ "$1" = "version" ]; then echo 8.30.1; exit 0; fi\nif [ "$1" = "stdin" ]; then cat >/dev/null; exit 0; fi\nexit 64\n',
      ),
    ]);
    await Promise.all([chmod(fakeCodex, 0o755), chmod(fakeGitleaks, 0o755)]);
    const packed = Bun.spawnSync(["tar", "-czf", tarball, "package"], {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(packed.exitCode, packed.stderr.toString()).toBe(0);
    const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
      sourceRoot: process.cwd(),
      registryPath: admissionRegistry,
    });
    await writeLiveScenarioPackageBasis(packageManifest, {
      schemaVersion: 1,
      evidenceClass: "local-rehearsal",
      packageName: "@lagrangee/bearing",
      packageVersion: "0.1.2-dev",
      sourceHead: "fixture-head",
      worktreeSha256: await localRehearsalWorktreeDigest(process.cwd()),
      artifact: {
        path: tarball,
        file: "bearing.tgz",
        sha256: await sha256File(tarball),
      },
      matrixDefinitionSha256,
    });

    const missingHarnessSource = join(root, "missing-harness-source");
    const missingHarnessWorkspace = join(root, "missing-harness-workspace");
    const missingHarnessGenerationRoot = join(root, "missing-harness-generation");
    await mkdir(join(missingHarnessSource, "tests/fixtures"), { recursive: true });
    await cp(join(process.cwd(), admissionRegistry), join(missingHarnessSource, admissionRegistry));
    const missingHarness = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "prepare-scenario",
        "--source-root",
        missingHarnessSource,
        "--registry",
        admissionRegistry,
        "--scenario",
        scenario.id,
        "--package-manifest",
        packageManifest,
        "--workspace",
        missingHarnessWorkspace,
        "--codex-home",
        operatorCodexHome,
        "--generation-id",
        "66666666-6666-4666-8666-666666666666",
        "--generation-root",
        missingHarnessGenerationRoot,
        "--codex-program",
        fakeCodex,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(missingHarness.exitCode, missingHarness.stderr.toString()).toBe(0);
    expect(JSON.parse(missingHarness.stdout.toString())).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "missing-identity" }],
      agentBehaviorStarted: false,
      activeGenerationCreated: false,
      externalEffectsObserved: false,
    });
    await expect(access(fakeCodexInvoked)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(missingHarnessWorkspace)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(missingHarnessGenerationRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const unknownWorkspace = join(root, "unknown-scenario-workspace");
    const unknownGenerationRoot = join(root, "unknown-generation");
    const unknown = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "prepare-scenario",
        "--source-root",
        process.cwd(),
        "--registry",
        admissionRegistry,
        "--scenario",
        "UNKNOWN-99",
        "--package-manifest",
        join(root, "missing-package.json"),
        "--workspace",
        unknownWorkspace,
        "--codex-home",
        operatorCodexHome,
        "--generation-id",
        "55555555-5555-4555-8555-555555555555",
        "--generation-root",
        unknownGenerationRoot,
        "--codex-program",
        fakeCodex,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr.toString()).toContain("Unknown Live Scenario: UNKNOWN-99");
    await expect(access(unknownWorkspace)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(unknownGenerationRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(fakeCodexInvoked)).rejects.toMatchObject({ code: "ENOENT" });

    const invalidRegistryWorkspace = join(root, "invalid-registry-workspace");
    const invalidRegistryGenerationRoot = join(root, "invalid-registry-generation");
    const invalidRegistry = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "prepare-scenario",
        "--source-root",
        process.cwd(),
        "--registry",
        "tests/fixtures/live-scenario-admission-invalid-registry.json",
        "--scenario",
        scenario.id,
        "--package-manifest",
        packageManifest,
        "--workspace",
        invalidRegistryWorkspace,
        "--codex-home",
        operatorCodexHome,
        "--generation-id",
        "44444444-4444-4444-8444-444444444444",
        "--evidence-bundle-root",
        invalidRegistryGenerationRoot,
        "--codex-program",
        fakeCodex,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(invalidRegistry.exitCode, invalidRegistry.stderr.toString()).toBe(0);
    expect(JSON.parse(invalidRegistry.stdout.toString())).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "invalid-registry" }],
      agentBehaviorStarted: false,
      activeGenerationCreated: false,
      externalEffectsObserved: false,
    });
    await expect(access(invalidRegistryWorkspace)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(invalidRegistryGenerationRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(fakeCodexInvoked)).rejects.toMatchObject({ code: "ENOENT" });

    const prepared = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "prepare-scenario",
        "--source-root",
        process.cwd(),
        "--registry",
        admissionRegistry,
        "--scenario",
        scenario.id,
        "--package-manifest",
        packageManifest,
        "--workspace",
        workspace,
        "--codex-home",
        operatorCodexHome,
        "--generation-id",
        generationId,
        "--generation-root",
        generationRoot,
        "--codex-program",
        fakeCodex,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(prepared.exitCode, prepared.stderr.toString()).toBe(0);
    const preparation = JSON.parse(prepared.stdout.toString()) as Readonly<{
      manifest: string;
      prompts: readonly string[];
      generationEvidenceRoot: string;
    }>;
    expect(preparation.generationEvidenceRoot).toBe(generationRoot);

    const sealedManifestBytes = await readFile(preparation.manifest, "utf8");
    const sealedManifestDigestBytes = await readFile(`${preparation.manifest}.sha256`, "utf8");
    const mismatchedManifest = JSON.parse(sealedManifestBytes) as {
      admission: Record<string, unknown> & { identitySha256: string };
      launch: { initial: { arguments: string[] }; resume: { arguments: string[] } };
    };
    const privateCandidateRoot = liveMatrixRecordCandidateRoot(generationRoot);
    const privateControlRoot = liveMatrixPrivateControlRoot(generationRoot);
    expect(mismatchedManifest.launch.initial.arguments.join("\n")).toContain(privateCandidateRoot);
    expect(mismatchedManifest.launch.resume.arguments.join("\n")).toContain(privateCandidateRoot);
    expect(mismatchedManifest.launch.initial.arguments.join("\n")).toContain(privateControlRoot);
    expect(mismatchedManifest.launch.resume.arguments.join("\n")).toContain(privateControlRoot);
    const { identitySha256: _identitySha256, ...bindingValue } = mismatchedManifest.admission;
    bindingValue["compositionReadbackIdentitySha256"] = "f".repeat(64);
    mismatchedManifest.admission = {
      ...bindingValue,
      identitySha256: new Bun.CryptoHasher("sha256")
        .update(`live-scenario-admission-binding-v1\0${JSON.stringify(bindingValue)}\n`)
        .digest("hex"),
    };
    const mismatchedManifestBytes = `${JSON.stringify(mismatchedManifest, null, 2)}\n`;
    await Promise.all([
      writeFile(preparation.manifest, mismatchedManifestBytes),
      writeFile(
        `${preparation.manifest}.sha256`,
        `${new Bun.CryptoHasher("sha256").update(mismatchedManifestBytes).digest("hex")}\n`,
      ),
    ]);
    const mismatchedTurn = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "run-scenario-turn",
        "--manifest",
        preparation.manifest,
        "--turn",
        "1",
        "--prompt-file",
        preparation.prompts[0] as string,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(mismatchedTurn.exitCode).toBe(1);
    expect(mismatchedTurn.stderr.toString()).toContain(
      "immutable Scenario Execution Record does not match",
    );
    await Promise.all([
      writeFile(preparation.manifest, sealedManifestBytes),
      writeFile(`${preparation.manifest}.sha256`, sealedManifestDigestBytes),
    ]);

    const scenarioRecordPath = join(generationRoot, "scenarios", scenario.id, "scenario.json");
    const sealedScenarioRecordBytes = await readFile(scenarioRecordPath, "utf8");
    for (const field of ["fixtureIdentitySha256", "scenarioDefinitionSha256"] as const) {
      const mismatchedRecord = JSON.parse(sealedScenarioRecordBytes) as Record<string, unknown> & {
        recordId: string;
      };
      mismatchedRecord[field] = "e".repeat(64);
      const { recordId: _recordId, ...recordValue } = mismatchedRecord;
      mismatchedRecord.recordId = `sha256:${new Bun.CryptoHasher("sha256")
        .update(`scenario\0${JSON.stringify(recordValue)}\n`)
        .digest("hex")}`;
      await writeFile(scenarioRecordPath, `${JSON.stringify(mismatchedRecord, null, 2)}\n`);
      const mismatchedRecordTurn = Bun.spawnSync(
        [
          process.execPath,
          "scripts/run-live-journey.ts",
          "run-scenario-turn",
          "--manifest",
          preparation.manifest,
          "--turn",
          "1",
          "--prompt-file",
          preparation.prompts[0] as string,
        ],
        { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
      );
      expect(mismatchedRecordTurn.exitCode).toBe(1);
      expect(mismatchedRecordTurn.stderr.toString()).toContain(
        "immutable Scenario Execution Record does not match",
      );
      await writeFile(scenarioRecordPath, sealedScenarioRecordBytes);
    }

    const turn = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "run-scenario-turn",
        "--manifest",
        preparation.manifest,
        "--turn",
        "1",
        "--prompt-file",
        preparation.prompts[0] as string,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(turn.exitCode, turn.stderr.toString()).toBe(0);
    const evidencePointer = "observations/turn-01-attempt-01.json";
    await writeFile(
      verdicts,
      `${JSON.stringify({
        outcome: "fail",
        rationale: "The deterministic Codex fixture did not perform installation behavior.",
        requiredOutcomeObservations: scenario.requiredOutcomes.map((requirement) => ({
          requirement,
          observed: false,
          evidencePointers: [evidencePointer],
        })),
        forbiddenOutcomeObservations: scenario.forbiddenOutcomes.map((requirement) => ({
          requirement,
          observed: false,
          evidencePointers: [evidencePointer],
        })),
      })}\n`,
    );
    const evaluated = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "evaluate-scenario",
        "--manifest",
        preparation.manifest,
        "--verdicts",
        verdicts,
        "--output",
        output,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${join(root, "gitleaks-bin")}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(evaluated.exitCode, evaluated.stderr.toString()).toBe(0);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      generationId,
      scenarioId: scenario.id,
      evaluation: { outcome: "fail", semanticEvaluationAuthority: "coordinating-agent" },
    });

    const inspected = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "inspect-generation",
        "--generation-root",
        generationRoot,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(inspected.exitCode, inspected.stderr.toString()).toBe(0);
    expect(JSON.parse(inspected.stdout.toString())).toMatchObject({
      generationId,
      lifecycle: "completed",
      resumable: false,
      semanticPassClaim: false,
      nextOperation: "fresh-generation-required",
      records: {
        generation: {
          matrixDefinitionSha256,
          harnessIdentitySha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
        scenario: { scenarioId: scenario.id, declaredTurnCount: 1 },
        attempts: [{ turn: 1, attempt: 1 }],
        turns: [{ turn: 1, terminalBoundary: "turn.completed" }],
        scenarioResult: { outcome: "fail" },
        terminal: { disposition: "completed", semanticPassClaim: false },
      },
    });

    const formalWorkspace = join(root, "formal-workspace");
    const formalBundle = join(root, "formal-evidence-bundle");
    const formalGenerationId = "77777777-7777-4777-8777-777777777777";
    const formalPrepared = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "prepare-scenario",
        "--source-root",
        process.cwd(),
        "--registry",
        admissionRegistry,
        "--scenario",
        scenario.id,
        "--package-manifest",
        packageManifest,
        "--workspace",
        formalWorkspace,
        "--codex-home",
        operatorCodexHome,
        "--generation-id",
        formalGenerationId,
        "--evidence-bundle-root",
        formalBundle,
        "--codex-program",
        fakeCodex,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(formalPrepared.exitCode, formalPrepared.stderr.toString()).toBe(0);
    const formalPreparation = JSON.parse(formalPrepared.stdout.toString()) as Readonly<{
      manifest: string;
      prompts: readonly string[];
      evidenceBundleRoot: string;
      scenarioManifests: readonly Readonly<{
        scenarioId: string;
        manifest: string;
        prompts: readonly string[];
      }>[];
    }>;
    expect(formalPreparation.evidenceBundleRoot).toBe(formalBundle);
    expect(formalPreparation.scenarioManifests.map(({ scenarioId }) => scenarioId)).toEqual([
      "TEST-01",
      "TEST-02",
    ]);
    const interruptedScenario = formalPreparation.scenarioManifests.find(
      ({ scenarioId }) => scenarioId === "TEST-02",
    );
    if (interruptedScenario === undefined) throw new Error("TEST-02 manifest is unavailable.");
    await rm(fakeCodexInvoked, { force: true });
    await createLiveMatrixAttemptRecord({
      evidenceRoot: formalBundle,
      generationId: formalGenerationId,
      scenarioId: "TEST-02",
      turn: 1,
      attempt: 1,
      promptSha256: createHash("sha256")
        .update((await readFile(interruptedScenario.prompts[0] as string, "utf8")).trimEnd())
        .digest("hex"),
      runtimeIdentitySha256: "f".repeat(64),
    });
    const interruptedRun = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "run-scenario-turn",
        "--manifest",
        interruptedScenario.manifest,
        "--turn",
        "1",
        "--prompt-file",
        interruptedScenario.prompts[0] as string,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(interruptedRun.exitCode).toBe(1);
    expect(interruptedRun.stderr.toString()).toContain("Agent behavior will not rerun");
    await expect(access(fakeCodexInvoked)).rejects.toMatchObject({ code: "ENOENT" });
    const formalTurn = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "run-scenario-turn",
        "--manifest",
        formalPreparation.manifest,
        "--turn",
        "1",
        "--prompt-file",
        formalPreparation.prompts[0] as string,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "test",
          BEARING_LIVE_MATRIX_TEST_CRASH_BEFORE_TURN_RECORD: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(formalTurn.exitCode).toBe(1);
    expect(formalTurn.stderr.toString()).toContain(
      "Injected crash before formal Turn record publication",
    );
    await expect(access(fakeCodexInvoked)).resolves.toBeNull();
    await expect(
      access(join(formalBundle, "scenarios/TEST-01/turns/01.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await rm(fakeCodexInvoked, { force: true });
    const recoveredFormalTurn = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "run-scenario-turn",
        "--manifest",
        formalPreparation.manifest,
        "--turn",
        "1",
        "--prompt-file",
        formalPreparation.prompts[0] as string,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(recoveredFormalTurn.exitCode, recoveredFormalTurn.stderr.toString()).toBe(0);
    expect(JSON.parse(recoveredFormalTurn.stdout.toString())).toMatchObject({
      agentBehaviorStarted: false,
      recoveredTurnRecordId: expect.stringMatching(/^sha256:/u),
    });
    await expect(access(fakeCodexInvoked)).rejects.toMatchObject({ code: "ENOENT" });
    const formalOutput = join(formalBundle, "payloads/scenario-results/TEST-01.json");
    await rm(fakeCodexInvoked, { force: true });
    const gitleaksPath = `${join(root, "gitleaks-bin")}:${process.env["PATH"] ?? "/usr/bin:/bin"}`;
    const stagedFormalEvaluation = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "evaluate-scenario",
        "--manifest",
        formalPreparation.manifest,
        "--verdicts",
        verdicts,
        "--output",
        formalOutput,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "test",
          PATH: gitleaksPath,
          BEARING_LIVE_MATRIX_TEST_CRASH_AFTER_STAGE: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(stagedFormalEvaluation.exitCode).toBe(1);
    expect(stagedFormalEvaluation.stderr.toString()).toContain(
      "Injected crash after atomic evidence staging",
    );
    await expect(access(fakeCodexInvoked)).rejects.toMatchObject({ code: "ENOENT" });
    const formalManifest = JSON.parse(
      await readFile(formalPreparation.manifest, "utf8"),
    ) as Readonly<{ paths: Readonly<{ workspaceRoot: string }> }>;
    const controlRoot = join(
      dirname(formalManifest.paths.workspaceRoot),
      ".live-matrix-private-control",
      formalGenerationId,
      "TEST-01",
      createHash("sha256")
        .update(join(await realpath(dirname(formalOutput)), basename(formalOutput)))
        .digest("hex")
        .slice(0, 24),
    );
    const envelopePath = join(controlRoot, "publications/test-01-result/envelope.json");
    const stagedEnvelopeBytes = await readFile(envelopePath);
    const stagedEnvelope = JSON.parse(stagedEnvelopeBytes.toString("utf8")) as Readonly<{
      stagedSha256: string;
    }>;
    await rm(dirname(formalOutput), { recursive: true });
    const originalVerdicts = await readFile(verdicts, "utf8");
    const changedVerdicts = JSON.parse(originalVerdicts) as Record<string, unknown>;
    changedVerdicts["rationale"] = "A changed semantic judgment must not replace staged bytes.";
    await writeFile(verdicts, `${JSON.stringify(changedVerdicts)}\n`);
    const changedFormalEvaluation = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "evaluate-scenario",
        "--manifest",
        formalPreparation.manifest,
        "--verdicts",
        verdicts,
        "--output",
        formalOutput,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: gitleaksPath },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(changedFormalEvaluation.exitCode).toBe(1);
    expect(changedFormalEvaluation.stderr.toString()).toContain("unexpected writer overlap");
    expect(await readFile(envelopePath)).toEqual(stagedEnvelopeBytes);
    expect(
      (JSON.parse(await readFile(envelopePath, "utf8")) as Readonly<{ stagedSha256: string }>)
        .stagedSha256,
    ).toBe(stagedEnvelope.stagedSha256);
    await expect(access(fakeCodexInvoked)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(verdicts, originalVerdicts);
    const recoveredFormalEvaluation = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "recover-evidence-publication",
        "--control-root",
        controlRoot,
        "--evidence-root",
        formalBundle,
        "--publication-id",
        "test-01-result",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: gitleaksPath },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(recoveredFormalEvaluation.exitCode, recoveredFormalEvaluation.stderr.toString()).toBe(0);
    expect(JSON.parse(recoveredFormalEvaluation.stdout.toString())).toMatchObject({
      state: "published",
      scenarioResultRecordId: expect.stringMatching(/^sha256:/u),
    });
    await expect(access(fakeCodexInvoked)).rejects.toMatchObject({ code: "ENOENT" });
    const formalInspected = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "inspect-evidence-bundle",
        "--evidence-bundle-root",
        formalBundle,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(formalInspected.exitCode, formalInspected.stderr.toString()).toBe(0);
    expect(JSON.parse(formalInspected.stdout.toString())).toMatchObject({
      generationId: formalGenerationId,
      lifecycle: "active",
      nextMissingRecord: "turn:TEST-02:1",
      records: {
        generation: { writer: "coordinator" },
        scenarios: [
          { scenarioId: "TEST-01", writer: "scenario-runner:TEST-01" },
          { scenarioId: "TEST-02", writer: "scenario-runner:TEST-02" },
        ],
        attempts: [
          { scenarioId: "TEST-01", turn: 1, attempt: 1 },
          { scenarioId: "TEST-02", turn: 1, attempt: 1 },
        ],
        turns: [{ scenarioId: "TEST-01", turn: 1 }],
        scenarioResults: [{ scenarioId: "TEST-01", outcome: "fail" }],
      },
    });
    await expect(
      access(join(formalBundle, "coordinator/generation-terminal.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);
});
