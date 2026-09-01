import { chmod, lstat, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  assertCodexE2EOutputIsolation,
  redactCodexE2EEphemeralCapabilities,
} from "./codex-e2e-runtime";
import {
  captureGitHubRemoteInventory,
  cleanupGitHubMatrixFixture,
  createGitHubJourneyObservation,
  startGitHubJourneyCredentialBroker,
  verifyGitHubJourneyObservation,
  writeOrVerifyGitHubRemoteBaseline,
} from "./github-live-journey";
import {
  assertJourneyAgentPrompt,
  createCodexJourneyEnvironment,
  createLiveJourneyObservation,
  extractCodexAgentReply,
  extractCodexThreadId,
  observationCompletedCleanly,
  readCodexSessionState,
  snapshotDirectory,
  verifyLiveJourneyObservation,
  writeCodexSessionState,
} from "./live-journey-matrix";
import { LIVE_MATRIX_CONCURRENCY, parseLiveMatrixGenerationBasis } from "./live-matrix-generation";
import { createLiveMatrixScenarioTerminalResult } from "./live-matrix-results";
import {
  liveScenarioMatrixPackageIdentitySha256,
  liveScenarioPackageEvidenceIdentity,
  scanLiveScenarioDurableEvidence,
  scanLiveScenarioDurableText,
} from "./live-scenario-evidence";
import { liveScenarioIdSchema, loadLiveScenarioRegistry } from "./live-scenario-registry";
import {
  liveScenarioHarnessIdentitySha256,
  verifyLiveScenarioBehaviorBoundary,
  verifyLiveScenarioGeneration,
} from "./live-scenario-runner";
import { sha256File } from "./release-candidate-lib";

const fail = (message: string): never => {
  throw new Error(message);
};

const installationEntryToken = ["$", "{INSTALL_ENTRY}"].join("");

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const ensureMissing = async (path: string): Promise<void> => {
  if (await exists(path)) fail(`Output already exists: ${path}`);
};

