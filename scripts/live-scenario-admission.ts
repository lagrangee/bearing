import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  prepareIsolatedCodexHome,
  probeCodexE2EPermissionProfile,
  readCodexE2EModelAvailability,
  resolveCodexE2EProgram,
} from "./codex-e2e-runtime";
import {
  cleanupGitHubMatrixFixture,
  githubMatrixFixturePreparationExternalEffect,
  recoverPreparedGitHubMatrixFixtureFailure,
} from "./github-live-journey";
import { createCodexJourneyEnvironment } from "./live-journey-matrix";
import {
  createLiveMatrixGenerationBasis,
  type LiveMatrixGenerationBasis,
  type LiveMatrixPreparedScenarioReadback,
} from "./live-matrix-generation";
import {
  liveScenarioMatrixPackageIdentitySha256,
  liveScenarioPackageEvidenceIdentity,
  liveScenarioPackageSchema,
} from "./live-scenario-evidence";
import {
  digestLiveScenarioFixture,
  digestLiveScenarioFixtureSet,
  type LiveScenario,
  liveScenarioSkillIsInstalled,
  loadLiveScenarioRegistry,
  preflightLiveScenarioRegistry,
} from "./live-scenario-registry";
import {
  ensureLiveScenarioCoordinatorWorkspace,
  liveScenarioDefinitionDigest,
  liveScenarioHarnessIdentitySha256,
  prepareLiveScenarioGeneration,
  verifyLiveScenarioGeneration,
} from "./live-scenario-runner";

const generationIdSchema = z.string().uuid();
type PreparedScenario = Awaited<ReturnType<typeof prepareLiveScenarioGeneration>>;
type VerifiedScenario = Awaited<ReturnType<typeof verifyLiveScenarioGeneration>>;

type DiagnosticCode =
  | "capability-unavailable"
  | "invalid-generation"
  | "invalid-package"
  | "invalid-registry"
  | "model-unavailable"
  | "permission-failure"
  | "preparation-failed"
  | "prerequisite-skill-unavailable"
  | "workspace-not-fresh"
  | "skill-topology-mismatch";

export type LiveScenarioAdmissionDiagnostic = Readonly<{
  code: DiagnosticCode;
  message: string;
  scenarioId?: string;
}>;

const diagnostic = (
  code: DiagnosticCode,
  message: string,
  scenarioId?: string,
): LiveScenarioAdmissionDiagnostic =>
  Object.freeze({ code, message, ...(scenarioId === undefined ? {} : { scenarioId }) });

const blocked = (
  generationId: string | undefined,
  diagnostics: readonly LiveScenarioAdmissionDiagnostic[],
  externalEffectsObserved = false,
) =>
  Object.freeze({
    outcome: "preflight blocked" as const,
    ...(generationId === undefined ? {} : { generationId }),
    agentBehaviorStarted: false as const,
    activeGenerationCreated: false as const,
    externalEffectsObserved,
    diagnostics: Object.freeze(diagnostics),
  });

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const discardPreparedScenarios = async (
  workspaceRoot: string,
  preparedScenarios: readonly PreparedScenario[],
): Promise<void> => {
  const remoteCleanup = await Promise.allSettled(
    preparedScenarios.flatMap((prepared) =>
      prepared.github === undefined
        ? []
        : [
            cleanupGitHubMatrixFixture({
              lifecycle: prepared.github.fixtureLifecycle,
              program: prepared.github.program,
            }),
          ],
    ),
  );
  const runtimeRoots = [...new Set(preparedScenarios.map(({ paths }) => paths.runtimeRoot))];
  const localCleanup = await Promise.allSettled([
    ...runtimeRoots.map((root) => rm(root, { recursive: true, force: true })),
    rm(workspaceRoot, { recursive: true, force: true }),
  ]);
  const remaining = (
    await Promise.all(
      [...runtimeRoots, workspaceRoot].map(async (root) =>
        (await exists(root)) ? root : undefined,
      ),
    )
  ).filter((root) => root !== undefined);
  if (remaining.length > 0) {
    throw new Error(`Generation preflight cleanup left runtime roots: ${remaining.join(", ")}`);
  }
  const failures = [...remoteCleanup, ...localCleanup]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(({ reason }) => reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Generation preflight cleanup was incomplete.");
  }
};

