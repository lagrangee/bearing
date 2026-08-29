import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { localRehearsalWorktreeDigest } from "../scripts/live-journey-matrix";
import {
  createLiveMatrixAttemptRecord,
  createLiveMatrixConvergenceReviewRecord,
  createLiveMatrixGenerationRecord,
  createLiveMatrixMatrixResultRecord,
  createLiveMatrixScenarioRecord,
  createLiveMatrixScenarioResultRecord,
  createLiveMatrixTerminalRecord,
  createLiveMatrixTurnRecord,
  inspectLiveMatrixEvidenceRecords,
  liveMatrixPrivateControlRoot,
  liveMatrixRecordCandidateRoot,
  recoverLiveMatrixEvidencePublication,
  stageLiveMatrixDurableEvidence,
} from "../scripts/live-matrix-evidence-bundle";
import { liveScenarioMatrixPackageIdentitySha256 } from "../scripts/live-scenario-generation";
import { loadLiveScenarioRegistry } from "../scripts/live-scenario-registry";
import { liveScenarioDefinitionDigest } from "../scripts/live-scenario-runner";

const digest = (character: string): string => character.repeat(64);

const fakeGitleaks = async (root: string): Promise<string> => {
  const program = join(root, "gitleaks");
  await mkdir(root, { recursive: true });
  await writeFile(
    program,
    '#!/bin/sh\nif [ "$1" = "version" ]; then echo 8.30.1; exit 0; fi\nif [ "$1" = "stdin" ]; then cat >/dev/null; exit 0; fi\nexit 64\n',
  );
  await chmod(program, 0o755);
  return program;
};

const durablePayload = async (root: string, pointer: string, value: unknown) => {
  const path = join(root, pointer);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, bytes);
  return { pointer, sha256: createHash("sha256").update(bytes).digest("hex") };
};

const boundedPackage = {
  evidenceClass: "local-rehearsal" as const,
  packageName: "@lagrangee/bearing" as const,
  packageVersion: "0.1.2-test",
  sourceHead: "test-source-head",
  worktreeSha256: digest("a"),
  artifact: { file: "bearing.tgz", sha256: digest("b") },
  matrixDefinitionSha256: digest("2"),
};
const boundedPackageIdentitySha256 = liveScenarioMatrixPackageIdentitySha256(boundedPackage);

const fullScenarioPayload = (
  generationId: string,
  scenarioId: string,
  outcome: "pass" | "fail" | "blocked" | "not-run",
  startingStateSha256 = digest("c"),
) => ({
  schemaVersion: 1 as const,
  evidenceClass: "local-rehearsal" as const,
  generationId,
  scenarioId,
  package: boundedPackage,
  matrixDefinitionSha256: boundedPackage.matrixDefinitionSha256,
  codex: {
    cliVersion: "codex-test",
    requestedModel: "gpt-5.6-luna" as const,
    requestedReasoningEffort: "high" as const,
  },
  coordinatorIdentity: "test-coordinator",
  startingStateSha256,
  durationMs: 10,
  attempts: [],
  evaluation: {
    schemaVersion: 1 as const,
    scenarioId,
    outcome,
    semanticEvaluationAuthority: "coordinating-agent" as const,
    coordinatorIdentity: "test-coordinator",
    rationale: `Typed ${scenarioId} ${outcome} result.`,
    requiredOutcomeObservations: [
      {
        requirement: "The required outcome is observed.",
        observed: outcome === "pass",
        evidencePointers: ["observations/turn-01.json"],
      },
    ],
    forbiddenOutcomeObservations: [
      {
        requirement: "The forbidden outcome is absent.",
        observed: false,
        evidencePointers: ["observations/turn-01.json"],
      },
    ],
  },
});

const fullMatrixPayload = (
  generationId: string,
  scenarios: readonly Readonly<{
    scenarioId: string;
    outcome: "pass" | "fail" | "blocked" | "not-run";
    startingStateSha256?: string;
    evidence?: Readonly<{ pointer: string; sha256: string }>;
  }>[],
) => {
  const allPass = scenarios.every(({ outcome }) => outcome === "pass");
  return {
    schemaVersion: 1 as const,
    evidenceClass: "local-rehearsal" as const,
    generationId,
    package: boundedPackage,
    matrixDefinitionSha256: boundedPackage.matrixDefinitionSha256,
    codex: {
      cliVersion: "codex-test",
      requestedModel: "gpt-5.6-luna" as const,
      requestedReasoningEffort: "high" as const,
    },
    coordinatorIdentity: "test-coordinator",
    semanticEvaluationAuthority: "coordinating-agent" as const,
    durationMs: scenarios.length * 10,
    terminalOutcome: allPass ? ("pass" as const) : ("not-pass" as const),
    releasePrerequisiteSatisfied: false,
    scenarios: scenarios.map(({ scenarioId, outcome, startingStateSha256, evidence }) => ({
      scenarioId,
      outcome,
      durationMs: 10,
      startingStateSha256: startingStateSha256 ?? digest("c"),
      attempts: [],
      rationale: `Typed ${scenarioId} ${outcome} result.`,
      result: evidence
        ? {
            pointer: relative("payloads", evidence.pointer).replaceAll("\\", "/"),
            sha256: evidence.sha256,
          }
        : {
            pointer: `scenario-results/${scenarioId}.json`,
            sha256: digest(scenarioId === "ENTRY-01" ? "d" : "e"),
          },
    })),
  };
};

