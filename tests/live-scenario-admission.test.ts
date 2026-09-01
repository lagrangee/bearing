import { describe, expect, test } from "bun:test";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  finalizeAdaptiveScenario,
  resumeAdaptiveScenario,
  startAdaptiveScenario,
} from "../scripts/adaptive-live-matrix";
import {
  discardLiveScenarioGenerationAdmission,
  prepareLiveScenarioGenerationAdmission,
} from "../scripts/live-scenario-admission";
import {
  digestLiveScenarioFixtureSet,
  loadLiveScenarioRegistry,
} from "../scripts/live-scenario-registry";
import {
  liveScenarioDefinitionDigest,
  verifyLiveScenarioBehaviorBoundary,
  verifyLiveScenarioGeneration,
} from "../scripts/live-scenario-runner";
import { localRehearsalWorktreeDigest } from "../scripts/local-rehearsal-identity";
import { sha256File } from "../scripts/release-digest";

const registryPath = "tests/fixtures/live-scenario-admission-registry.json";
const prerequisiteRegistryPath =
  "tests/fixtures/live-scenario-admission-prerequisite-registry.json";
const concurrencyRegistryPath = "tests/fixtures/live-scenario-admission-concurrency-registry.json";
const generationId = "11111111-1111-4111-8111-111111111111";