export const discardLiveScenarioGenerationAdmission = async (input: {
  workspaceRoot: string;
  preparedScenarios: readonly PreparedScenario[];
}): Promise<void> =>
  discardPreparedScenarios(resolve(input.workspaceRoot), input.preparedScenarios);

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const skillTopologyReadback = async (prepared: VerifiedScenario): Promise<string> => {
  const skillRoot = join(prepared.paths.agentHome, "skill-directory");
  const actualNames = (await readdir(skillRoot)).filter((name) => name !== ".system").sort();
  const declaredNames = new Set<string>(
    prepared.scenario.fixedValidationFixture.skills.map(({ skill }) => skill),
  );
  const ambient = actualNames.filter((name) => !declaredNames.has(name));
  if (ambient.length > 0) {
    throw new Error(`Undeclared Skill is available: ${ambient.join(", ")}.`);
  }

  const topology = [];
  for (const declaration of prepared.scenario.fixedValidationFixture.skills) {
    const path = join(skillRoot, declaration.skill);
    const available = await exists(path);
    if (available !== liveScenarioSkillIsInstalled(declaration.role)) {
      throw new Error(
        `Declared ${declaration.role} Skill has the wrong availability: ${declaration.skill}.`,
      );
    }
    topology.push({
      ...declaration,
      state: available ? "available" : "absent",
      ...(available ? { identitySha256: await digestLiveScenarioFixture(path) } : {}),
    });
  }
  return sha256(`live-matrix-skills-v1\0${JSON.stringify(topology)}\n`);
};

const validatePrerequisiteSkillRoot = async (
  scenarios: readonly LiveScenario[],
  prerequisiteSkillRoot: string | undefined,
): Promise<LiveScenarioAdmissionDiagnostic | undefined> => {
  const requirements = scenarios.flatMap((scenario) =>
    scenario.fixedValidationFixture.skills
      .filter(({ skill, role }) => skill !== "bearing" && liveScenarioSkillIsInstalled(role))
      .map(({ skill }) => ({ scenarioId: scenario.id, skill })),
  );
  if (requirements.length === 0) return undefined;
  if (prerequisiteSkillRoot === undefined || !isAbsolute(prerequisiteSkillRoot)) {
    return diagnostic(
      "prerequisite-skill-unavailable",
      "Selected Scenarios require one explicit absolute prerequisite Skill root.",
      requirements[0]?.scenarioId,
    );
  }

  let root: string;
  try {
    root = await realpath(prerequisiteSkillRoot);
  } catch {
    return diagnostic(
      "prerequisite-skill-unavailable",
      "Prerequisite Skill root is unavailable.",
      requirements[0]?.scenarioId,
    );
  }
  for (const requirement of requirements) {
    try {
      const entrypoint = await realpath(join(root, requirement.skill, "SKILL.md"));
      const relation = relative(root, entrypoint);
      if (
        relation.startsWith("..") ||
        isAbsolute(relation) ||
        !(await lstat(entrypoint)).isFile()
      ) {
        throw new Error("invalid prerequisite Skill entrypoint");
      }
    } catch {
      return diagnostic(
        "prerequisite-skill-unavailable",
        `Declared prerequisite Skill is unavailable: ${requirement.skill}.`,
        requirement.scenarioId,
      );
    }
  }
  return undefined;
};

export type AdmittedLiveScenarioGeneration = Readonly<{
  outcome: "admitted";
  generationId: string;
  generationBasis: LiveMatrixGenerationBasis;
  workspaceRoot: string;
  preparedScenarios: readonly PreparedScenario[];
  agentBehaviorStarted: false;
  activeGenerationCreated: false;
  externalEffectsObserved: boolean;
}>;

