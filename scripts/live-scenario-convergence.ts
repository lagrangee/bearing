import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { liveScenarioPackageSchema } from "./live-scenario-evidence";
import {
  liveScenarioPackageEvidenceIdentity,
  parseLiveScenarioResult,
} from "./live-scenario-generation";
import { loadLiveScenarioRegistry } from "./live-scenario-registry";
import {
  assertLiveScenarioSourceCurrent,
  liveScenarioDefinitionDigest,
} from "./live-scenario-runner";
import { sha256File } from "./release-digest";

const fail = (message: string): never => {
  throw new Error(message);
};

const preparedIdentitySchema = z
  .object({
    generationId: z.string().uuid(),
    evidenceClass: z.enum(["local-rehearsal", "release-candidate"]),
    matrixDefinitionSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    package: liveScenarioPackageSchema.optional(),
  })
  .passthrough();

const namesIfDirectoryExists = async (path: string): Promise<readonly string[]> => {
  try {
    return await readdir(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
};

const preparedManifestState = async (path: string) => {
  try {
    const state = await stat(path);
    if (!state.isFile()) return null;
    return {
      identity: preparedIdentitySchema.parse(JSON.parse(await readFile(path, "utf8"))),
      modifiedAt: state.mtime,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
};

const currentHead = (sourceRoot: string): string => {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: sourceRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    fail(result.stderr.toString().trim() || "Matrix status cannot read the current source HEAD.");
  }
  return result.stdout.toString().trim();
};

const artifactMatches = async (path: string, expectedSha256: string): Promise<boolean> => {
  try {
    return (await sha256File(path)) === expectedSha256;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const sourceMatches = async (sourceRoot: string, value: unknown): Promise<boolean> => {
  try {
    await assertLiveScenarioSourceCurrent(sourceRoot, value);
    return true;
  } catch {
    return false;
  }
};

export const inspectLiveScenarioMatrixStatus = async (input: {
  sourceRoot: string;
  registryPath: string;
  generationRoot: string;
  now?: Date;
}) => {
  const sourceRoot = resolve(input.sourceRoot);
  const registryPath = resolve(sourceRoot, input.registryPath);
  const registry = await loadLiveScenarioRegistry(registryPath);
  const currentMatrixDefinitionSha256 = await liveScenarioDefinitionDigest({
    sourceRoot,
    registryPath: input.registryPath,
  });
  const generationRoot = resolve(input.generationRoot);
  const resultsRoot = join(generationRoot, "results");
  const resultNames = (await namesIfDirectoryExists(resultsRoot))
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));
  const expectedResultNames = new Set(registry.scenarios.map(({ id }) => `${id}.json`));
  const unexpected = resultNames.filter((name) => !expectedResultNames.has(name));
  if (unexpected.length > 0) {
    fail(`Matrix status found unexpected result files: ${unexpected.join(", ")}.`);
  }

  const completedResults = await Promise.all(
    resultNames.map(async (name) => {
      const path = join(resultsRoot, name);
      const result = parseLiveScenarioResult(JSON.parse(await readFile(path, "utf8")));
      if (`${result.scenarioId}.json` !== name) {
        fail(`Matrix status result filename contradicts its Scenario: ${name}.`);
      }
      return { result, modifiedAt: (await stat(path)).mtime };
    }),
  );
  const identities = new Set(
    completedResults.map(({ result }) =>
      JSON.stringify({
        evidenceClass: result.evidenceClass,
        generationId: result.generationId,
        package: result.package,
        matrixDefinitionSha256: result.matrixDefinitionSha256,
        codex: result.codex,
        coordinatorIdentity: result.coordinatorIdentity,
      }),
    ),
  );
  if (identities.size > 1) {
    fail("Matrix status results do not share one exact identity.");
  }
  const completedScenarioIds = registry.scenarios
    .map(({ id }) => id)
    .filter((id) => completedResults.some(({ result }) => result.scenarioId === id));
  const preparedScenarios = await Promise.all(
    registry.scenarios.map(async ({ id }) => ({
      id,
      state: await preparedManifestState(join(generationRoot, id, "scenario-manifest.json")),
    })),
  );
  const preparedScenarioIds = preparedScenarios
    .filter(({ id, state }) => state !== null && !completedScenarioIds.includes(id))
    .map(({ id }) => id);
  const firstResult = completedResults[0]?.result;
  const firstPrepared = preparedScenarios.find(({ state }) => state !== null)?.state?.identity;
  const summaryIdentity = Object.freeze({
    generationId: firstResult?.generationId ?? firstPrepared?.generationId ?? null,
    evidenceClass: firstResult?.evidenceClass ?? firstPrepared?.evidenceClass ?? null,
    matrixDefinitionSha256:
      firstResult?.matrixDefinitionSha256 ?? firstPrepared?.matrixDefinitionSha256 ?? null,
  });
  const matrixPackage =
    firstResult?.package ??
    (firstPrepared?.package === undefined
      ? null
      : liveScenarioPackageEvidenceIdentity(firstPrepared.package));
  const preparedPackage = firstPrepared?.package;
  const summaryIdentityBytes = JSON.stringify(summaryIdentity);
  for (const { state } of preparedScenarios) {
    if (
      state !== null &&
      JSON.stringify({
        generationId: state.identity.generationId,
        evidenceClass: state.identity.evidenceClass,
        matrixDefinitionSha256: state.identity.matrixDefinitionSha256,
      }) !== summaryIdentityBytes
    ) {
      fail("Matrix status prepared Scenarios do not share one exact identity.");
    }
    if (
      state?.identity.package !== undefined &&
      JSON.stringify(liveScenarioPackageEvidenceIdentity(state.identity.package)) !==
        JSON.stringify(matrixPackage)
    ) {
      fail("Matrix status prepared Scenarios do not share one exact package.");
    }
  }
  for (const { result } of completedResults) {
    if (
      JSON.stringify({
        generationId: result.generationId,
        evidenceClass: result.evidenceClass,
        matrixDefinitionSha256: result.matrixDefinitionSha256,
      }) !== summaryIdentityBytes
    ) {
      fail("Matrix status prepared and completed Scenarios do not share one exact identity.");
    }
  }
  const lastBoundedResultAt = completedResults
    .map(({ modifiedAt }) => modifiedAt)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const now = input.now ?? new Date();
  const progressAnchor =
    lastBoundedResultAt ??
    preparedScenarios
      .flatMap(({ state }) => (state === null ? [] : [state.modifiedAt]))
      .sort((left, right) => left.getTime() - right.getTime())[0];
  const completed = completedScenarioIds.length;
  const total = registry.scenarios.length;
  const refineReasons: string[] = [];
  const matrixDefinitionCurrent =
    summaryIdentity.matrixDefinitionSha256 === null
      ? null
      : summaryIdentity.matrixDefinitionSha256 === currentMatrixDefinitionSha256;
  if (matrixDefinitionCurrent === false) {
    refineReasons.push("matrix-definition-changed");
  }
  const head = matrixPackage === null ? null : currentHead(sourceRoot);
  const packageCurrent =
    matrixPackage === null
      ? null
      : preparedPackage !== undefined &&
        (await artifactMatches(preparedPackage.artifact.path, matrixPackage.artifact.sha256)) &&
        (matrixPackage.evidenceClass === "local-rehearsal"
          ? matrixPackage.sourceHead === head
          : matrixPackage.sourceCommit === head) &&
        (await sourceMatches(sourceRoot, matrixPackage));
  if (packageCurrent === false) {
    refineReasons.push("package-or-source-changed");
  }
  if ([5, 10, 15, 20].includes(completed)) {
    refineReasons.push(`stage-${completed}-scenario-checkpoint`);
  }
  if (
    completed < total &&
    progressAnchor !== undefined &&
    now.getTime() - progressAnchor.getTime() >= 30 * 60 * 1_000
  ) {
    refineReasons.push("no-bounded-result-for-30-minutes");
  }
  return Object.freeze({
    ...summaryIdentity,
    currentMatrixDefinitionSha256,
    matrixDefinitionCurrent,
    package: matrixPackage,
    packageCurrent,
    completed,
    total,
    completedScenarioIds: Object.freeze(completedScenarioIds),
    preparedScenarioIds: Object.freeze(preparedScenarioIds),
    nextScenarioId:
      matrixDefinitionCurrent === false || packageCurrent === false
        ? null
        : (registry.scenarios.find(({ id }) => !completedScenarioIds.includes(id))?.id ?? null),
    matrixComplete: completed === total,
    lastBoundedResultAt: lastBoundedResultAt?.toISOString() ?? null,
    refineReasons: Object.freeze(refineReasons),
  });
};