const createFixture = async (
  mode: "admitted" | "model-unavailable" | "permission-failure" = "admitted",
  selectedRegistryPath = registryPath,
  temporaryRoot = tmpdir(),
) => {
  const root = await realpath(await mkdtemp(join(temporaryRoot, "bearing-admission-test-")));
  const packageRoot = join(root, "package-root");
  const tarball = join(root, "bearing.tgz");
  const operatorCodexHome = join(root, "operator-codex-home");
  const workspaceRoot = join(root, "generation-workspace");
  const fakeCodex = join(root, "codex-fixture");
  const permissionProbeCapture = join(root, "permission-probe-arguments.txt");
  await Promise.all([
    mkdir(join(packageRoot, "package/docs"), { recursive: true }),
    mkdir(join(packageRoot, "package/bin"), { recursive: true }),
    mkdir(operatorCodexHome),
  ]);
  const fakeBearing = join(packageRoot, "package/bin/bearing.mjs");
  await Promise.all([
    writeFile(join(packageRoot, "package/docs/agent-installation.md"), "# Install\n"),
    writeFile(
      join(packageRoot, "package/package.json"),
      '{"name":"@lagrangee/bearing","version":"0.1.2-dev","bin":{"bearing":"bin/bearing.mjs"}}\n',
    ),
    writeFile(
      fakeBearing,
      `#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
if (process.argv[2] !== "install") process.exit(64);
const skillRoot = join(process.env.HOME, ".bearing/kit/current/skills/bearing");
await mkdir(skillRoot, { recursive: true });
await writeFile(join(skillRoot, "SKILL.md"), "# Fixture Bearing Skill\\n");
`,
    ),
    writeFile(join(operatorCodexHome, "auth.json"), "{}\n"),
    writeFile(
      fakeCodex,
      `#!/bin/sh
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  ${
    mode === "model-unavailable"
      ? `printf '%s\\n' '{"models":[]}'`
      : `printf '%s\\n' '{"models":[{"slug":"gpt-5.6-luna","supported_reasoning_levels":[{"effort":"high"}]}]}'`
  }
  exit 0
fi
if [ "$1" = "sandbox" ]; then
  printf '%s\\n' "$@" >> ${JSON.stringify(permissionProbeCapture)}
  ${mode === "permission-failure" ? "exit 17" : "exit 0"}
fi
exit 64
`,
    ),
  ]);
  await Promise.all([chmod(fakeCodex, 0o755), chmod(fakeBearing, 0o755)]);
  const packed = Bun.spawnSync(["tar", "-czf", tarball, "package"], {
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
  return {
    root,
    workspaceRoot,
    operatorCodexHome,
    fakeCodex,
    permissionProbeCapture,
    package: {
      evidenceClass: "local-rehearsal" as const,
      packageName: "@lagrangee/bearing" as const,
      packageVersion: "0.1.2-dev",
      sourceHead: "fixture-head",
      worktreeSha256: await localRehearsalWorktreeDigest(process.cwd()),
      artifact: {
        path: tarball,
        file: "bearing.tgz",
        sha256: await sha256File(tarball),
      },
      matrixDefinitionSha256: await liveScenarioDefinitionDigest({
        sourceRoot: process.cwd(),
        registryPath: selectedRegistryPath,
      }),
    },
  };
};

const prepare = async (
  mode: Parameters<typeof createFixture>[0] = "admitted",
  selectedRegistryPath = registryPath,
) => {
  const fixture = await createFixture(mode, selectedRegistryPath);
  const result = await prepareLiveScenarioGenerationAdmission({
    sourceRoot: process.cwd(),
    workspaceRoot: fixture.workspaceRoot,
    operatorCodexHome: fixture.operatorCodexHome,
    registryPath: selectedRegistryPath,
    generationId,
    package: fixture.package,
    codexProgram: fixture.fakeCodex,
  });
  return { fixture, result } as const;
};

describe("Live Matrix Generation preflight", () => {
  test("accepts the real Node TMPDIR and returns the sole Generation basis", async () => {
    const { fixture, result } = await prepare();
    expect(result).toMatchObject({
      outcome: "admitted",
      generationId,
      generationBasis: {
        schemaVersion: 1,
        generationId,
        staticPreflight: "complete",
        runtime: {
          model: "gpt-5.6-luna",
          reasoningEffort: "high",
          fastMode: true,
          concurrency: 4,
        },
        selectedScenarioIds: ["test-one", "test-two"],
      },
      agentBehaviorStarted: false,
      activeGenerationCreated: false,
      externalEffectsObserved: false,
    });
    if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
    expect(await realpath(fixture.workspaceRoot)).toStartWith(`${await realpath(tmpdir())}/`);
    expect(result.generationBasis.fixtureDefinitionSha256).toBe(
      await digestLiveScenarioFixtureSet({
        sourceRoot: process.cwd(),
        registry: await loadLiveScenarioRegistry(registryPath),
        scenarioIds: ["test-one", "test-two"],
      }),
    );
    expect(result.preparedScenarios).toHaveLength(2);
    expect(result.generationBasis.preparedScenarios).toHaveLength(2);
    const probedProfiles = (await readFile(fixture.permissionProbeCapture, "utf8"))
      .split("\n")
      .filter((argument) => argument.startsWith("permissions.bearing_live_journey="));
    const launchedProfiles = result.preparedScenarios
      .map(({ launch }) =>
        launch.initial.arguments.find((argument) =>
          argument.startsWith("permissions.bearing_live_journey="),
        ),
      )
      .filter((profile): profile is string => profile !== undefined);
    expect(launchedProfiles).toHaveLength(result.preparedScenarios.length);
    expect(probedProfiles).toEqual(launchedProfiles);
    for (const prepared of result.preparedScenarios) {
      const manifest = JSON.parse(await readFile(prepared.paths.manifest, "utf8"));
      expect(manifest).not.toHaveProperty("admission");
      expect(manifest.paths).not.toHaveProperty("boundedNpmControlRoot");
      await expect(verifyLiveScenarioGeneration(prepared.paths.manifest)).resolves.toBeDefined();
    }
    await discardLiveScenarioGenerationAdmission(result);
  });

  test("runs one adaptive conversation through start, resume, and coordinator finalization", async () => {
    const fixture = await createFixture();
    const aliasRoot = `${fixture.root}-alias`;
    await symlink(fixture.root, aliasRoot);
    let result: Awaited<ReturnType<typeof prepareLiveScenarioGenerationAdmission>> | undefined;
    try {
      result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: join(aliasRoot, "generation-workspace"),
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath,
        scenarioIds: ["test-one"],
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      const generationPath = join(result.workspaceRoot, "generation.json");
      await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
        flag: "wx",
      });
      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"item.completed","item":{"id":"plan","type":"command_execution","command":"bearing configure apply --plan-token sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}}'
printf '%s\\n' '{"type":"item.completed","item":{"id":"done","type":"agent_message","text":"Adaptive reply"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );
      const replyPath = join(fixture.root, "reply.txt");
      const verdictPath = join(fixture.root, "verdict.json");
      await Promise.all([
        writeFile(replyPath, "继续，只处理当前范围。\n"),
        writeFile(
          verdictPath,
          '{"outcome":"pass","rationale":"Observed the bounded adaptive conversation."}\n',
        ),
      ]);

      const started = await startAdaptiveScenario({
        generationPath,
        scenarioId: "test-one",
      });
      const resumed = await resumeAdaptiveScenario({
        generationPath,
        scenarioId: "test-one",
        replyPath,
      });
      const preparedRepository = result.preparedScenarios[0]?.paths.repository;
      if (preparedRepository === undefined) throw new Error("Expected prepared repository.");
      await writeFile(join(preparedRepository, "README.md"), "x".repeat(400_000));
      const finalized = await finalizeAdaptiveScenario({
        generationPath,
        scenarioId: "test-one",
        verdictPath,
      });

      expect(started).toMatchObject({ scenarioId: "test-one", turn: 1 });
      expect(resumed).toMatchObject({ scenarioId: "test-one", turn: 2 });
      expect(finalized).toMatchObject({ scenarioId: "test-one", outcome: "pass" });
      const scenarioResult = JSON.parse(
        await readFile(join(result.workspaceRoot, "scenarios/test-one/result.json"), "utf8"),
      );
      expect(scenarioResult).toMatchObject({
        semanticEvaluationAuthority: "coordinator",
        outcome: "pass",
        turns: [{ turnNumber: 1 }, { turnNumber: 2 }],
      });
      expect(scenarioResult.rawEvents.map(({ pointer }: { pointer: string }) => pointer)).toEqual([
        expect.stringContaining("turn-01.jsonl"),
        expect.stringContaining("turn-02.jsonl"),
      ]);
      expect(
        scenarioResult.terminalEvidence.map(({ pointer }: { pointer: string }) => pointer),
      ).toEqual([
        expect.stringContaining("terminal/verdict.json"),
        expect.stringContaining("terminal/observation.json"),
      ]);
      const terminalObservation = JSON.parse(
        await readFile(
          join(result.workspaceRoot, "scenarios/test-one/terminal/observation.json"),
          "utf8",
        ),
      );
      expect(terminalObservation.git.headCommit).toContain("commit ");
      expect(terminalObservation.git.diff).toContain("[output truncated at 262144 bytes]");
      expect(Buffer.byteLength(terminalObservation.git.diff, "utf8")).toBeLessThan(263_000);
      const rawEvents = await readFile(
        join(result.workspaceRoot, "scenarios/test-one/events/turn-01.jsonl"),
        "utf8",
      );
      expect(rawEvents).toContain("--plan-token <sealed-plan-fingerprint-redacted>");
      expect(rawEvents).not.toContain(
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      );
      const conversation = await readFile(
        join(result.workspaceRoot, "scenarios/test-one/conversation.md"),
        "utf8",
      );
      expect(conversation).toContain("## Turn 1");
      expect(conversation).toContain("## Turn 2");
      expect(conversation).not.toContain("Human Position");
      expect(conversation).not.toContain("Bearing Intent");
    } finally {
      if (result?.outcome === "admitted") {
        await discardLiveScenarioGenerationAdmission(result);
      }
      await rm(aliasRoot, { force: true });
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("seals a secret-bearing Codex Turn as blocked without publishing the rejected bytes", async () => {
    const fixture = await createFixture();
    let result: Awaited<ReturnType<typeof prepareLiveScenarioGenerationAdmission>> | undefined;
    try {
      result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: fixture.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath,
        scenarioIds: ["test-one"],
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      const generationPath = join(result.workspaceRoot, "generation.json");
      await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
        flag: "wx",
      });
      const rejectedSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"item.completed","item":{"id":"secret","type":"agent_message","text":"sealedPlanToken: ${rejectedSecret}"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );
      const verdictPath = join(fixture.root, "blocked-verdict.json");
      await writeFile(
        verdictPath,
        '{"outcome":"blocked","rationale":"Durable evidence was rejected before publication."}\n',
      );

      await expect(
        startAdaptiveScenario({ generationPath, scenarioId: "test-one" }),
      ).resolves.toMatchObject({
        scenarioId: "test-one",
        turn: 1,
        evidenceOutcome: "rejected",
      });
      await expect(
        startAdaptiveScenario({ generationPath, scenarioId: "test-one" }),
      ).rejects.toThrow("start only once");
      await expect(
        finalizeAdaptiveScenario({ generationPath, scenarioId: "test-one", verdictPath }),
      ).resolves.toMatchObject({ scenarioId: "test-one", outcome: "blocked" });

      const scenarioRoot = join(result.workspaceRoot, "scenarios/test-one");
      const [events, conversation, scenarioResult] = await Promise.all([
        readFile(join(scenarioRoot, "events/turn-01.jsonl"), "utf8"),
        readFile(join(scenarioRoot, "conversation.md"), "utf8"),
        readFile(join(scenarioRoot, "result.json"), "utf8"),
      ]);
      expect(events).toContain("durable-evidence-rejected");
      expect(events).not.toContain(rejectedSecret);
      expect(conversation).not.toContain(rejectedSecret);
      expect(scenarioResult).not.toContain(rejectedSecret);
    } finally {
      if (result?.outcome === "admitted") await discardLiveScenarioGenerationAdmission(result);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects a secret-bearing Human reply before it enters durable conversation evidence", async () => {
    const fixture = await createFixture();
    let result: Awaited<ReturnType<typeof prepareLiveScenarioGenerationAdmission>> | undefined;
    try {
      result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: fixture.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath,
        scenarioIds: ["test-one"],
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      const generationPath = join(result.workspaceRoot, "generation.json");
      await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
        flag: "wx",
      });
      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"item.completed","item":{"id":"done","type":"agent_message","text":"Adaptive reply"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );
      await startAdaptiveScenario({ generationPath, scenarioId: "test-one" });
      const rejectedSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const replyPath = join(fixture.root, "secret-reply.txt");
      await writeFile(replyPath, `sealedPlanToken: ${rejectedSecret}\n`);

      await expect(
        resumeAdaptiveScenario({ generationPath, scenarioId: "test-one", replyPath }),
      ).rejects.toThrow("Gitleaks");
      const conversation = await readFile(
        join(result.workspaceRoot, "scenarios/test-one/conversation.md"),
        "utf8",
      );
      expect(conversation).not.toContain(rejectedSecret);
    } finally {
      if (result?.outcome === "admitted") await discardLiveScenarioGenerationAdmission(result);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("atomically reserves no more than four concurrent Scenario starts", async () => {
    const scenarioIds = ["test-one", "test-two", "test-three", "test-four", "test-five"];
    const fixture = await createFixture("admitted", concurrencyRegistryPath);
    let result: Awaited<ReturnType<typeof prepareLiveScenarioGenerationAdmission>> | undefined;
    try {
      result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: fixture.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath: concurrencyRegistryPath,
        scenarioIds,
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      if (result.outcome !== "admitted") {
        throw new Error(`Expected admitted Generation: ${JSON.stringify(result)}`);
      }
      const generationPath = join(result.workspaceRoot, "generation.json");
      await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
        flag: "wx",
      });
      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"item.completed","item":{"id":"done","type":"agent_message","text":"Adaptive reply"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );

      const starts = await Promise.allSettled(
        scenarioIds.map((scenarioId) => startAdaptiveScenario({ generationPath, scenarioId })),
      );
      expect(starts.filter(({ status }) => status === "fulfilled")).toHaveLength(4);
      expect(starts.filter(({ status }) => status === "rejected")).toHaveLength(1);
      const rejectedIndex = starts.findIndex(({ status }) => status === "rejected");
      const rejected = starts[rejectedIndex];
      expect(rejected?.status === "rejected" ? String(rejected.reason) : "").toContain(
        "at most four",
      );

      const completedIndex = starts.findIndex(({ status }) => status === "fulfilled");
      const verdictPath = join(fixture.root, "capacity-verdict.json");
      await writeFile(
        verdictPath,
        '{"outcome":"pass","rationale":"Observed one bounded terminal Scenario."}\n',
      );
      await finalizeAdaptiveScenario({
        generationPath,
        scenarioId: scenarioIds[completedIndex] ?? "",
        verdictPath,
      });
      await expect(
        startAdaptiveScenario({
          generationPath,
          scenarioId: scenarioIds[rejectedIndex] ?? "",
        }),
      ).resolves.toMatchObject({ evidenceOutcome: "published" });
    } finally {
      if (result?.outcome === "admitted") await discardLiveScenarioGenerationAdmission(result);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("rolls back a failed pre-invocation start so the same Scenario can start once", async () => {
    const fixture = await createFixture();
    let result: Awaited<ReturnType<typeof prepareLiveScenarioGenerationAdmission>> | undefined;
    try {
      result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: fixture.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath,
        scenarioIds: ["test-one"],
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      const generationPath = join(result.workspaceRoot, "generation.json");
      const firstVersionProbe = join(fixture.root, "first-version-probe");
      await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
        flag: "wx",
      });
      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  if [ ! -e ${JSON.stringify(firstVersionProbe)} ]; then
    touch ${JSON.stringify(firstVersionProbe)}
    exit 17
  fi
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"item.completed","item":{"id":"done","type":"agent_message","text":"Adaptive reply"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );
      const scenarioRoot = join(result.workspaceRoot, "scenarios/test-one");
      await Promise.all([
        writeFile(
          join(scenarioRoot, "start-reserved"),
          `${JSON.stringify({ scenarioId: "test-one", ownerPid: 2_147_483_647 })}\n`,
          { flag: "wx" },
        ),
        writeFile(join(scenarioRoot, "turn-in-progress"), "1\n", { flag: "wx" }),
        writeFile(join(result.workspaceRoot, ".active-scenario-1"), "test-one\n", { flag: "wx" }),
      ]);

      await expect(
        startAdaptiveScenario({ generationPath, scenarioId: "test-one" }),
      ).rejects.toThrow("Codex CLI version lookup failed");
      await expect(
        startAdaptiveScenario({ generationPath, scenarioId: "test-one" }),
      ).resolves.toMatchObject({ scenarioId: "test-one", turn: 1 });
    } finally {
      if (result?.outcome === "admitted") await discardLiveScenarioGenerationAdmission(result);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("seals a post-invocation evidence failure as blocked instead of resampling", async () => {
    const fixture = await createFixture();
    let result: Awaited<ReturnType<typeof prepareLiveScenarioGenerationAdmission>> | undefined;
    try {
      result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: fixture.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath,
        scenarioIds: ["test-one"],
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      const generationPath = join(result.workspaceRoot, "generation.json");
      await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
        flag: "wx",
      });
      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '${fixture.operatorCodexHome}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );
      const verdictPath = join(fixture.root, "blocked-verdict.json");
      const failVerdictPath = join(fixture.root, "fail-verdict.json");
      await writeFile(
        verdictPath,
        '{"outcome":"blocked","rationale":"Post-invocation evidence failed closed."}\n',
      );
      await writeFile(
        failVerdictPath,
        '{"outcome":"fail","rationale":"This is not a product failure."}\n',
      );

      await expect(
        startAdaptiveScenario({ generationPath, scenarioId: "test-one" }),
      ).resolves.toMatchObject({ evidenceOutcome: "rejected", turn: 1 });
      await expect(
        startAdaptiveScenario({ generationPath, scenarioId: "test-one" }),
      ).rejects.toThrow("start only once");
      await expect(
        finalizeAdaptiveScenario({
          generationPath,
          scenarioId: "test-one",
          verdictPath: failVerdictPath,
        }),
      ).rejects.toThrow("must be finalized as blocked");
      await expect(
        finalizeAdaptiveScenario({ generationPath, scenarioId: "test-one", verdictPath }),
      ).resolves.toMatchObject({ outcome: "blocked" });
      const scenarioRoot = join(result.workspaceRoot, "scenarios/test-one");
      const events = await readFile(join(scenarioRoot, "events/turn-01.jsonl"), "utf8");
      expect(events).toContain('"reason":"mechanical-failure"');
      expect(events).not.toContain(fixture.operatorCodexHome);
    } finally {
      if (result?.outcome === "admitted") await discardLiveScenarioGenerationAdmission(result);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("rolls back an unsent Human reply when resume fails before invocation", async () => {
    const fixture = await createFixture();
    let result: Awaited<ReturnType<typeof prepareLiveScenarioGenerationAdmission>> | undefined;
    try {
      result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: fixture.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath,
        scenarioIds: ["test-one"],
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      const generationPath = join(result.workspaceRoot, "generation.json");
      await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
        flag: "wx",
      });
      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"item.completed","item":{"id":"done","type":"agent_message","text":"Adaptive reply"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );
      await startAdaptiveScenario({ generationPath, scenarioId: "test-one" });
      const failedVersionProbe = join(fixture.root, "failed-resume-version-probe");
      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  if [ ! -e ${JSON.stringify(failedVersionProbe)} ]; then
    touch ${JSON.stringify(failedVersionProbe)}
    exit 17
  fi
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"item.completed","item":{"id":"done","type":"agent_message","text":"Resumed reply"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );
      const replyPath = join(fixture.root, "reply.txt");
      await writeFile(replyPath, "只发送一次。\n");

      await expect(
        resumeAdaptiveScenario({ generationPath, scenarioId: "test-one", replyPath }),
      ).rejects.toThrow("Codex CLI version lookup failed");
      await expect(
        resumeAdaptiveScenario({ generationPath, scenarioId: "test-one", replyPath }),
      ).resolves.toMatchObject({ turn: 2, agentReply: "Resumed reply" });
      const conversation = await readFile(
        join(result.workspaceRoot, "scenarios/test-one/conversation.md"),
        "utf8",
      );
      expect(conversation.match(/## Turn 2/gu)).toHaveLength(1);
      expect(conversation.match(/只发送一次。/gu)).toHaveLength(1);

      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
sleep 1
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"item.completed","item":{"id":"done","type":"agent_message","text":"Only one resume owned the Turn"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );
      const concurrentReplyPath = join(fixture.root, "concurrent-reply.txt");
      await writeFile(concurrentReplyPath, "只允许一个并发回复。\n");
      const firstResume = resumeAdaptiveScenario({
        generationPath,
        scenarioId: "test-one",
        replyPath: concurrentReplyPath,
      });
      const activeInvocationMarker = join(
        result.workspaceRoot,
        "scenarios/test-one/turn-invocation-started.json",
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (
          await access(activeInvocationMarker).then(
            () => true,
            () => false,
          )
        )
          break;
        await Bun.sleep(10);
      }
      await expect(
        resumeAdaptiveScenario({
          generationPath,
          scenarioId: "test-one",
          replyPath: concurrentReplyPath,
        }),
      ).rejects.toThrow("invocation is still active");
      await expect(firstResume).resolves.toMatchObject({ turn: 3 });
      const finalConversation = await readFile(
        join(result.workspaceRoot, "scenarios/test-one/conversation.md"),
        "utf8",
      );
      expect(finalConversation.match(/## Turn 3/gu)).toHaveLength(1);
      expect(finalConversation.match(/只允许一个并发回复。/gu)).toHaveLength(1);
    } finally {
      if (result?.outcome === "admitted") await discardLiveScenarioGenerationAdmission(result);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("finalizes a durable invocation marker left by a terminated CLI process", async () => {
    const fixture = await createFixture();
    let result: Awaited<ReturnType<typeof prepareLiveScenarioGenerationAdmission>> | undefined;
    try {
      result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: fixture.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath,
        scenarioIds: ["test-one"],
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      const generationPath = join(result.workspaceRoot, "generation.json");
      const scenarioRoot = join(result.workspaceRoot, "scenarios/test-one");
      const invocationMarker = join(scenarioRoot, "turn-invocation-started.json");
      await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
        flag: "wx",
      });
      await Promise.all([
        writeFile(
          join(scenarioRoot, "start-reserved"),
          `${JSON.stringify({ scenarioId: "test-one", ownerPid: 2_147_483_647 })}\n`,
          { flag: "wx" },
        ),
        writeFile(join(scenarioRoot, "turn-in-progress"), "1\n", { flag: "wx" }),
        writeFile(join(result.workspaceRoot, ".active-scenario-1"), "test-one\n", { flag: "wx" }),
        writeFile(
          invocationMarker,
          `${JSON.stringify({
            turn: 1,
            startedAt: new Date().toISOString(),
            codexCliVersion: "codex-fixture 1",
            human: "Inspect the installation instructions.",
            ownerPid: 2_147_483_647,
            childPid: 2_147_483_646,
            before: { repository: "fixture-before", agentHome: "fixture-before" },
          })}\n`,
          { flag: "wx" },
        ),
      ]);
      const verdictPath = join(fixture.root, "terminated-verdict.json");
      await writeFile(
        verdictPath,
        '{"outcome":"blocked","rationale":"The invoked CLI process terminated before evidence publication."}\n',
      );

      const recoveries = await Promise.allSettled([
        finalizeAdaptiveScenario({ generationPath, scenarioId: "test-one", verdictPath }),
        finalizeAdaptiveScenario({ generationPath, scenarioId: "test-one", verdictPath }),
      ]);
      expect(recoveries.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(recoveries.filter(({ status }) => status === "rejected")).toHaveLength(1);
      await expect(access(invocationMarker)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(join(scenarioRoot, "turn-in-progress"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const scenarioResult = JSON.parse(
        await readFile(join(scenarioRoot, "result.json"), "utf8"),
      ) as { terminalEvidence: { pointer: string; sha256: string }[] };
      const terminalObservation = scenarioResult.terminalEvidence.find(({ pointer }) =>
        pointer.endsWith("terminal/observation.json"),
      );
      if (terminalObservation === undefined) throw new Error("Expected terminal observation.");
      expect(
        await sha256File(join(dirname(result.workspaceRoot), terminalObservation.pointer)),
      ).toBe(terminalObservation.sha256);
    } finally {
      if (result?.outcome === "admitted") await discardLiveScenarioGenerationAdmission(result);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("keeps an incomplete resumable Scenario inside the four-active ceiling", async () => {
    const scenarioIds = ["test-one", "test-two", "test-three", "test-four", "test-five"];
    const fixture = await createFixture("admitted", concurrencyRegistryPath);
    let result: Awaited<ReturnType<typeof prepareLiveScenarioGenerationAdmission>> | undefined;
    try {
      result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: fixture.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath: concurrencyRegistryPath,
        scenarioIds,
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      const generationPath = join(result.workspaceRoot, "generation.json");
      await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
        flag: "wx",
      });
      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\\n' '{"type":"turn.started"}'
case "$*" in
  *"test one"*) printf '%s\\n' '{"type":"turn.failed"}'; exit 17 ;;
esac
printf '%s\\n' '{"type":"item.completed","item":{"id":"done","type":"agent_message","text":"Adaptive reply"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );

      await expect(
        startAdaptiveScenario({ generationPath, scenarioId: "test-one" }),
      ).rejects.toThrow("did not complete cleanly");
      const remaining = await Promise.allSettled(
        scenarioIds
          .slice(1)
          .map((scenarioId) => startAdaptiveScenario({ generationPath, scenarioId })),
      );
      expect(remaining.filter(({ status }) => status === "fulfilled")).toHaveLength(3);
      expect(remaining.filter(({ status }) => status === "rejected")).toHaveLength(1);
    } finally {
      if (result?.outcome === "admitted") await discardLiveScenarioGenerationAdmission(result);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("does not mutate conversation evidence after a Scenario result is sealed", async () => {
    const fixture = await createFixture();
    let result: Awaited<ReturnType<typeof prepareLiveScenarioGenerationAdmission>> | undefined;
    try {
      result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: fixture.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath,
        scenarioIds: ["test-one"],
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      const generationPath = join(result.workspaceRoot, "generation.json");
      await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
        flag: "wx",
      });
      await writeFile(
        fixture.fakeCodex,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"item.completed","item":{"id":"done","type":"agent_message","text":"Adaptive reply"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
      );
      const verdictPath = join(fixture.root, "verdict.json");
      const replyPath = join(fixture.root, "reply.txt");
      await Promise.all([
        writeFile(verdictPath, '{"outcome":"pass","rationale":"Terminal."}\n'),
        writeFile(replyPath, "再继续。\n"),
      ]);
      await startAdaptiveScenario({ generationPath, scenarioId: "test-one" });
      await finalizeAdaptiveScenario({ generationPath, scenarioId: "test-one", verdictPath });
      const conversationPath = join(result.workspaceRoot, "scenarios/test-one/conversation.md");
      const before = await readFile(conversationPath, "utf8");

      await expect(
        resumeAdaptiveScenario({ generationPath, scenarioId: "test-one", replyPath }),
      ).rejects.toThrow("finalized Scenario");
      expect(await readFile(conversationPath, "utf8")).toBe(before);
    } finally {
      if (result?.outcome === "admitted") await discardLiveScenarioGenerationAdmission(result);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("blocks a Coordinator workspace under the Codex macOS platform scratch roots", async () => {
    if (process.platform !== "darwin") return;
    const fixture = await createFixture("admitted", registryPath, "/private/tmp");
    try {
      const result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: fixture.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath,
        generationId,
        package: fixture.package,
        codexProgram: fixture.fakeCodex,
      });
      expect(result).toMatchObject({
        outcome: "preflight blocked",
        agentBehaviorStarted: false,
        activeGenerationCreated: false,
        externalEffectsObserved: false,
        diagnostics: [
          {
            code: "workspace-not-fresh",
            message:
              "Scenario Coordinator workspace must stay outside Codex macOS platform scratch roots (/tmp, /private/tmp, /var/tmp, /private/var/tmp).",
          },
        ],
      });
      await expect(access(fixture.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(fixture.permissionProbeCapture)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("rechecks mutable Agent inputs without repeating the full Generation preflight", async () => {
    const { result } = await prepare();
    if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
    const prepared = result.preparedScenarios[0];
    if (prepared === undefined) throw new Error("Expected one prepared Scenario.");
    const controlLink = join(prepared.paths.agentHome, ".codex/skills");
    const skillDirectory = join(prepared.paths.agentHome, "skill-directory");
    try {
      await expect(
        verifyLiveScenarioBehaviorBoundary(prepared.paths.manifest),
      ).resolves.toBeDefined();
      await rm(controlLink);
      await symlink(join(prepared.paths.agentHome, ".shell"), controlLink);
      await expect(verifyLiveScenarioBehaviorBoundary(prepared.paths.manifest)).rejects.toThrow(
        "isolated control links changed",
      );
      await rm(controlLink);
      await symlink(skillDirectory, controlLink);
      await writeFile(prepared.paths.initialPrompt, "tampered prompt\n");
      await expect(verifyLiveScenarioBehaviorBoundary(prepared.paths.manifest)).rejects.toThrow(
        "Initial Prompt changed",
      );
    } finally {
      await discardLiveScenarioGenerationAdmission(result);
    }
  });

  test("uses default-deny isolation without enumerating runtime roots", async () => {
    const runtimeContainer = join(await realpath(tmpdir()), "bearing-live-scenario-runtimes");
    await mkdir(runtimeContainer, { recursive: true });
    const ambientRoot = await mkdtemp(join(runtimeContainer, "ambient-"));
    try {
      const { result } = await prepare();
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      for (const prepared of result.preparedScenarios) {
        expect(dirname(prepared.paths.runtimeRoot)).toBe(runtimeContainer);
        expect(prepared.paths.runtimeTempDirectory).toBe(join(prepared.paths.runtimeRoot, "tmp"));
        expect(prepared.launch.environment.TMPDIR).toBe(prepared.paths.runtimeTempDirectory);
        expect(prepared.launch.initial.arguments.join("\n")).toContain('":minimal"="read"');
        expect(prepared.launch.initial.arguments.join("\n")).not.toContain(
          `${JSON.stringify(runtimeContainer)}="deny"`,
        );
        expect(prepared.launch.initial.arguments.join("\n")).not.toContain(ambientRoot);
      }
      await discardLiveScenarioGenerationAdmission(result);
    } finally {
      await rm(ambientRoot, { recursive: true, force: true });
    }
  });

  test("seals a malformed post-invocation Turn for a truthful blocked result", async () => {
    const { fixture, result } = await prepare();
    if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
    const generationPath = join(fixture.workspaceRoot, "generation.json");
    await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
      flag: "wx",
    });
    await writeFile(
      fixture.fakeCodex,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"item.started","item":{"id":"unfinished","type":"command_execution"}}'
printf '%s\\n' '{"type":"turn.completed"}'
exit 0
`,
    );
    const verdictPath = join(fixture.root, "malformed-verdict.json");
    await writeFile(
      verdictPath,
      '{"outcome":"blocked","rationale":"Malformed invocation evidence failed closed."}\n',
    );

    try {
      await expect(
        startAdaptiveScenario({ generationPath, scenarioId: "test-one" }),
      ).resolves.toMatchObject({ evidenceOutcome: "rejected", turn: 1 });
      await expect(
        finalizeAdaptiveScenario({ generationPath, scenarioId: "test-one", verdictPath }),
      ).resolves.toMatchObject({ outcome: "blocked" });
    } finally {
      await discardLiveScenarioGenerationAdmission(result);
    }
  });

  test("blocks an unavailable model before Scenario preparation and cleans the workspace", async () => {
    const { fixture, result } = await prepare("model-unavailable");
    expect(result).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "model-unavailable" }],
      agentBehaviorStarted: false,
    });
    await expect(access(fixture.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("blocks invalid registry and package inputs without creating a workspace", async () => {
    const fixture = await createFixture();
    for (const input of [
      {
        registryPath: "tests/fixtures/live-scenario-admission-invalid-registry.json",
        package: fixture.package,
        code: "invalid-registry",
      },
      { registryPath, package: {}, code: "invalid-package" },
    ] as const) {
      const workspaceRoot = join(fixture.root, `blocked-${input.code}`);
      const result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath: input.registryPath,
        generationId,
        package: input.package,
        codexProgram: fixture.fakeCodex,
      });
      expect(result).toMatchObject({
        outcome: "preflight blocked",
        diagnostics: [{ code: input.code }],
      });
      await expect(access(workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  test("requires the explicit prerequisite root and every declared Skill before preparation", async () => {
    const fixture = await createFixture("admitted", prerequisiteRegistryPath);
    const missingRoot = await prepareLiveScenarioGenerationAdmission({
      sourceRoot: process.cwd(),
      workspaceRoot: fixture.workspaceRoot,
      operatorCodexHome: fixture.operatorCodexHome,
      registryPath: prerequisiteRegistryPath,
      scenarioIds: ["prerequisite-test"],
      generationId,
      package: fixture.package,
      codexProgram: fixture.fakeCodex,
    });
    expect(missingRoot).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "prerequisite-skill-unavailable", scenarioId: "prerequisite-test" }],
    });

    const emptySkillRoot = join(fixture.root, "empty-skills");
    await mkdir(emptySkillRoot);
    const missingSkill = await prepareLiveScenarioGenerationAdmission({
      sourceRoot: process.cwd(),
      workspaceRoot: join(fixture.root, "missing-skill-workspace"),
      operatorCodexHome: fixture.operatorCodexHome,
      registryPath: prerequisiteRegistryPath,
      scenarioIds: ["prerequisite-test"],
      generationId,
      package: fixture.package,
      prerequisiteSkillRoot: emptySkillRoot,
      codexProgram: fixture.fakeCodex,
    });
    expect(missingSkill).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "prerequisite-skill-unavailable", scenarioId: "prerequisite-test" }],
    });
  });

  test("cleans all prepared runtimes when a permission probe fails", async () => {
    const { fixture, result } = await prepare("permission-failure");
    expect(result).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "permission-failure", scenarioId: "test-one" }],
      activeGenerationCreated: false,
    });
    await expect(access(fixture.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(fixture.workspaceRoot, "generation.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("blocks a missing GitHub capability before workspace creation", async () => {
    const githubRegistry = "tests/fixtures/live-scenario-admission-github-registry.json";
    const { fixture, result } = await prepare("admitted", githubRegistry);
    expect(result).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "capability-unavailable", scenarioId: "github-test" }],
    });
    await expect(access(fixture.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(fixture.root, { recursive: true, force: true });
  });
});