const writeOrVerifyExact = async (path: string, bytes: string): Promise<void> => {
  try {
    await writeFile(path, bytes, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    if ((await readFile(path, "utf8")) !== bytes) {
      fail(`Sealed evidence cannot be replaced: ${path}`);
    }
  }
};

const pathIsInside = (root: string, path: string): boolean => {
  const relation = relative(resolve(root), resolve(path));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
};

const withCoordinatorStateHidden = async <Result>(
  input: Readonly<{
    protectedPaths: readonly string[];
    agentHome: string;
    repository: string;
  }>,
  operation: () => Promise<Result>,
): Promise<Result> => {
  if (
    input.protectedPaths.some(
      (path) => pathIsInside(input.agentHome, path) || pathIsInside(input.repository, path),
    )
  ) {
    fail("Coordinator-only evidence must stay outside the Scenario Agent writable roots.");
  }
  const entries = (
    await Promise.all(
      input.protectedPaths.map(async (path) =>
        (await exists(path)) ? ({ path, mode: (await lstat(path)).mode & 0o777 } as const) : null,
      ),
    )
  ).filter((entry) => entry !== null);
  try {
    await Promise.all(entries.map(({ path }) => chmod(path, 0o000)));
    return await operation();
  } finally {
    await Promise.all(entries.map(({ path, mode }) => chmod(path, mode)));
  }
};

const runProcess = async (
  program: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
  workingDirectory?: string,
) => {
  const child = Bun.spawn([program, ...args], {
    ...(workingDirectory === undefined ? {} : { cwd: workingDirectory }),
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const readGeneration = async (path: string) => {
  const generationPath = await realpath(resolve(path));
  if (basename(generationPath) !== "generation.json") {
    fail("Live Matrix Generation basis must use the canonical generation.json name.");
  }
  const basis = parseLiveMatrixGenerationBasis(JSON.parse(await readFile(generationPath, "utf8")));
  return Object.freeze({ generationPath, workspaceRoot: dirname(generationPath), basis });
};

type Generation = Awaited<ReturnType<typeof readGeneration>>;
type Manifest = Awaited<ReturnType<typeof verifyLiveScenarioGeneration>>;

const readScenario = async (generation: Generation, scenarioIdInput: string): Promise<Manifest> => {
  const scenarioId = liveScenarioIdSchema.parse(scenarioIdInput);
  const readback = generation.basis.preparedScenarios.find(
    (candidate) => candidate.scenarioId === scenarioId,
  );
  const preparedReadback =
    readback ?? fail(`Scenario is not prepared in this Generation: ${scenarioId}.`);
  const manifest = await verifyLiveScenarioGeneration(
    join(generation.workspaceRoot, "scenarios", scenarioId, "scenario-manifest.json"),
  );
  if (
    manifest.generationId !== generation.basis.generationId ||
    manifest.scenario.id !== scenarioId ||
    manifest.startingStateSha256 !== preparedReadback.fixtureSha256 ||
    manifest.matrixDefinitionSha256 !== generation.basis.registryDefinitionSha256 ||
    liveScenarioMatrixPackageIdentitySha256(
      liveScenarioPackageEvidenceIdentity(manifest.package),
    ) !== generation.basis.package.identitySha256 ||
    (await liveScenarioHarnessIdentitySha256({ sourceRoot: manifest.paths.sourceRoot })) !==
      generation.basis.harnessIdentitySha256
  ) {
    fail(`Prepared Scenario contradicts its Generation basis: ${scenarioId}.`);
  }
  return manifest;
};

const orderedObservationNames = async (manifest: Manifest): Promise<readonly string[]> => {
  const names = (await readdir(manifest.paths.observations))
    .filter((name) => /^turn-\d{2}\.json$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));
  const expected = names.map((_, index) => `turn-${String(index + 1).padStart(2, "0")}.json`);
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    fail("Live Scenario observations must be contiguous and start at Turn 1.");
  }
  return names;
};

export const assertAdaptiveScenarioCapacity = (activeScenarioCount: number): void => {
  if (!Number.isSafeInteger(activeScenarioCount) || activeScenarioCount < 0) {
    fail("Adaptive Matrix active Scenario count must be a non-negative integer.");
  }
  if (activeScenarioCount >= LIVE_MATRIX_CONCURRENCY) {
    fail("The adaptive Matrix allows at most four active Scenarios.");
  }
};

const isAlreadyExists = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "EEXIST";

const activeSlotPath = (generation: Generation, slot: number): string =>
  join(generation.workspaceRoot, `.active-scenario-${slot}`);

const releaseScenarioSlot = async (
  generation: Generation,
  scenarioId: string,
): Promise<void> => {
  await Promise.all(
    Array.from({ length: LIVE_MATRIX_CONCURRENCY }, async (_, index) => {
      const path = activeSlotPath(generation, index + 1);
      if ((await exists(path)) && (await readFile(path, "utf8")).trim() === scenarioId) {
        await rm(path, { force: true });
      }
    }),
  );
};

const reserveScenarioStart = async (
  generation: Generation,
  manifest: Manifest,
): Promise<string> => {
  const reservation = join(manifest.paths.workspaceRoot, "start-reserved");
  try {
    await writeFile(reservation, `${manifest.scenario.id}\n`, { flag: "wx" });
  } catch (error) {
    if (isAlreadyExists(error)) {
      fail("An adaptive Scenario can start only once in one Generation.");
    }
    throw error;
  }
  for (let slot = 1; slot <= LIVE_MATRIX_CONCURRENCY; slot += 1) {
    const path = activeSlotPath(generation, slot);
    try {
      await writeFile(path, `${manifest.scenario.id}\n`, { flag: "wx" });
      return path;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  await rm(reservation, { force: true });
  assertAdaptiveScenarioCapacity(LIVE_MATRIX_CONCURRENCY);
  return fail("Adaptive Scenario capacity reservation failed.");
};

const redactExactValues = (value: string, replacements: readonly (readonly [string, string])[]) =>
  replacements.reduce(
    (current, [secret, marker]) =>
      secret.length === 0 ? current : current.replaceAll(secret, marker),
    value,
  );

const rejectedDurableEventStream = (reason: "credential-match" | "scanner-unavailable"): string =>
  `${JSON.stringify({ type: "thread.started", thread_id: "[evidence-rejected]" })}\n${JSON.stringify({
    type: "turn.started",
  })}\n${JSON.stringify({ type: "durable-evidence-rejected", reason })}\n${JSON.stringify({
    type: "turn.failed",
  })}\n`;

const snapshotScenarioAgentHome = (agentHome: string): Promise<string> =>
  snapshotDirectory(agentHome, { excludeTrees: [".codex", "skill-directory/.system"] });

const appendConversation = async (
  manifest: Manifest,
  turn: number,
  human: string,
  agent?: string,
): Promise<void> => {
  const section = `## Turn ${turn}\n\n### Human\n\n${human}\n\n${
    agent === undefined ? "" : `### Agent\n\n${agent}\n\n`
  }`;
  const durableConversation = (value: string) =>
    scanLiveScenarioDurableText({ value, configPath: resolve(".gitleaks.toml") });
  if (turn === 1) {
    await writeFile(
      manifest.paths.conversation,
      durableConversation(`# Conversation\n\n${section}`),
      { flag: "wx" },
    );
    return;
  }
  const current = await readFile(manifest.paths.conversation, "utf8");
  await writeFile(manifest.paths.conversation, durableConversation(`${current}${section}`));
};

const appendAgentReply = async (manifest: Manifest, agent: string): Promise<void> => {
  const current = await readFile(manifest.paths.conversation, "utf8");
  await writeFile(
    manifest.paths.conversation,
    scanLiveScenarioDurableText({
      value: `${current}### Agent\n\n${agent}\n\n`,
      configPath: resolve(".gitleaks.toml"),
    }),
  );
};

const runTurn = async (input: { manifest: Manifest; prompt: string; turn: number }) => {
  const manifest = await verifyLiveScenarioBehaviorBoundary(input.manifest.paths.manifest);
  if (await exists(manifest.paths.result))
    fail("A finalized Scenario cannot be resumed or resampled.");
  const turnMarker = join(manifest.paths.workspaceRoot, "turn-in-progress");
  await writeFile(turnMarker, `${input.turn}\n`, { flag: "wx" });
  try {
    const sessionState = await readCodexSessionState(manifest.paths.sessionState);
    if (sessionState === undefined && input.turn !== 1) {
      fail("The first adaptive Scenario Turn must be Turn 1.");
    }
    if (
      sessionState !== undefined &&
      (sessionState.generationId !== manifest.generationId ||
        input.turn !== sessionState.lastTurn + 1)
    ) {
      fail("Codex session state does not match this Generation or next Turn.");
    }
    const step = sessionState === undefined ? manifest.launch.initial : manifest.launch.resume;
    const args = step.arguments.map((argument) =>
      argument === "<session-id>"
        ? (sessionState?.sessionId ?? fail("Resume launch requires private session continuity."))
        : argument,
    );
    const registry = await loadLiveScenarioRegistry(manifest.paths.registry);
    const prompt = assertJourneyAgentPrompt(
      input.prompt,
      registry.scenarios.map(({ id }) => id),
      [manifest.paths.installationEntry],
    );
    const environment = createCodexJourneyEnvironment(process.env, manifest.launch.environment, {
      includeCanonicalBearingBin:
        manifest.scenario.fixedValidationFixture.profile !== "fresh-installation-repository",
    });
    const operatorCodexHome = await realpath(manifest.paths.operatorCodexHome);
    const version = await runProcess(
      step.program,
      ["--version"],
      environment,
      step.workingDirectory,
    );
    if (version.exitCode !== 0 || version.stdout.trim().length === 0) {
      fail(version.stderr.trim() || "Codex CLI version lookup failed before tested behavior.");
    }
    const turnLabel = String(input.turn).padStart(2, "0");
    const eventsPath = join(manifest.paths.events, `turn-${turnLabel}.jsonl`);
    const stderrPath = join(manifest.paths.events, `turn-${turnLabel}.stderr.log`);
    const observationPath = join(manifest.paths.observations, `turn-${turnLabel}.json`);
    await Promise.all([
      ensureMissing(eventsPath),
      ensureMissing(stderrPath),
      ensureMissing(observationPath),
    ]);

    const priorNames = await orderedObservationNames(manifest);
    if (priorNames.length !== input.turn - 1) {
      fail("Adaptive Scenario Turn does not follow the exact observed conversation chain.");
    }
    const before = {
      repository: await snapshotDirectory(manifest.paths.repository),
      agentHome: await snapshotScenarioAgentHome(manifest.paths.agentHome),
    };
    if (priorNames.length > 0) {
      const pointer = `observations/${priorNames.at(-1) as string}`;
      const previous =
        manifest.github === undefined
          ? await verifyLiveJourneyObservation({
              workspaceRoot: manifest.paths.workspaceRoot,
              pointer,
              expectedCodexCliVersion: version.stdout.trim(),
            })
          : (
              await verifyGitHubJourneyObservation({
                workspaceRoot: manifest.paths.workspaceRoot,
                pointer,
                expectedCodexCliVersion: version.stdout.trim(),
              })
            ).base;
      if (
        previous.state.after.repository !== before.repository ||
        previous.state.after.agentHome !== before.agentHome
      ) {
        fail("Live Scenario state changed outside the recorded Turn chain.");
      }
    }

    const startedAt = Date.now();
    let processResult: Awaited<ReturnType<typeof runProcess>>;
    let processEnvironment = environment;
    let remoteBeforeBytes: string | undefined;
    let remoteAfterBytes: string | undefined;
    const protectedPaths = [
      manifest.paths.manifest,
      manifest.paths.manifestDigest,
      dirname(manifest.paths.initialPrompt),
      manifest.paths.observations,
      manifest.paths.events,
      manifest.paths.conversation,
      manifest.paths.terminal,
      manifest.paths.sessionState,
      ...(manifest.paths.remoteInventories === undefined ? [] : [manifest.paths.remoteInventories]),
    ];
    if (manifest.github === undefined) {
      processResult = await withCoordinatorStateHidden(
        {
          protectedPaths,
          agentHome: manifest.paths.agentHome,
          repository: manifest.paths.repository,
        },
        () => runProcess(step.program, [...args, prompt], environment, step.workingDirectory),
      );
    } else {
      const inventoryRoot =
        manifest.paths.remoteInventories ?? fail("GitHub inventory root is unavailable.");
      const beforePath = join(inventoryRoot, `turn-${turnLabel}-before.json`);
      const afterPath = join(inventoryRoot, `turn-${turnLabel}-after.json`);
      const remoteBefore = await captureGitHubRemoteInventory({
        program: manifest.github.program,
        repositorySlug: manifest.github.repositorySlug,
        scopeKey: manifest.github.scopeKey,
      });
      remoteBeforeBytes = `${JSON.stringify(remoteBefore, null, 2)}\n`;
      await writeOrVerifyGitHubRemoteBaseline({ path: beforePath, bytes: remoteBeforeBytes });
      const broker = await startGitHubJourneyCredentialBroker({
        program: manifest.github.program,
        agentHome: manifest.paths.agentHome,
        repositoryRoot: manifest.paths.repository,
        repositorySlug: manifest.github.repositorySlug,
        scopeKey: manifest.github.scopeKey,
        preparedGitConfigSha256: manifest.github.preparedGitConfigSha256,
        nodeProgram: manifest.toolchain.nodeExecutable,
        baseEnvironment: environment,
      });
      try {
        processEnvironment = broker.environment;
        processResult = await withCoordinatorStateHidden(
          {
            protectedPaths,
            agentHome: manifest.paths.agentHome,
            repository: manifest.paths.repository,
          },
          () =>
            runProcess(
              step.program,
              [...args, ...broker.codexArguments, prompt],
              broker.environment,
              step.workingDirectory,
            ),
        );
      } finally {
        await broker.stop();
      }
      const remoteAfter = await captureGitHubRemoteInventory({
        program: manifest.github.program,
        repositorySlug: manifest.github.repositorySlug,
        scopeKey: manifest.github.scopeKey,
      });
      remoteAfterBytes = `${JSON.stringify(remoteAfter, null, 2)}\n`;
      await writeFile(afterPath, remoteAfterBytes, { flag: "wx" });
    }
    const endedAt = Date.now();
    const observedSessionId = extractCodexThreadId(processResult.stdout) ?? sessionState?.sessionId;
    const ephemeralValues = [
      processEnvironment["BEARING_GITHUB_BROKER_SOCKET"],
      processEnvironment["BEARING_GITHUB_BROKER_AUTH"],
    ].filter((value): value is string => value !== undefined);
    const locatorReplacements: readonly (readonly [string, string])[] = [
      [manifest.paths.runtimeRoot, "[scenario-runtime]"],
      [manifest.paths.workspaceRoot, "[scenario-evidence]"],
      ...(observedSessionId === undefined ? [] : ([[observedSessionId, "[session]"]] as const)),
    ];
    const output = {
      stdout: redactExactValues(
        redactCodexE2EEphemeralCapabilities(processResult.stdout, ephemeralValues),
        locatorReplacements,
      ),
      stderr: redactExactValues(
        redactCodexE2EEphemeralCapabilities(processResult.stderr, ephemeralValues),
        locatorReplacements,
      ),
    };
    assertCodexE2EOutputIsolation({
      ...output,
      operatorCodexHome,
      ephemeralCapabilityValues: ephemeralValues,
    });
    let evidenceOutcome: "published" | "rejected" = "published";
    let durableOutput: Readonly<{ stdout: string; stderr: string }>;
    try {
      durableOutput = {
        stdout: scanLiveScenarioDurableText({
          value: output.stdout,
          configPath: resolve(".gitleaks.toml"),
        }),
        stderr: scanLiveScenarioDurableText({
          value: output.stderr,
          configPath: resolve(".gitleaks.toml"),
        }),
      };
    } catch (error) {
      evidenceOutcome = "rejected";
      const reason =
        error instanceof Error && error.message.includes("failed the required Gitleaks scan")
          ? "credential-match"
          : "scanner-unavailable";
      durableOutput = { stdout: rejectedDurableEventStream(reason), stderr: "" };
    }
    await Promise.all([
      writeFile(eventsPath, durableOutput.stdout, { flag: "wx" }),
      writeFile(stderrPath, durableOutput.stderr, { flag: "wx" }),
    ]);
    const after = {
      repository: await snapshotDirectory(manifest.paths.repository),
      agentHome: await snapshotScenarioAgentHome(manifest.paths.agentHome),
    };
    const baseObservation = {
      turn: input.turn,
      codexCliVersion: version.stdout.trim(),
      exitCode: processResult.exitCode,
      stdout: durableOutput.stdout,
      stderr: durableOutput.stderr,
      before,
      after,
      rawEventsPointer: `events/turn-${turnLabel}.jsonl`,
      stderrPointer: `events/turn-${turnLabel}.stderr.log`,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
    } as const;
    const observation =
      manifest.github === undefined
        ? createLiveJourneyObservation(baseObservation)
        : createGitHubJourneyObservation({
            ...baseObservation,
            remoteBeforePointer: `github/remote-inventories/turn-${turnLabel}-before.json`,
            remoteBeforeBytes: remoteBeforeBytes ?? fail("GitHub before evidence is unavailable."),
            remoteAfterPointer: `github/remote-inventories/turn-${turnLabel}-after.json`,
            remoteAfterBytes: remoteAfterBytes ?? fail("GitHub after evidence is unavailable."),
          });
    await writeFile(
      observationPath,
      scanLiveScenarioDurableEvidence({
        value: observation,
        configPath: resolve(".gitleaks.toml"),
      }),
      { flag: "wx" },
    );
    if (
      evidenceOutcome === "published" &&
      observation.invocationStarted &&
      observedSessionId !== undefined
    ) {
      await writeCodexSessionState(manifest.paths.sessionState, {
        schemaVersion: 1,
        generationId: manifest.generationId,
        sessionId: observedSessionId,
        lastTurn: input.turn,
      });
    }
    if (evidenceOutcome === "rejected") {
      return Object.freeze({
        scenarioId: manifest.scenario.id,
        turn: input.turn,
        evidenceOutcome,
        observation: observationPath,
      });
    }
    if (!observationCompletedCleanly(observation) || observedSessionId === undefined) {
      fail(`Live Scenario ${manifest.scenario.id} Turn ${input.turn} did not complete cleanly.`);
    }
    const agentReply = extractCodexAgentReply(durableOutput.stdout);
    await appendAgentReply(manifest, agentReply);
    return Object.freeze({
      scenarioId: manifest.scenario.id,
      turn: input.turn,
      evidenceOutcome,
      agentReply,
      observation: observationPath,
    });
  } finally {
    await rm(turnMarker, { force: true });
  }
};

export const startAdaptiveScenario = async (input: {
  generationPath: string;
  scenarioId: string;
}) => {
  const generation = await readGeneration(input.generationPath);
  const manifest = await readScenario(generation, input.scenarioId);
  if (
    (await orderedObservationNames(manifest)).length !== 0 ||
    (await exists(manifest.paths.sessionState))
  ) {
    fail("An adaptive Scenario can start only once in one Generation.");
  }
  const activeSlot = await reserveScenarioStart(generation, manifest);
  const prompt = (await readFile(manifest.paths.initialPrompt, "utf8")).trimEnd();
  const readablePrompt = manifest.scenario.initialPrompt.replace(
    installationEntryToken,
    "[installation entry]",
  );
  try {
    await appendConversation(manifest, 1, readablePrompt);
    return await runTurn({ manifest, prompt, turn: 1 });
  } catch (error) {
    await rm(activeSlot, { force: true });
    throw error;
  }
};

export const resumeAdaptiveScenario = async (input: {
  generationPath: string;
  scenarioId: string;
  replyPath: string;
}) => {
  const generation = await readGeneration(input.generationPath);
  const manifest = await readScenario(generation, input.scenarioId);
  const observations = await orderedObservationNames(manifest);
  if (observations.length === 0 || !(await exists(manifest.paths.sessionState))) {
    fail("Adaptive resume requires the same started Codex conversation.");
  }
  const replyBytes =
    input.replyPath === "-"
      ? await new Response(Bun.stdin.stream()).text()
      : await readFile(resolve(input.replyPath), "utf8");
  const reply = replyBytes.trim();
  if (reply.length === 0 || /^\$(?:bearing|wayfinder)\b/iu.test(reply)) {
    fail(
      "Adaptive reply must be one natural Orchestrator response without repeating Skill invocation.",
    );
  }
  const turn = observations.length + 1;
  await appendConversation(manifest, turn, reply);
  return runTurn({ manifest, prompt: reply, turn });
};

const gitRead = (repository: string, args: readonly string[]): string => {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repository,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    fail(result.stderr.toString().trim() || `git ${args.join(" ")} failed.`);
  return result.stdout.toString();
};

const captureTerminalObservation = async (manifest: Manifest) => {
  const observers = manifest.scenario.terminalEvidence.observers;
  const value: Record<string, unknown> = {
    schemaVersion: 1,
    generationId: manifest.generationId,
    scenarioId: manifest.scenario.id,
    description: manifest.scenario.terminalEvidence.description,
    observers,
  };
  if (observers.includes("repository")) {
    value["repository"] = { sha256: await snapshotDirectory(manifest.paths.repository) };
  }
  if (observers.includes("agent-home")) {
    value["agentHome"] = { sha256: await snapshotScenarioAgentHome(manifest.paths.agentHome) };
  }
  if (observers.includes("git")) {
    value["git"] = {
      head: gitRead(manifest.paths.repository, ["rev-parse", "HEAD"]).trim(),
      status: gitRead(manifest.paths.repository, ["status", "--short"]),
      diff: gitRead(manifest.paths.repository, ["diff", "--no-ext-diff", "--binary"]),
      stagedDiff: gitRead(manifest.paths.repository, [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--binary",
      ]),
    };
  }
  if (observers.includes("github")) {
    const github = manifest.github ?? fail("GitHub observer requires the bounded GitHub Fixture.");
    value["github"] = await captureGitHubRemoteInventory({
      program: github.program,
      repositorySlug: github.repositorySlug,
      scopeKey: github.scopeKey,
    });
  }
  return value;
};

const evidenceReference = async (evidenceRoot: string, path: string) => ({
  pointer: relative(evidenceRoot, path).replaceAll("\\", "/"),
  sha256: await sha256File(path),
});

export const finalizeAdaptiveScenario = async (input: {
  generationPath: string;
  scenarioId: string;
  verdictPath: string;
}) => {
  const generation = await readGeneration(input.generationPath);
  const manifest = await readScenario(generation, input.scenarioId);
  await ensureMissing(manifest.paths.result);
  const verdict = z
    .object({
      outcome: z.enum(["pass", "fail", "blocked"]),
      rationale: z.string().trim().min(1).max(800),
    })
    .strict()
    .parse(JSON.parse(await readFile(resolve(input.verdictPath), "utf8")));
  const names = await orderedObservationNames(manifest);
  if (names.length === 0 || !(await exists(manifest.paths.conversation))) {
    fail(
      "Adaptive Scenario finalization requires at least one observed Turn and its conversation.",
    );
  }
  const observations = [];
  for (const name of names) {
    const pointer = `observations/${name}`;
    const first = JSON.parse(await readFile(join(manifest.paths.observations, name), "utf8")) as {
      codex?: { cliVersion?: unknown };
    };
    const cliVersion =
      typeof first.codex?.cliVersion === "string"
        ? first.codex.cliVersion
        : fail("Turn observation has no Codex CLI identity.");
    observations.push(
      manifest.github === undefined
        ? await verifyLiveJourneyObservation({
            workspaceRoot: manifest.paths.workspaceRoot,
            pointer,
            expectedCodexCliVersion: cliVersion,
          })
        : (
            await verifyGitHubJourneyObservation({
              workspaceRoot: manifest.paths.workspaceRoot,
              pointer,
              expectedCodexCliVersion: cliVersion,
            })
          ).base,
    );
  }
  if (
    verdict.outcome === "pass" &&
    observations.some((observation) => !observationCompletedCleanly(observation))
  ) {
    fail("A passing semantic verdict cannot contradict an incomplete Codex Turn.");
  }
  const verdictSealPath = join(manifest.paths.terminal, "verdict.json");
  await writeOrVerifyExact(
    verdictSealPath,
    scanLiveScenarioDurableEvidence({ value: verdict, configPath: resolve(".gitleaks.toml") }),
  );
  const terminalPath = join(manifest.paths.terminal, "observation.json");
  if (!(await exists(terminalPath))) {
    await writeFile(
      terminalPath,
      scanLiveScenarioDurableEvidence({
        value: await captureTerminalObservation(manifest),
        configPath: resolve(".gitleaks.toml"),
      }),
      { flag: "wx" },
    );
  }
  const evidenceRoot = dirname(generation.workspaceRoot);
  const result = createLiveMatrixScenarioTerminalResult({
    generationId: manifest.generationId,
    scenarioId: manifest.scenario.id,
    outcome: verdict.outcome,
    rationale: verdict.rationale,
    conversation: await evidenceReference(evidenceRoot, manifest.paths.conversation),
    rawEvents: await Promise.all(
      names.map((name) =>
        evidenceReference(
          evidenceRoot,
          join(manifest.paths.events, name.replace(/\.json$/u, ".jsonl")),
        ),
      ),
    ),
    terminalEvidence: await Promise.all([
      evidenceReference(evidenceRoot, verdictSealPath),
      evidenceReference(evidenceRoot, terminalPath),
    ]),
    turns: observations.map((observation) => ({
      turnNumber: observation.turn,
      startedAt: observation.startedAt,
      endedAt: observation.endedAt,
    })),
    startedAt: observations[0]?.startedAt ?? fail("Scenario start observation is unavailable."),
    endedAt: observations.at(-1)?.endedAt ?? fail("Scenario end observation is unavailable."),
  });
  await writeFile(
    manifest.paths.result,
    scanLiveScenarioDurableEvidence({ value: result, configPath: resolve(".gitleaks.toml") }),
    { flag: "wx" },
  );
  await releaseScenarioSlot(generation, manifest.scenario.id);
  if (manifest.github !== undefined) {
    await cleanupGitHubMatrixFixture({
      lifecycle: manifest.github.fixtureLifecycle,
      program: manifest.github.program,
    });
  }
  await Promise.all([
    rm(manifest.paths.runtimeRoot, { recursive: true, force: true }),
    rm(manifest.paths.sessionState, { force: true }),
  ]);
  return Object.freeze({
    scenarioId: result.scenarioId,
    outcome: result.outcome,
    result: manifest.paths.result,
  });
};

export const calculateAdaptivePeakConcurrency = (
  scenarios: readonly { startedAt: string; endedAt: string }[],
): number => {
  const events = scenarios
    .flatMap((scenario) => [
      { at: Date.parse(scenario.startedAt), delta: 1 },
      { at: Date.parse(scenario.endedAt), delta: -1 },
    ])
    .sort((left, right) => left.at - right.at || left.delta - right.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  return peak;
};
