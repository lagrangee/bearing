import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveMatrixGenerationBasis } from "../scripts/live-matrix-generation";
import {
  createLiveMatrixResult,
  createLiveMatrixScenarioTerminalResult,
  parseLiveMatrixResultForScenarioIds,
  parseLiveMatrixScenarioTerminalResult,
  verifyLiveMatrixResult,
} from "../scripts/live-matrix-results";
import {
  liveScenarioDefinitionDigest,
  liveScenarioHarnessIdentitySha256,
} from "../scripts/live-scenario-runner";

const generationId = "11111111-1111-4111-8111-111111111111";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createBasis = (scenarioIds: readonly string[]) =>
  createLiveMatrixGenerationBasis({
    generationId,
    staticPreflight: "complete",
    package: { evidenceClass: "local-rehearsal", identitySha256: digest("package") },
    registryDefinitionSha256: digest("registry"),
    fixtureDefinitionSha256: digest("fixtures"),
    harnessIdentitySha256: digest("harness"),
    startedAt: "2026-09-01T00:00:00.000Z",
    selectedScenarioIds: [...scenarioIds],
    preparedScenarios: scenarioIds.map((scenarioId) => ({
      generationId,
      scenarioId,
      fixtureSha256: digest(`fixture:${scenarioId}`),
      skillsSha256: digest(`skills:${scenarioId}`),
      permissionOutcome: "passed" as const,
    })),
  });

const createScenario = (scenarioId: string, outcome: "pass" | "fail" | "blocked") =>
  createLiveMatrixScenarioTerminalResult({
    generationId,
    scenarioId,
    outcome,
    ...(outcome === "pass"
      ? {}
      : { failureCategory: outcome === "blocked" ? "test-system" : "contract" }),
    rationale: `${scenarioId} received a coordinator semantic verdict.`,
    conversation: {
      pointer: `scenarios/${scenarioId}/conversation.md`,
      sha256: digest("conversation"),
    },
    rawEvents: [
      { pointer: `scenarios/${scenarioId}/events/turn-01.jsonl`, sha256: digest("events") },
    ],
    terminalEvidence: [
      { pointer: `scenarios/${scenarioId}/terminal/observation.json`, sha256: digest("terminal") },
    ],
    turns: [
      {
        turnNumber: 1,
        startedAt: "2026-09-01T00:00:01.000Z",
        endedAt: "2026-09-01T00:00:02.000Z",
      },
    ],
    startedAt: "2026-09-01T00:00:01.000Z",
    endedAt: "2026-09-01T00:00:02.000Z",
  });