export const prepareLiveScenarioGenerationAdmission = async (input: {
  sourceRoot: string;
  workspaceRoot: string;
  operatorCodexHome: string;
  registryPath: string;
  generationId: string;
  package: unknown;
  scenarioIds?: readonly string[];
  prerequisiteSkillRoot?: string;
  codexProgram?: string;
  githubCheckout?: string;
  githubProgram?: string;
}): Promise<AdmittedLiveScenarioGeneration | ReturnType<typeof blocked>> => {
  const startedAt = new Date().toISOString();
  let generationId: string;
  try {
    generationId = generationIdSchema.parse(input.generationId);
  } catch {
    return blocked(undefined, [
      diagnostic("invalid-generation", "Preflight requires one valid Generation identity."),
    ]);
  }

  let sourceRoot: string;
  try {
    sourceRoot = await realpath(resolve(input.sourceRoot));
  } catch {
    return blocked(generationId, [
      diagnostic("invalid-registry", "Preflight source root is unavailable."),
    ]);
  }

  let registryPath: string;
  let registry: Awaited<ReturnType<typeof loadLiveScenarioRegistry>>;
  try {
    registryPath = await realpath(resolve(sourceRoot, input.registryPath));
    await preflightLiveScenarioRegistry({
      sourceRoot,
      registryPath: relative(sourceRoot, registryPath),
    });
    registry = await loadLiveScenarioRegistry(registryPath);
  } catch (error) {
    return blocked(generationId, [
      diagnostic(
        "invalid-registry",
        error instanceof Error ? error.message : "Declarative registry preflight failed.",
      ),
    ]);
  }

  const selectedIds = input.scenarioIds ?? registry.scenarios.map(({ id }) => id);
  const selectedIdSet = new Set(selectedIds);
  if (
    selectedIds.length === 0 ||
    selectedIdSet.size !== selectedIds.length ||
    selectedIds.some((id) => !registry.scenarios.some((scenario) => scenario.id === id))
  ) {
    return blocked(generationId, [
      diagnostic("invalid-registry", "Selected Scenario identities must be unique and registered."),
    ]);
  }
  const scenarios = selectedIds.map(
    (id) => registry.scenarios.find((scenario) => scenario.id === id) as LiveScenario,
  );

  let matrixPackage: z.infer<typeof liveScenarioPackageSchema>;
  try {
    matrixPackage = liveScenarioPackageSchema.parse(input.package);
  } catch {
    return blocked(generationId, [
      diagnostic("invalid-package", "Preflight requires one exact Matrix package."),
    ]);
  }

  const prerequisiteDiagnostic = await validatePrerequisiteSkillRoot(
    scenarios,
    input.prerequisiteSkillRoot,
  );
  if (prerequisiteDiagnostic !== undefined) return blocked(generationId, [prerequisiteDiagnostic]);
  const missingGitHub = scenarios.find(
    ({ fixedValidationFixture }) =>
      fixedValidationFixture.capabilityProfile === "github-bounded-delivery" &&
      input.githubCheckout === undefined,
  );
  if (missingGitHub !== undefined) {
    return blocked(generationId, [
      diagnostic(
        "capability-unavailable",
        "GitHub bounded delivery requires the fixed validation checkout.",
        missingGitHub.id,
      ),
    ]);
  }

  const requestedWorkspaceRoot = resolve(input.workspaceRoot);
  let workspaceRoot: string;
  try {
    workspaceRoot = join(
      await realpath(dirname(requestedWorkspaceRoot)),
      basename(requestedWorkspaceRoot),
    );
    await ensureLiveScenarioCoordinatorWorkspace(sourceRoot, workspaceRoot);
  } catch (error) {
    return blocked(generationId, [
      diagnostic(
        "workspace-not-fresh",
        error instanceof Error ? error.message : "Generation workspace is unsafe or not fresh.",
      ),
    ]);
  }
  const preparedScenarios: PreparedScenario[] = [];
  try {
    await mkdir(workspaceRoot);
    await mkdir(join(workspaceRoot, "scenarios"));
  } catch {
    await rm(workspaceRoot, { recursive: true, force: true });
    return blocked(generationId, [
      diagnostic("workspace-not-fresh", "Generation workspace must be new and empty."),
    ]);
  }

  const failPrepared = async (
    code: DiagnosticCode,
    error: unknown,
    scenarioId?: string,
  ): Promise<ReturnType<typeof blocked>> => {
    const recoveredPrepared = await Promise.all(
      preparedScenarios.flatMap((prepared) =>
        prepared.github === undefined
          ? []
          : [
              recoverPreparedGitHubMatrixFixtureFailure({
                cause: error,
                lifecycle: prepared.github.fixtureLifecycle,
                program: prepared.github.program,
              }),
            ],
      ),
    );
    const runtimeRoots = [...new Set(preparedScenarios.map(({ paths }) => paths.runtimeRoot))];
    const localCleanup = await Promise.allSettled([
      ...runtimeRoots.map((root) => rm(root, { recursive: true, force: true })),
      rm(workspaceRoot, { recursive: true, force: true }),
    ]);
    const localCleanupFailures = localCleanup.filter(({ status }) => status === "rejected").length;
    const externalEffects = [
      githubMatrixFixturePreparationExternalEffect(error),
      ...recoveredPrepared.map((recovered) => recovered.externalEffect),
    ].filter((effect) => effect !== undefined);
    const message = error instanceof Error ? error.message : "Generation preflight failed.";
    const externalEffectReadback = externalEffects
      .map(
        (externalEffect) =>
          ` External-effect recovery: ${externalEffect.repositorySlug}, Generation ${externalEffect.generationId}, milestone ${externalEffect.milestoneNumber === null ? externalEffect.milestoneTitle : `#${externalEffect.milestoneNumber}`}, Issues ${externalEffect.issueNumbers.map((number) => `#${number}`).join(", ") || "none"}; cleanup ${externalEffect.cleanupOutcome}${externalEffect.unverifiedTargets.length === 0 ? "" : ` for ${externalEffect.unverifiedTargets.join(", ")}`}.`,
      )
      .join("");
    const localCleanupReadback =
      localCleanupFailures === 0
        ? ""
        : ` Local preflight cleanup left ${localCleanupFailures} unverified target(s).`;
    return blocked(
      generationId,
      [diagnostic(code, `${message}${externalEffectReadback}${localCleanupReadback}`, scenarioId)],
      externalEffects.length > 0,
    );
  };

  const modelHome = join(workspaceRoot, "model-readback-home");
  let codexProgram: string;
  try {
    codexProgram = await resolveCodexE2EProgram(input.codexProgram ?? "codex");
    await mkdir(modelHome);
    const modelCodexHome = await prepareIsolatedCodexHome({
      operatorCodexHome: resolve(input.operatorCodexHome),
      isolatedHome: modelHome,
    });
    await readCodexE2EModelAvailability({
      program: codexProgram,
      isolatedHome: modelHome,
      codexHome: modelCodexHome,
    });
    await rm(modelHome, { recursive: true, force: true });
  } catch (error) {
    return failPrepared("model-unavailable", error);
  }

  for (const scenario of scenarios) {
    try {
      preparedScenarios.push(
        await prepareLiveScenarioGeneration({
          sourceRoot,
          workspaceRoot: join(workspaceRoot, "scenarios", scenario.id),
          operatorCodexHome: resolve(input.operatorCodexHome),
          registryPath: relative(sourceRoot, registryPath),
          scenarioId: scenario.id,
          package: matrixPackage,
          generationId,
          deferPermissionProbe: true,
          ...(input.prerequisiteSkillRoot === undefined
            ? {}
            : { prerequisiteSkillRoot: input.prerequisiteSkillRoot }),
          codexProgram,
          ...(scenario.fixedValidationFixture.profile !== "active-github-repository"
            ? {}
            : {
                githubCheckout: input.githubCheckout,
                ...(input.githubProgram === undefined
                  ? {}
                  : { githubProgram: input.githubProgram }),
              }),
        }),
      );
    } catch (error) {
      return failPrepared("preparation-failed", error, scenario.id);
    }
  }

  const verifiedScenarios: VerifiedScenario[] = [];
  for (const prepared of preparedScenarios) {
    try {
      const verified = await verifyLiveScenarioGeneration(prepared.paths.manifest);
      const siblingRuntimeRoot = preparedScenarios.find(
        ({ paths }) => paths.runtimeRoot !== verified.paths.runtimeRoot,
      )?.paths.runtimeRoot;
      await probeCodexE2EPermissionProfile({
        launch: verified.launch,
        manifestPath: verified.paths.manifest,
        registryPath,
        sourceRoot,
        operatorCodexHome: verified.paths.operatorCodexHome,
        scenarioWorkspace: verified.paths.workspaceRoot,
        installationEntryPath: verified.paths.installationEntry,
        runtimeContainer: resolve(verified.paths.runtimeRoot, ".."),
        ...(siblingRuntimeRoot === undefined ? {} : { siblingRuntimeRoot }),
        toolchain: verified.toolchain,
        isProjectRepository: true,
        writeAllowedPaths:
          verified.scenario.fixedValidationFixture.profile === "fresh-installation-repository"
            ? [join(verified.paths.agentHome, ".agents/skills")]
            : [],
        effectiveEnvironment: createCodexJourneyEnvironment(
          process.env,
          verified.launch.environment,
          {
            includeCanonicalBearingBin:
              verified.scenario.fixedValidationFixture.profile !== "fresh-installation-repository",
          },
        ),
      });
      verifiedScenarios.push(verified);
    } catch (error) {
      return failPrepared("permission-failure", error, prepared.scenario.id);
    }
  }

  let preparedReadbacks: LiveMatrixPreparedScenarioReadback[];
  try {
    preparedReadbacks = await Promise.all(
      verifiedScenarios.map(async (prepared) => ({
        generationId,
        scenarioId: prepared.scenario.id,
        fixtureSha256: prepared.startingStateSha256,
        skillsSha256: await skillTopologyReadback(prepared),
        permissionOutcome: "passed" as const,
        ...(prepared.github === undefined
          ? {}
          : {
              githubBaselineSha256: prepared.github.baselineInventorySha256,
              githubFixture: {
                milestoneNumber: prepared.github.fixtureLifecycle.milestone.number,
                milestoneTitleSha256: createHash("sha256")
                  .update(prepared.github.fixtureLifecycle.milestone.title)
                  .digest("hex"),
                parentIssueNumber: prepared.github.fixtureLifecycle.parent.number,
                childIssueNumber: prepared.github.fixtureLifecycle.child.number,
              },
            }),
      })),
    );
  } catch (error) {
    return failPrepared("skill-topology-mismatch", error);
  }

  let generationBasis: LiveMatrixGenerationBasis;
  try {
    generationBasis = createLiveMatrixGenerationBasis({
      generationId,
      staticPreflight: "complete",
      package: {
        evidenceClass: matrixPackage.evidenceClass,
        identitySha256: liveScenarioMatrixPackageIdentitySha256(
          liveScenarioPackageEvidenceIdentity(matrixPackage),
        ),
      },
      registryDefinitionSha256: await liveScenarioDefinitionDigest({
        sourceRoot,
        registryPath: relative(sourceRoot, registryPath),
      }),
      fixtureDefinitionSha256: await digestLiveScenarioFixtureSet({
        sourceRoot,
        registry,
        scenarioIds: selectedIds,
      }),
      harnessIdentitySha256: await liveScenarioHarnessIdentitySha256({ sourceRoot }),
      startedAt,
      selectedScenarioIds: selectedIds,
      preparedScenarios: preparedReadbacks,
    });
  } catch (error) {
    return failPrepared("preparation-failed", error);
  }

  return Object.freeze({
    outcome: "admitted" as const,
    generationId,
    generationBasis,
    workspaceRoot,
    preparedScenarios: Object.freeze(preparedScenarios),
    agentBehaviorStarted: false as const,
    activeGenerationCreated: false as const,
    externalEffectsObserved: preparedScenarios.some(({ github }) => github !== undefined),
  });
};