describe("recoverable secret-free Live Matrix evidence", () => {
  test("recovers exact staged bytes across scan, private cleanup, and atomic publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-evidence-publication-"));
    const controlRoot = join(root, "private-control");
    const evidenceRoot = join(root, "published");
    const cleanupRoot = join(root, "private-runtime");
    const transcript = join(cleanupRoot, "transcripts");
    const session = join(cleanupRoot, "session.json");
    const credential = join(cleanupRoot, "auth.json");
    const runtime = join(cleanupRoot, "runtime");
    await Promise.all([mkdir(evidenceRoot, { recursive: true }), mkdir(cleanupRoot)]);
    await Promise.all([
      mkdir(transcript, { recursive: true }),
      mkdir(runtime, { recursive: true }),
      writeFile(session, '{"thread":"private"}\n'),
      writeFile(credential, '{"token":"private"}\n'),
    ]);
    await writeFile(join(transcript, "turn.jsonl"), "private transcript\n");
    await writeFile(join(runtime, "state"), "private runtime\n");
    const program = await fakeGitleaks(root);
    const durableValue = {
      schemaVersion: 1,
      generationId: "11111111-1111-4111-8111-111111111111",
      scenarioId: "ENTRY-01",
      outcome: "fail",
      evidencePointers: ["observations/turn-01.json"],
    };
    const staged = await stageLiveMatrixDurableEvidence({
      controlRoot,
      evidenceRoot,
      publicationId: "entry-01-result",
      pointer: "scenario-results/ENTRY-01.json",
      value: durableValue,
      cleanupScopes: [
        { root: cleanupRoot, pointers: ["transcripts", "session.json", "auth.json", "runtime"] },
      ],
    });
    const envelope = JSON.parse(await readFile(staged.stagedPath, "utf8")) as Readonly<{
      stagedBytesBase64: string;
    }>;
    const stagedBytes = Buffer.from(envelope.stagedBytesBase64, "base64");
    expect(await readdir(join(controlRoot, "publications/entry-01-result"))).toEqual([
      "envelope.json",
    ]);
    const wrongEvidenceRoot = join(root, "wrong-published");
    await mkdir(wrongEvidenceRoot);
    await expect(
      recoverLiveMatrixEvidencePublication({
        controlRoot,
        evidenceRoot: wrongEvidenceRoot,
        publicationId: "entry-01-result",
        configPath: join(process.cwd(), ".gitleaks.toml"),
        program,
      }),
    ).rejects.toThrow("Evidence Bundle identity mismatch");
    await expect(access(transcript)).resolves.toBeNull();
    await expect(
      access(join(controlRoot, "publications/entry-01-result/scan.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      recoverLiveMatrixEvidencePublication({
        controlRoot,
        evidenceRoot,
        publicationId: "entry-01-result",
        configPath: join(process.cwd(), ".gitleaks.toml"),
        program,
        crashAfter: "scan",
      }),
    ).rejects.toThrow("Injected crash after scan");
    await expect(access(transcript)).resolves.toBeNull();
    await expect(
      access(join(evidenceRoot, "scenario-results/ENTRY-01.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      recoverLiveMatrixEvidencePublication({
        controlRoot,
        evidenceRoot,
        publicationId: "entry-01-result",
        configPath: join(process.cwd(), ".gitleaks.toml"),
        program,
        crashAfter: "cleanup",
      }),
    ).rejects.toThrow("Injected crash after cleanup");
    for (const path of [transcript, session, credential, runtime]) {
      await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    }

    await expect(
      recoverLiveMatrixEvidencePublication({
        controlRoot,
        evidenceRoot,
        publicationId: "entry-01-result",
        configPath: join(process.cwd(), ".gitleaks.toml"),
        program,
        crashAfter: "publish",
      }),
    ).rejects.toThrow("Injected crash after publish");
    expect(await readFile(join(evidenceRoot, "scenario-results/ENTRY-01.json"))).toEqual(
      stagedBytes,
    );

    const recovered = await recoverLiveMatrixEvidencePublication({
      controlRoot,
      evidenceRoot,
      publicationId: "entry-01-result",
      configPath: join(process.cwd(), ".gitleaks.toml"),
      program,
    });
    expect(recovered).toMatchObject({
      state: "published",
      pointer: "scenario-results/ENTRY-01.json",
    });
    await expect(access(staged.stagedPath)).resolves.toBeNull();
  });

  test("rejects private durable fields and fails closed on corrupt staging or writer overlap", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-evidence-fail-closed-"));
    const evidenceRoot = join(root, "published");
    await mkdir(evidenceRoot);
    await expect(
      stageLiveMatrixDurableEvidence({
        controlRoot: join(root, "control"),
        evidenceRoot,
        publicationId: "secret",
        pointer: "results/secret.json",
        value: { transcript: "raw", source: "/Users/private/repository" },
        cleanupScopes: [{ root, pointers: [] }],
      }),
    ).rejects.toThrow("private field");
    await expect(
      stageLiveMatrixDurableEvidence({
        controlRoot: join(root, "embedded-path-control"),
        evidenceRoot,
        publicationId: "embedded-path",
        pointer: "payloads/embedded-path.json",
        value: { rationale: "Observed /Users/clawd/private/config during evaluation." },
        cleanupScopes: [{ root, pointers: [] }],
      }),
    ).rejects.toThrow("machine-private path");
    for (const [publicationId, path] of [
      ["embedded-file-url-path", "source=file:///Users/clawd/private/config"],
      ["embedded-localhost-file-url-path", "source=file://localhost/Users/clawd/private/config"],
      ["embedded-host-file-url-path", "source=file://my-mac.local/Users/clawd/private/config"],
    ] as const) {
      await expect(
        stageLiveMatrixDurableEvidence({
          controlRoot: join(root, `${publicationId}-control`),
          evidenceRoot,
          publicationId,
          pointer: `payloads/${publicationId}.json`,
          value: { rationale: path },
          cleanupScopes: [{ root, pointers: [] }],
        }),
      ).rejects.toThrow("machine-private path");
    }
    await expect(
      stageLiveMatrixDurableEvidence({
        controlRoot: join(root, "embedded-key-value-path-control"),
        evidenceRoot,
        publicationId: "embedded-key-value-path",
        pointer: "payloads/embedded-key-value-path.json",
        value: { rationale: "source=/Users/clawd/private/config" },
        cleanupScopes: [{ root, pointers: [] }],
      }),
    ).rejects.toThrow("machine-private path");
    await expect(
      stageLiveMatrixDurableEvidence({
        controlRoot: join(root, "normalized-key-control"),
        evidenceRoot,
        publicationId: "normalized-key",
        pointer: "payloads/normalized-key.json",
        value: { secretaryRole: "Coordinator" },
        cleanupScopes: [{ root, pointers: [] }],
      }),
    ).resolves.toMatchObject({ publicationId: "normalized-key" });
    await expect(
      stageLiveMatrixDurableEvidence({
        controlRoot: join(root, "access-token-control"),
        evidenceRoot,
        publicationId: "access-token",
        pointer: "payloads/access-token.json",
        value: {
          apiToken: "x",
          password: "x",
          authorization: "x",
          cookie: "x",
          privateKey: "x",
        },
        cleanupScopes: [{ root, pointers: [] }],
      }),
    ).rejects.toThrow("private field");

    const staged = await stageLiveMatrixDurableEvidence({
      controlRoot: join(root, "control"),
      evidenceRoot,
      publicationId: "result",
      pointer: "results/result.json",
      value: { schemaVersion: 1, outcome: "blocked" },
      cleanupScopes: [{ root, pointers: [] }],
    });
    const corruptEnvelope = JSON.parse(await readFile(staged.stagedPath, "utf8")) as Record<
      string,
      unknown
    >;
    corruptEnvelope["stagedBytesBase64"] = Buffer.from('{"corrupt":true}\n').toString("base64");
    await writeFile(staged.stagedPath, `${JSON.stringify(corruptEnvelope, null, 2)}\n`);
    await expect(
      recoverLiveMatrixEvidencePublication({
        controlRoot: join(root, "control"),
        evidenceRoot,
        publicationId: "result",
        configPath: join(process.cwd(), ".gitleaks.toml"),
        program: await fakeGitleaks(root),
      }),
    ).rejects.toThrow("staged evidence digest mismatch");
    expect(JSON.parse(await readFile(staged.stagedPath, "utf8"))).toMatchObject({
      stagedBytesBase64: Buffer.from('{"corrupt":true}\n').toString("base64"),
    });

    const overlap = await stageLiveMatrixDurableEvidence({
      controlRoot: join(root, "control"),
      evidenceRoot,
      publicationId: "overlap",
      pointer: "results/overlap.json",
      value: { schemaVersion: 1, outcome: "fail" },
      cleanupScopes: [{ root, pointers: [] }],
    });
    await mkdir(join(evidenceRoot, "results"), { recursive: true });
    await writeFile(join(evidenceRoot, "results/overlap.json"), "different writer\n");
    await expect(
      recoverLiveMatrixEvidencePublication({
        controlRoot: join(root, "control"),
        evidenceRoot,
        publicationId: "overlap",
        configPath: join(process.cwd(), ".gitleaks.toml"),
        program: await fakeGitleaks(join(root, "second-scanner")),
      }),
    ).rejects.toThrow("unexpected writer overlap");
    await expect(access(overlap.stagedPath)).resolves.toBeNull();

    await expect(
      stageLiveMatrixDurableEvidence({
        controlRoot: join(root, "broad-control"),
        evidenceRoot,
        publicationId: "broad",
        pointer: "results/broad.json",
        value: { schemaVersion: 1 },
        cleanupScopes: [{ root: "/", pointers: ["tmp"] }],
      }),
    ).rejects.toThrow("Unsafe private cleanup root");
    const boundedCleanup = join(root, "bounded-cleanup");
    const outsideCleanup = join(root, "outside-cleanup");
    await Promise.all([mkdir(boundedCleanup), mkdir(outsideCleanup)]);
    await symlink(outsideCleanup, join(boundedCleanup, "escape"));
    await expect(
      stageLiveMatrixDurableEvidence({
        controlRoot: join(root, "escape-control"),
        evidenceRoot,
        publicationId: "escape",
        pointer: "results/escape.json",
        value: { schemaVersion: 1 },
        cleanupScopes: [{ root: boundedCleanup, pointers: ["escape"] }],
      }),
    ).rejects.toThrow("escapes its root");
    await expect(
      stageLiveMatrixDurableEvidence({
        controlRoot: join(root, "ancestor-control"),
        evidenceRoot,
        publicationId: "ancestor",
        pointer: "results/ancestor.json",
        value: { schemaVersion: 1 },
        cleanupScopes: [{ root: dirname(process.cwd()), pointers: [basename(process.cwd())] }],
      }),
    ).rejects.toThrow("contains a protected root");
    await expect(access(process.cwd())).resolves.toBeNull();
  });
});