describe("adaptive Live Matrix results", () => {
  test("keeps semantic verdict authority with the coordinator and preserves three evidence classes", () => {
    const result = createScenario("ordinary-work-restraint", "pass");
    expect(result).toMatchObject({
      schemaVersion: 3,
      semanticEvaluationAuthority: "coordinator",
      outcome: "pass",
    });
    expect(result).not.toHaveProperty("failureCategory");
    expect(result.conversation.pointer).toEndWith("conversation.md");
    expect(result.rawEvents).toHaveLength(1);
    expect(result.terminalEvidence).toHaveLength(1);
    expect(result).not.toHaveProperty("requiredOutcomes");
    expect(result).not.toHaveProperty("releasePrerequisiteSatisfied");
  });

  test("summarizes pass, fail, and blocked without deriving release authority", () => {
    const ids = ["ordinary-work-restraint", "project-orientation", "local-delivery-writeback"];
    const basis = createBasis(ids);
    const results = [
      createScenario(ids[0] as string, "pass"),
      createScenario(ids[1] as string, "fail"),
      createScenario(ids[2] as string, "blocked"),
    ];
    const matrix = createLiveMatrixResult({
      generationBasis: basis,
      generationBasisReference: { pointer: "generation.json", sha256: digest("generation") },
      selectedScenarioIds: ids,
      scenarioResults: results.map((result) => ({
        result,
        reference: {
          pointer: `scenarios/${result.scenarioId}/result.json`,
          sha256: digest(result.scenarioId),
        },
      })),
      peakConcurrency: 3,
      endedAt: "2026-09-01T00:01:00.000Z",
    });
    expect(matrix.report).toMatchObject({ passCount: 1, failCount: 1, blockedCount: 1 });
    expect(matrix.report.failureAttributions).toEqual([
      { scenarioId: "project-orientation", category: "contract" },
      { scenarioId: "local-delivery-writeback", category: "test-system" },
    ]);
    expect(matrix).not.toHaveProperty("terminalOutcome");
    expect(matrix).not.toHaveProperty("releasePrerequisiteSatisfied");
  });

  test("requires one of five coordinator failure categories only for non-passing results", () => {
    const failed = createScenario("project-orientation", "fail");
    expect(failed.failureCategory).toBe("contract");
    const { failureCategory: _failureCategory, ...missingCategory } = failed;
    expect(() => parseLiveMatrixScenarioTerminalResult(missingCategory)).toThrow();
    expect(() =>
      parseLiveMatrixScenarioTerminalResult({
        ...createScenario("ordinary-work-restraint", "pass"),
        failureCategory: "agent-adherence",
      }),
    ).toThrow();
    expect(() =>
      parseLiveMatrixScenarioTerminalResult({
        ...failed,
        failureCategory: "unknown",
      }),
    ).toThrow();
  });

  test("rejects missing, duplicate, or reordered scenario summaries", () => {
    const ids = ["ordinary-work-restraint", "project-orientation"];
    const basis = createBasis(ids);
    const matrix = createLiveMatrixResult({
      generationBasis: basis,
      generationBasisReference: { pointer: "generation.json", sha256: digest("generation") },
      selectedScenarioIds: ids,
      scenarioResults: ids.map((id) => ({
        result: createScenario(id, "pass"),
        reference: { pointer: `scenarios/${id}/result.json`, sha256: digest(id) },
      })),
      peakConcurrency: 1,
      endedAt: "2026-09-01T00:01:00.000Z",
    });
    expect(() =>
      parseLiveMatrixResultForScenarioIds(
        { ...matrix, scenarios: [...matrix.scenarios].reverse() },
        ids,
      ),
    ).toThrow("registry order");
  });

  test("verifies all durable references and their digests", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-adaptive-result-"));
    roots.push(root);
    const scenarioId = "ordinary-work-restraint";
    const basis = createBasis([scenarioId]);
    const generationBytes = `${JSON.stringify(basis, null, 2)}\n`;
    await writeFile(join(root, "generation.json"), generationBytes);
    const scenarioRoot = join(root, "scenarios", scenarioId);
    await mkdir(join(scenarioRoot, "events"), { recursive: true });
    await mkdir(join(scenarioRoot, "terminal"), { recursive: true });
    const evidence = [
      ["conversation.md", "conversation\n"],
      ["events/turn-01.jsonl", '{"type":"turn.completed"}\n'],
      ["terminal/observation.json", '{"schemaVersion":1}\n'],
    ] as const;
    await Promise.all(
      evidence.map(([pointer, bytes]) => writeFile(join(scenarioRoot, pointer), bytes)),
    );
    const result = createLiveMatrixScenarioTerminalResult({
      ...createScenario(scenarioId, "pass"),
      conversation: {
        pointer: `scenarios/${scenarioId}/conversation.md`,
        sha256: digest("conversation\n"),
      },
      rawEvents: [
        {
          pointer: `scenarios/${scenarioId}/events/turn-01.jsonl`,
          sha256: digest('{"type":"turn.completed"}\n'),
        },
      ],
      terminalEvidence: [
        {
          pointer: `scenarios/${scenarioId}/terminal/observation.json`,
          sha256: digest('{"schemaVersion":1}\n'),
        },
      ],
    });
    const resultBytes = `${JSON.stringify(result, null, 2)}\n`;
    await writeFile(join(scenarioRoot, "result.json"), resultBytes);
    const matrix = createLiveMatrixResult({
      generationBasis: basis,
      generationBasisReference: { pointer: "generation.json", sha256: digest(generationBytes) },
      selectedScenarioIds: [scenarioId],
      scenarioResults: [
        {
          result,
          reference: {
            pointer: `scenarios/${scenarioId}/result.json`,
            sha256: digest(resultBytes),
          },
        },
      ],
      peakConcurrency: 1,
      endedAt: "2026-09-01T00:01:00.000Z",
    });
    const matrixPath = join(root, "matrix-result.json");
    await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
    await expect(verifyLiveMatrixResult(matrixPath, [scenarioId])).resolves.toMatchObject({
      matrix,
    });
  });

  test("complete-matrix summarizes exactly the selected Generation scenarios", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-focused-result-"));
    roots.push(root);
    const sourceRoot = join(import.meta.dir, "..");
    const scenarioId = "ordinary-work-restraint";
    const generationRoot = join(root, "generation");
    const scenarioRoot = join(generationRoot, "scenarios", scenarioId);
    await mkdir(join(scenarioRoot, "events"), { recursive: true });
    await mkdir(join(scenarioRoot, "terminal"), { recursive: true });

    const conversation = "# Conversation\n";
    const events = '{"type":"turn.completed"}\n';
    const terminal = '{"schemaVersion":1}\n';
    await Promise.all([
      writeFile(join(scenarioRoot, "conversation.md"), conversation),
      writeFile(join(scenarioRoot, "events/turn-01.jsonl"), events),
      writeFile(join(scenarioRoot, "terminal/observation.json"), terminal),
    ]);

    const basis = createLiveMatrixGenerationBasis({
      generationId,
      staticPreflight: "complete",
      package: { evidenceClass: "local-rehearsal", identitySha256: digest("package") },
      registryDefinitionSha256: await liveScenarioDefinitionDigest({
        sourceRoot,
        registryPath: "validation/live-journey/registry.json",
      }),
      fixtureDefinitionSha256: digest("fixtures"),
      harnessIdentitySha256: await liveScenarioHarnessIdentitySha256({ sourceRoot }),
      startedAt: "2026-09-01T00:00:00.000Z",
      selectedScenarioIds: [scenarioId],
      preparedScenarios: [
        {
          generationId,
          scenarioId,
          fixtureSha256: digest(`fixture:${scenarioId}`),
          skillsSha256: digest(`skills:${scenarioId}`),
          permissionOutcome: "passed",
        },
      ],
    });
    await writeFile(join(generationRoot, "generation.json"), `${JSON.stringify(basis)}\n`);

    const result = createLiveMatrixScenarioTerminalResult({
      ...createScenario(scenarioId, "pass"),
      conversation: {
        pointer: `generation/scenarios/${scenarioId}/conversation.md`,
        sha256: digest(conversation),
      },
      rawEvents: [
        {
          pointer: `generation/scenarios/${scenarioId}/events/turn-01.jsonl`,
          sha256: digest(events),
        },
      ],
      terminalEvidence: [
        {
          pointer: `generation/scenarios/${scenarioId}/terminal/observation.json`,
          sha256: digest(terminal),
        },
      ],
    });
    await writeFile(join(scenarioRoot, "result.json"), `${JSON.stringify(result)}\n`);

    const output = join(root, "matrix-result.json");
    const completed = Bun.spawnSync(
      [
        "bun",
        "scripts/run-live-journey.ts",
        "complete-matrix",
        "--source-root",
        sourceRoot,
        "--registry",
        join(sourceRoot, "validation/live-journey/registry.json"),
        "--generation",
        join(generationRoot, "generation.json"),
        "--output",
        output,
      ],
      { cwd: sourceRoot, stdout: "pipe", stderr: "pipe" },
    );
    expect(completed.exitCode, completed.stderr.toString()).toBe(0);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      scenarios: [{ scenarioId }],
      report: { scenarioCount: 1, passCount: 1 },
    });
  });
});