describe("typed append-only Live Matrix record closure", () => {
  test("publishes identical create-once records under high concurrency without candidate races", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-matrix-create-once-concurrency-"));
    const create = () =>
      createLiveMatrixGenerationRecord({
        evidenceRoot: root,
        generationId: "99999999-9999-4999-8999-999999999999",
        scenarioIds: ["ENTRY-01"],
        packageIdentitySha256: digest("1"),
        matrixDefinitionSha256: digest("2"),
        harnessIdentitySha256: digest("3"),
        admissionIdentitySha256: digest("4"),
      });
    const records = await Promise.all(Array.from({ length: 200 }, create));
    expect(new Set(records.map(({ recordId }) => recordId)).size).toBe(1);
    expect(await readdir(root)).toEqual(["generation.json"]);
  });

  test("keeps a crash-stale record candidate outside the durable bundle and recovers exactly", async () => {
    const base = await mkdtemp(join(tmpdir(), "bearing-matrix-create-once-crash-"));
    const root = join(base, "evidence");
    const helper = join(base, "create-generation.ts");
    await writeFile(
      helper,
      [
        `import { createLiveMatrixGenerationRecord } from ${JSON.stringify(join(process.cwd(), "scripts/live-matrix-evidence-bundle.ts"))};`,
        "await createLiveMatrixGenerationRecord({",
        `  evidenceRoot: ${JSON.stringify(root)},`,
        '  generationId: "99999999-9999-4999-8999-999999999999",',
        '  scenarioIds: ["ENTRY-01"],',
        `  packageIdentitySha256: ${JSON.stringify(digest("1"))},`,
        `  matrixDefinitionSha256: ${JSON.stringify(digest("2"))},`,
        `  harnessIdentitySha256: ${JSON.stringify(digest("3"))},`,
        `  admissionIdentitySha256: ${JSON.stringify(digest("4"))},`,
        "});",
      ].join("\n"),
    );
    const crashed = Bun.spawnSync([process.execPath, helper], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        BEARING_LIVE_MATRIX_TEST_CRASH_AFTER_RECORD_CANDIDATE: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(crashed.exitCode).toBe(1);
    expect(crashed.stderr.toString()).toContain("Injected crash after record candidate");
    expect(await readdir(root)).toEqual([]);
    expect((await readdir(liveMatrixRecordCandidateRoot(root))).length).toBe(1);

    const recovered = Bun.spawnSync([process.execPath, helper], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(recovered.exitCode, recovered.stderr.toString()).toBe(0);
    expect(await readdir(root)).toEqual(["generation.json"]);
    await expect(inspectLiveMatrixEvidenceRecords(root)).resolves.toMatchObject({
      generationId: "99999999-9999-4999-8999-999999999999",
      nextMissingRecord: "scenario:ENTRY-01",
    });
  });

  test("rejects payload identity contradictions and closes coordinator and payload namespaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-matrix-payload-closure-"));
    const generation = await createLiveMatrixGenerationRecord({
      evidenceRoot: root,
      generationId: "77777777-7777-4777-8777-777777777777",
      scenarioIds: ["ENTRY-01"],
      packageIdentitySha256: boundedPackageIdentitySha256,
      matrixDefinitionSha256: digest("2"),
      harnessIdentitySha256: digest("3"),
      admissionIdentitySha256: digest("4"),
    });
    await createLiveMatrixScenarioRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioId: "ENTRY-01",
      definitionSha256: digest("5"),
      fixtureSha256: digest("6"),
      declaredTurnCount: 1,
    });
    const attempt = await createLiveMatrixAttemptRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioId: "ENTRY-01",
      turn: 1,
      attempt: 1,
      promptSha256: digest("7"),
      runtimeIdentitySha256: digest("8"),
    });
    const turn = await createLiveMatrixTurnRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioId: "ENTRY-01",
      turn: 1,
      attemptRecordIds: [attempt.recordId],
      terminalAttemptRecordId: attempt.recordId,
      observationSha256: digest("9"),
      terminalBoundary: "turn.completed",
    });
    const scenarioPointer = "payloads/scenario-results/ENTRY-01.json";
    const minimalScenario = await durablePayload(root, scenarioPointer, {
      generationId: generation.generationId,
      scenarioId: "ENTRY-01",
      evaluation: { outcome: "pass" },
    });
    await expect(
      createLiveMatrixScenarioResultRecord({
        evidenceRoot: root,
        generationId: generation.generationId,
        scenarioId: "ENTRY-01",
        outcome: "pass",
        evidence: minimalScenario,
        turnRecordIds: [turn.recordId],
      }),
    ).rejects.toThrow();
    const contradictoryScenario = await durablePayload(
      root,
      scenarioPointer,
      fullScenarioPayload("88888888-8888-4888-8888-888888888888", "CONFIG-99", "fail", digest("6")),
    );
    await expect(
      createLiveMatrixScenarioResultRecord({
        evidenceRoot: root,
        generationId: generation.generationId,
        scenarioId: "ENTRY-01",
        outcome: "pass",
        evidence: contradictoryScenario,
        turnRecordIds: [turn.recordId],
      }),
    ).rejects.toThrow("payload identity");
    const contradictoryStartingState = await durablePayload(
      root,
      scenarioPointer,
      fullScenarioPayload(generation.generationId, "ENTRY-01", "pass", digest("0")),
    );
    await expect(
      createLiveMatrixScenarioResultRecord({
        evidenceRoot: root,
        generationId: generation.generationId,
        scenarioId: "ENTRY-01",
        outcome: "pass",
        evidence: contradictoryStartingState,
        turnRecordIds: [turn.recordId],
      }),
    ).rejects.toThrow("payload identity");
    const contradictoryPackage = await durablePayload(root, scenarioPointer, {
      ...fullScenarioPayload(generation.generationId, "ENTRY-01", "pass", digest("6")),
      package: { ...boundedPackage, sourceHead: "different-source-head" },
    });
    await expect(
      createLiveMatrixScenarioResultRecord({
        evidenceRoot: root,
        generationId: generation.generationId,
        scenarioId: "ENTRY-01",
        outcome: "pass",
        evidence: contradictoryPackage,
        turnRecordIds: [turn.recordId],
      }),
    ).rejects.toThrow("payload identity");
    const scenarioEvidence = await durablePayload(
      root,
      scenarioPointer,
      fullScenarioPayload(generation.generationId, "ENTRY-01", "pass", digest("6")),
    );
    const scenarioResult = await createLiveMatrixScenarioResultRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioId: "ENTRY-01",
      outcome: "pass",
      evidence: scenarioEvidence,
      turnRecordIds: [turn.recordId],
    });
    const matrixPointer = "payloads/matrix-result.json";
    const contradictoryMatrix = await durablePayload(
      root,
      matrixPointer,
      fullMatrixPayload(generation.generationId, [
        {
          scenarioId: "ENTRY-01",
          outcome: "fail",
          startingStateSha256: digest("6"),
          evidence: scenarioEvidence,
        },
      ]),
    );
    await expect(
      createLiveMatrixMatrixResultRecord({
        evidenceRoot: root,
        generationId: generation.generationId,
        scenarioResultRecordIds: [scenarioResult.recordId],
        evidence: contradictoryMatrix,
      }),
    ).rejects.toThrow("payload identity");
    const contradictoryMatrixReference = await durablePayload(
      root,
      matrixPointer,
      fullMatrixPayload(generation.generationId, [
        {
          scenarioId: "ENTRY-01",
          outcome: "pass",
          startingStateSha256: digest("6"),
          evidence: { ...scenarioEvidence, sha256: digest("f") },
        },
      ]),
    );
    await expect(
      createLiveMatrixMatrixResultRecord({
        evidenceRoot: root,
        generationId: generation.generationId,
        scenarioResultRecordIds: [scenarioResult.recordId],
        evidence: contradictoryMatrixReference,
      }),
    ).rejects.toThrow("payload identity");
    for (const identityMismatch of [
      {
        codex: {
          cliVersion: "codex-other",
          requestedModel: "gpt-5.6-luna" as const,
          requestedReasoningEffort: "high" as const,
        },
      },
      { coordinatorIdentity: "other-coordinator" },
    ]) {
      const base = fullMatrixPayload(generation.generationId, [
        {
          scenarioId: "ENTRY-01",
          outcome: "pass",
          startingStateSha256: digest("6"),
          evidence: scenarioEvidence,
        },
      ]);
      const mismatchedIdentityEvidence = await durablePayload(root, matrixPointer, {
        ...base,
        ...identityMismatch,
      });
      await expect(
        createLiveMatrixMatrixResultRecord({
          evidenceRoot: root,
          generationId: generation.generationId,
          scenarioResultRecordIds: [scenarioResult.recordId],
          evidence: mismatchedIdentityEvidence,
        }),
      ).rejects.toThrow("payload identity");
    }
    const matrixEvidence = await durablePayload(
      root,
      matrixPointer,
      fullMatrixPayload(generation.generationId, [
        {
          scenarioId: "ENTRY-01",
          outcome: "pass",
          startingStateSha256: digest("6"),
          evidence: scenarioEvidence,
        },
      ]),
    );
    const matrix = await createLiveMatrixMatrixResultRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioResultRecordIds: [scenarioResult.recordId],
      evidence: matrixEvidence,
    });
    for (const identityMismatch of [
      {
        codex: {
          cliVersion: "codex-inspection-other",
          requestedModel: "gpt-5.6-luna" as const,
          requestedReasoningEffort: "high" as const,
        },
      },
      { coordinatorIdentity: "inspection-other-coordinator" },
    ]) {
      const base = fullMatrixPayload(generation.generationId, [
        {
          scenarioId: "ENTRY-01",
          outcome: "pass",
          startingStateSha256: digest("6"),
          evidence: scenarioEvidence,
        },
      ]);
      const forgedEvidence = await durablePayload(root, matrixPointer, {
        ...base,
        ...identityMismatch,
      });
      const { recordId: _recordId, ...recordBasis } = matrix;
      const forgedBasis = { ...recordBasis, evidence: forgedEvidence };
      const forgedRecord = {
        ...forgedBasis,
        recordId: `sha256:${createHash("sha256")
          .update(`matrix-result\0${JSON.stringify(forgedBasis)}\n`)
          .digest("hex")}`,
      };
      await writeFile(
        join(root, "coordinator/matrix-result.json"),
        `${JSON.stringify(forgedRecord, null, 2)}\n`,
      );
      await expect(inspectLiveMatrixEvidenceRecords(root)).rejects.toThrow("payload identity");
    }
    await durablePayload(
      root,
      matrixPointer,
      fullMatrixPayload(generation.generationId, [
        {
          scenarioId: "ENTRY-01",
          outcome: "pass",
          startingStateSha256: digest("6"),
          evidence: scenarioEvidence,
        },
      ]),
    );
    await writeFile(
      join(root, "coordinator/matrix-result.json"),
      `${JSON.stringify(matrix, null, 2)}\n`,
    );
    const terminal = await createLiveMatrixTerminalRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      matrixResultRecordId: matrix.recordId,
      disposition: "completed",
    });
    const reviewPointer = "payloads/convergence-review.json";
    const contradictoryReview = await durablePayload(root, reviewPointer, {
      generationId: generation.generationId,
      terminalRecordId: `sha256:${digest("a")}`,
      scenarioResultRecordIds: [scenarioResult.recordId],
    });
    await expect(
      createLiveMatrixConvergenceReviewRecord({
        evidenceRoot: root,
        generationId: generation.generationId,
        terminalRecordId: terminal.recordId,
        scenarioResultRecordIds: [scenarioResult.recordId],
        evidence: contradictoryReview,
      }),
    ).rejects.toThrow("payload identity");
    const reviewEvidence = await durablePayload(root, reviewPointer, {
      generationId: generation.generationId,
      terminalRecordId: terminal.recordId,
      scenarioResultRecordIds: [scenarioResult.recordId],
    });
    await createLiveMatrixConvergenceReviewRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      terminalRecordId: terminal.recordId,
      scenarioResultRecordIds: [scenarioResult.recordId],
      evidence: reviewEvidence,
    });
    await expect(inspectLiveMatrixEvidenceRecords(root)).resolves.toMatchObject({
      lifecycle: "completed",
    });

    await writeFile(join(root, "coordinator/scenario-results/ENTRY-01"), "{}\n");
    await expect(inspectLiveMatrixEvidenceRecords(root)).rejects.toThrow(
      "unexpected Scenario Result writer overlap",
    );
    await rm(join(root, "coordinator/scenario-results/ENTRY-01"));
    await writeFile(join(root, "payloads/raw-transcript.txt"), "raw private transcript\n");
    await expect(inspectLiveMatrixEvidenceRecords(root)).rejects.toThrow(
      "unexpected payload entry",
    );
  });

  test("completes and strictly inspects a formal Matrix with private control outside the bundle", async () => {
    const base = await mkdtemp(join(tmpdir(), "bearing-formal-matrix-completion-"));
    const evidenceRoot = join(base, "evidence");
    const output = join(evidenceRoot, "payloads/matrix-result.json");
    const resultsRoot = join(evidenceRoot, "payloads/scenario-results");
    const generationId = "55555555-5555-4555-8555-555555555555";
    const registryPath = join(process.cwd(), "validation/live-journey/registry.json");
    const registry = await loadLiveScenarioRegistry(registryPath);
    const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
      sourceRoot: process.cwd(),
      registryPath: "validation/live-journey/registry.json",
    });
    const matrixPackage = {
      evidenceClass: "local-rehearsal" as const,
      packageName: "@lagrangee/bearing" as const,
      packageVersion: "0.1.2-test",
      sourceHead: "fixture-head",
      worktreeSha256: await localRehearsalWorktreeDigest(process.cwd()),
      artifact: { file: "bearing.tgz", sha256: digest("a") },
      matrixDefinitionSha256,
    };
    const generation = await createLiveMatrixGenerationRecord({
      evidenceRoot,
      generationId,
      scenarioIds: registry.scenarios.map(({ id }) => id),
      packageIdentitySha256: liveScenarioMatrixPackageIdentitySha256(matrixPackage),
      matrixDefinitionSha256,
      harnessIdentitySha256: digest("b"),
      admissionIdentitySha256: digest("c"),
    });
    for (const scenario of registry.scenarios) {
      await createLiveMatrixScenarioRecord({
        evidenceRoot,
        generationId,
        scenarioId: scenario.id,
        definitionSha256: digest("d"),
        fixtureSha256: digest("e"),
        declaredTurnCount: scenario.prompts.length,
      });
      const turnRecordIds: string[] = [];
      for (const turn of scenario.prompts.keys()) {
        const ordinal = turn + 1;
        const attempt = await createLiveMatrixAttemptRecord({
          evidenceRoot,
          generationId,
          scenarioId: scenario.id,
          turn: ordinal,
          attempt: 1,
          promptSha256: digest("1"),
          runtimeIdentitySha256: digest("2"),
        });
        const turnRecord = await createLiveMatrixTurnRecord({
          evidenceRoot,
          generationId,
          scenarioId: scenario.id,
          turn: ordinal,
          attemptRecordIds: [attempt.recordId],
          terminalAttemptRecordId: attempt.recordId,
          observationSha256: digest("3"),
          terminalBoundary: "turn.completed",
        });
        turnRecordIds.push(turnRecord.recordId);
      }
      const scenarioEvidence = await durablePayload(
        evidenceRoot,
        `payloads/scenario-results/${scenario.id}.json`,
        {
          schemaVersion: 1,
          evidenceClass: "local-rehearsal",
          generationId,
          scenarioId: scenario.id,
          package: matrixPackage,
          matrixDefinitionSha256,
          codex: {
            cliVersion: "codex-test",
            requestedModel: "gpt-5.6-luna",
            requestedReasoningEffort: "high",
          },
          coordinatorIdentity: "test-coordinator",
          startingStateSha256: digest("e"),
          durationMs: 1,
          attempts: [],
          ...(scenario.composition.fixtureProfile === "active-github-repository"
            ? {
                remoteIntegrity: {
                  repositoryIdentitySha256: digest("4"),
                  authorizedCandidateIssueCount: 0,
                  integritySha256: digest("5"),
                },
              }
            : {}),
          evaluation: {
            schemaVersion: 1,
            scenarioId: scenario.id,
            outcome: "pass",
            semanticEvaluationAuthority: "coordinating-agent",
            coordinatorIdentity: "test-coordinator",
            rationale: `Typed ${scenario.id} pass result.`,
            requiredOutcomeObservations: [
              {
                requirement: "The required outcome is observed.",
                observed: true,
                evidencePointers: ["observations/turn-01.json"],
              },
            ],
            forbiddenOutcomeObservations: [
              {
                requirement: "The forbidden outcome is absent.",
                observed: false,
                evidencePointers: ["observations/turn-01.json"],
              },
            ],
          },
        },
      );
      await createLiveMatrixScenarioResultRecord({
        evidenceRoot,
        generationId,
        scenarioId: scenario.id,
        outcome: "pass",
        evidence: scenarioEvidence,
        turnRecordIds,
      });
    }
    const gitleaks = await fakeGitleaks(join(base, "scanner"));
    const completed = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "complete-matrix",
        "--source-root",
        process.cwd(),
        "--registry",
        registryPath,
        "--results",
        resultsRoot,
        "--output",
        output,
        "--evidence-bundle-root",
        evidenceRoot,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${dirname(gitleaks)}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(completed.exitCode, completed.stderr.toString()).toBe(0);
    const canonicalOutput = join(await realpath(dirname(output)), basename(output));
    expect(JSON.parse(completed.stdout.toString())).toMatchObject({
      output: canonicalOutput,
      outcome: "pass",
      scenarios: registry.scenarios.length,
      generationTerminal: expect.stringMatching(/^sha256:/u),
    });
    expect(await readdir(evidenceRoot)).not.toContain(".live-matrix-private-control");
    expect(await readdir(liveMatrixPrivateControlRoot(evidenceRoot))).toContain(generationId);

    const inspected = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "inspect-evidence-bundle",
        "--evidence-bundle-root",
        evidenceRoot,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(inspected.exitCode, inspected.stderr.toString()).toBe(0);
    expect(JSON.parse(inspected.stdout.toString())).toMatchObject({
      generationId: generation.generationId,
      lifecycle: "completed",
      nextMissingRecord: "convergence-review",
    });
  });

  test("recovers Scenario Result, Matrix aggregation, and terminal records without rebuilding semantic bytes", async () => {
    const base = await mkdtemp(join(tmpdir(), "bearing-matrix-completion-recovery-"));
    const root = join(base, "evidence");
    const control = join(base, "private-control");
    const program = await fakeGitleaks(join(base, "scanner"));
    const generation = await createLiveMatrixGenerationRecord({
      evidenceRoot: root,
      generationId: "66666666-6666-4666-8666-666666666666",
      scenarioIds: ["ENTRY-01"],
      packageIdentitySha256: boundedPackageIdentitySha256,
      matrixDefinitionSha256: digest("2"),
      harnessIdentitySha256: digest("3"),
      admissionIdentitySha256: digest("4"),
    });
    await createLiveMatrixScenarioRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioId: "ENTRY-01",
      definitionSha256: digest("5"),
      fixtureSha256: digest("6"),
      declaredTurnCount: 1,
    });
    const attempt = await createLiveMatrixAttemptRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioId: "ENTRY-01",
      turn: 1,
      attempt: 1,
      promptSha256: digest("7"),
      runtimeIdentitySha256: digest("8"),
    });
    expect((await inspectLiveMatrixEvidenceRecords(root)).nextMissingRecord).toBe(
      "turn:ENTRY-01:1",
    );
    const turn = await createLiveMatrixTurnRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioId: "ENTRY-01",
      turn: 1,
      attemptRecordIds: [attempt.recordId],
      terminalAttemptRecordId: attempt.recordId,
      observationSha256: digest("9"),
      terminalBoundary: "turn.completed",
    });
    const scenarioValue = fullScenarioPayload(
      generation.generationId,
      "ENTRY-01",
      "fail",
      digest("6"),
    );
    const stagedScenario = await stageLiveMatrixDurableEvidence({
      controlRoot: control,
      evidenceRoot: root,
      publicationId: "scenario-result",
      pointer: "payloads/scenario-result.json",
      value: scenarioValue,
      cleanupScopes: [],
      completion: {
        kind: "scenario-result",
        generationId: generation.generationId,
        scenarioId: "ENTRY-01",
        outcome: "fail",
        turnRecordIds: [turn.recordId],
      },
    });
    await expect(
      recoverLiveMatrixEvidencePublication({
        controlRoot: control,
        evidenceRoot: root,
        publicationId: "scenario-result",
        configPath: join(process.cwd(), ".gitleaks.toml"),
        program,
        crashAfter: "scenario-result",
      }),
    ).rejects.toThrow("Injected crash after Scenario Result");
    const scenarioRecovery = await recoverLiveMatrixEvidencePublication({
      controlRoot: control,
      evidenceRoot: root,
      publicationId: "scenario-result",
      configPath: join(process.cwd(), ".gitleaks.toml"),
      program,
    });
    expect(scenarioRecovery.scenarioResultRecordId).toMatch(/^sha256:/u);

    const matrixValue = fullMatrixPayload(generation.generationId, [
      {
        scenarioId: "ENTRY-01",
        outcome: "fail",
        startingStateSha256: digest("6"),
        evidence: {
          pointer: "payloads/scenario-result.json",
          sha256: stagedScenario.stagedSha256,
        },
      },
    ]);
    await stageLiveMatrixDurableEvidence({
      controlRoot: control,
      evidenceRoot: root,
      publicationId: "matrix-result",
      pointer: "payloads/matrix-result.json",
      value: matrixValue,
      cleanupScopes: [],
      completion: {
        kind: "matrix-result-terminal",
        generationId: generation.generationId,
        scenarioResultRecordIds: [scenarioRecovery.scenarioResultRecordId as string],
      },
    });
    await expect(
      recoverLiveMatrixEvidencePublication({
        controlRoot: control,
        evidenceRoot: root,
        publicationId: "matrix-result",
        configPath: join(process.cwd(), ".gitleaks.toml"),
        program,
        crashAfter: "matrix-result",
      }),
    ).rejects.toThrow("Injected crash after Matrix Result");
    await expect(
      recoverLiveMatrixEvidencePublication({
        controlRoot: control,
        evidenceRoot: root,
        publicationId: "matrix-result",
        configPath: join(process.cwd(), ".gitleaks.toml"),
        program,
        crashAfter: "terminal",
      }),
    ).rejects.toThrow("Injected crash after Generation Terminal");
    const matrixRecovery = await recoverLiveMatrixEvidencePublication({
      controlRoot: control,
      evidenceRoot: root,
      publicationId: "matrix-result",
      configPath: join(process.cwd(), ".gitleaks.toml"),
      program,
    });
    expect(matrixRecovery.matrixResultRecordId).toMatch(/^sha256:/u);
    expect(matrixRecovery.terminalRecordId).toMatch(/^sha256:/u);
    await expect(inspectLiveMatrixEvidenceRecords(root)).resolves.toMatchObject({
      lifecycle: "completed",
      nextMissingRecord: "convergence-review",
    });
  });

  test("closes multiple registered Scenarios through Coordinator review, Matrix aggregation, and terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-matrix-ledger-"));
    const generation = await createLiveMatrixGenerationRecord({
      evidenceRoot: root,
      generationId: "22222222-2222-4222-8222-222222222222",
      scenarioIds: ["ENTRY-01", "CONFIG-01"],
      packageIdentitySha256: boundedPackageIdentitySha256,
      matrixDefinitionSha256: digest("2"),
      harnessIdentitySha256: digest("3"),
      admissionIdentitySha256: digest("4"),
    });
    const scenarioRecords = await Promise.all(
      ["ENTRY-01", "CONFIG-01"].map((scenarioId, index) =>
        createLiveMatrixScenarioRecord({
          evidenceRoot: root,
          generationId: generation.generationId,
          scenarioId,
          definitionSha256: digest(index === 0 ? "5" : "6"),
          fixtureSha256: digest(index === 0 ? "7" : "8"),
          declaredTurnCount: 1,
        }),
      ),
    );
    const resultRecords = [];
    for (const [index, scenario] of scenarioRecords.entries()) {
      const attempt = await createLiveMatrixAttemptRecord({
        evidenceRoot: root,
        generationId: generation.generationId,
        scenarioId: scenario.scenarioId,
        turn: 1,
        attempt: 1,
        promptSha256: digest("9"),
        runtimeIdentitySha256: digest(index === 0 ? "a" : "b"),
      });
      const turn = await createLiveMatrixTurnRecord({
        evidenceRoot: root,
        generationId: generation.generationId,
        scenarioId: scenario.scenarioId,
        turn: 1,
        attemptRecordIds: [attempt.recordId],
        terminalAttemptRecordId: attempt.recordId,
        observationSha256: digest(index === 0 ? "c" : "d"),
        terminalBoundary: "turn.completed",
      });
      resultRecords.push(
        await createLiveMatrixScenarioResultRecord({
          evidenceRoot: root,
          generationId: generation.generationId,
          scenarioId: scenario.scenarioId,
          outcome: index === 0 ? "pass" : "fail",
          evidence: await durablePayload(
            root,
            `payloads/scenario-${scenario.scenarioId}.json`,
            fullScenarioPayload(
              generation.generationId,
              scenario.scenarioId,
              index === 0 ? "pass" : "fail",
              scenario.fixtureSha256,
            ),
          ),
          turnRecordIds: [turn.recordId],
        }),
      );
    }
    const matrix = await createLiveMatrixMatrixResultRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioResultRecordIds: resultRecords.map(({ recordId }) => recordId),
      evidence: await durablePayload(
        root,
        "payloads/matrix-result.json",
        fullMatrixPayload(
          generation.generationId,
          resultRecords.map(({ scenarioId, outcome, evidence }) => ({
            scenarioId,
            outcome,
            startingStateSha256:
              scenarioRecords.find((scenario) => scenario.scenarioId === scenarioId)
                ?.fixtureSha256 ?? digest("0"),
            evidence,
          })),
        ),
      ),
    });
    const terminal = await createLiveMatrixTerminalRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      matrixResultRecordId: matrix.recordId,
      disposition: "completed",
    });
    expect(
      (
        await createLiveMatrixMatrixResultRecord({
          evidenceRoot: root,
          generationId: generation.generationId,
          scenarioResultRecordIds: resultRecords.map(({ recordId }) => recordId),
          evidence: matrix.evidence,
        })
      ).recordId,
    ).toBe(matrix.recordId);
    expect(
      (
        await createLiveMatrixTerminalRecord({
          evidenceRoot: root,
          generationId: generation.generationId,
          matrixResultRecordId: matrix.recordId,
          disposition: "completed",
        })
      ).recordId,
    ).toBe(terminal.recordId);
    const convergence = await createLiveMatrixConvergenceReviewRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      terminalRecordId: terminal.recordId,
      scenarioResultRecordIds: resultRecords.map(({ recordId }) => recordId),
      evidence: await durablePayload(root, "payloads/convergence-review.json", {
        generationId: generation.generationId,
        terminalRecordId: terminal.recordId,
        scenarioResultRecordIds: resultRecords.map(({ recordId }) => recordId),
      }),
    });
    const inspected = await inspectLiveMatrixEvidenceRecords(root);
    expect(inspected).toMatchObject({
      lifecycle: "completed",
      nextMissingRecord: "fresh-generation-required",
      records: {
        generation: { writer: "coordinator", ordinal: 1 },
        scenarios: [
          { scenarioId: "ENTRY-01", writer: "scenario-runner:ENTRY-01", ordinal: 1 },
          { scenarioId: "CONFIG-01", writer: "scenario-runner:CONFIG-01", ordinal: 2 },
        ],
        scenarioResults: [
          { scenarioId: "ENTRY-01", writer: "coordinator", ordinal: 1 },
          { scenarioId: "CONFIG-01", writer: "coordinator", ordinal: 2 },
        ],
        convergenceReview: { recordId: convergence.recordId },
        matrixResult: { recordId: matrix.recordId },
        terminal: { recordId: terminal.recordId },
      },
    });

    const reviewPayloadPath = join(root, convergence.evidence.pointer);
    const reviewPayloadBytes = await readFile(reviewPayloadPath);
    await rm(reviewPayloadPath);
    await expect(inspectLiveMatrixEvidenceRecords(root)).rejects.toThrow(
      "Durable evidence pointer is missing",
    );
    await writeFile(reviewPayloadPath, reviewPayloadBytes);

    const matrixPayloadPath = join(root, matrix.evidence.pointer);
    const matrixPayloadBytes = await readFile(matrixPayloadPath);
    await writeFile(matrixPayloadPath, "corrupt\n");
    await expect(inspectLiveMatrixEvidenceRecords(root)).rejects.toThrow(
      "Durable evidence pointer digest mismatch",
    );
    await writeFile(matrixPayloadPath, matrixPayloadBytes);

    const scenarioPayloadPath = join(root, resultRecords[0]?.evidence.pointer ?? "missing");
    const scenarioPayloadBytes = await readFile(scenarioPayloadPath);
    const externalPayload = join(
      await mkdtemp(join(tmpdir(), "bearing-external-payload-")),
      "result.json",
    );
    await writeFile(externalPayload, scenarioPayloadBytes);
    await rm(scenarioPayloadPath);
    await symlink(externalPayload, scenarioPayloadPath);
    await expect(inspectLiveMatrixEvidenceRecords(root)).rejects.toThrow(
      "Durable evidence pointer escapes its bundle",
    );
  });

  test("derives the first exact missing record and never repairs corrupt or impossible history", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-matrix-ledger-corrupt-"));
    const generation = await createLiveMatrixGenerationRecord({
      evidenceRoot: root,
      generationId: "33333333-3333-4333-8333-333333333333",
      scenarioIds: ["ENTRY-01", "CONFIG-01"],
      packageIdentitySha256: digest("1"),
      matrixDefinitionSha256: digest("2"),
      harnessIdentitySha256: digest("3"),
      admissionIdentitySha256: digest("4"),
    });
    expect((await inspectLiveMatrixEvidenceRecords(root)).nextMissingRecord).toBe(
      "scenario:ENTRY-01",
    );
    await createLiveMatrixScenarioRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioId: "CONFIG-01",
      definitionSha256: digest("5"),
      fixtureSha256: digest("6"),
      declaredTurnCount: 1,
    });
    expect((await inspectLiveMatrixEvidenceRecords(root)).nextMissingRecord).toBe(
      "scenario:ENTRY-01",
    );
    const attempt = await createLiveMatrixAttemptRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioId: "CONFIG-01",
      turn: 1,
      attempt: 1,
      promptSha256: digest("7"),
      runtimeIdentitySha256: digest("8"),
    });
    await createLiveMatrixTurnRecord({
      evidenceRoot: root,
      generationId: generation.generationId,
      scenarioId: "CONFIG-01",
      turn: 1,
      attemptRecordIds: [attempt.recordId],
      terminalAttemptRecordId: attempt.recordId,
      observationSha256: digest("9"),
      terminalBoundary: "turn.completed",
    });
    const attemptPath = join(root, "scenarios/CONFIG-01/attempts/01-01.json");
    const mismatchedAttemptPath = join(root, "scenarios/CONFIG-01/attempts/02-01.json");
    await copyFile(attemptPath, mismatchedAttemptPath);
    await rm(attemptPath);
    await expect(inspectLiveMatrixEvidenceRecords(root)).rejects.toThrow(
      "Attempt filename contradicts",
    );
    await copyFile(mismatchedAttemptPath, attemptPath);
    await rm(mismatchedAttemptPath);
    const turnPath = join(root, "scenarios/CONFIG-01/turns/01.json");
    const mismatchedTurnPath = join(root, "scenarios/CONFIG-01/turns/02.json");
    await copyFile(turnPath, mismatchedTurnPath);
    await rm(turnPath);
    await expect(inspectLiveMatrixEvidenceRecords(root)).rejects.toThrow(
      "Turn filename contradicts",
    );
    await copyFile(mismatchedTurnPath, turnPath);
    await rm(mismatchedTurnPath);
    await mkdir(join(root, "scenarios/UNKNOWN-99"), { recursive: true });
    await writeFile(join(root, "scenarios/UNKNOWN-99/scenario.json"), "{}\n");
    await expect(inspectLiveMatrixEvidenceRecords(root)).rejects.toThrow(
      "unexpected Scenario namespace",
    );
    await expect(access(join(root, "generation.json"))).resolves.toBeNull();
    await expect(access(join(root, "scenarios/UNKNOWN-99/scenario.json"))).resolves.toBeNull();
  });

  test("fresh Generation records only predecessor identity and reason", async () => {
    const predecessorRoot = await mkdtemp(join(tmpdir(), "bearing-matrix-predecessor-"));
    const predecessor = await createLiveMatrixGenerationRecord({
      evidenceRoot: predecessorRoot,
      generationId: "44444444-4444-4444-8444-444444444444",
      scenarioIds: ["ENTRY-01"],
      packageIdentitySha256: digest("1"),
      matrixDefinitionSha256: digest("2"),
      harnessIdentitySha256: digest("3"),
      admissionIdentitySha256: digest("4"),
    });
    const freshRoot = await mkdtemp(join(tmpdir(), "bearing-matrix-successor-"));
    const fresh = await createLiveMatrixGenerationRecord({
      evidenceRoot: freshRoot,
      generationId: "55555555-5555-4555-8555-555555555555",
      scenarioIds: ["ENTRY-01"],
      packageIdentitySha256: digest("5"),
      matrixDefinitionSha256: digest("6"),
      harnessIdentitySha256: digest("7"),
      admissionIdentitySha256: digest("8"),
      predecessor: {
        generationId: predecessor.generationId,
        generationRecordId: predecessor.recordId,
        reason: "Accepted owner repair requires a fresh package identity.",
      },
    });
    expect(fresh.predecessor).toEqual({
      generationId: predecessor.generationId,
      generationRecordId: predecessor.recordId,
      reason: "Accepted owner repair requires a fresh package identity.",
    });
    expect(Object.keys(fresh.predecessor ?? {}).sort()).toEqual([
      "generationId",
      "generationRecordId",
      "reason",
    ]);
  });
});
