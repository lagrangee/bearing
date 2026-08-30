import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  prepareIsolatedCodexHome,
  probeCodexE2EPermissionProfile,
  readCodexE2EModelAvailability,
} from "./codex-e2e-runtime";
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
  loadLiveScenarioRegistry,
  preflightLiveScenarioRegistry,
} from "./live-scenario-registry";
import {
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
) =>
  Object.freeze({
    outcome: "preflight blocked" as const,
    ...(generationId === undefined ? {} : { generationId }),
    agentBehaviorStarted: false as const,
    activeGenerationCreated: false as const,
    externalEffectsObserved: false as const,
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
  const runtimeRoots = [...new Set(preparedScenarios.map(({ paths }) => paths.runtimeRoot))];
  await Promise.all(runtimeRoots.map((root) => rm(root, { recursive: true, force: true })));
  await rm(workspaceRoot, { recursive: true, force: true });
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
    prepared.scenario.composition.skills.map(({ skill }) => skill),
  );
  const ambient = actualNames.filter((name) => !declaredNames.has(name));
  if (ambient.length > 0) {
    throw new Error(`Undeclared Skill is available: ${ambient.join(", ")}.`);
  }

  const topology = [];
  for (const declaration of prepared.scenario.composition.skills) {
    const path = join(skillRoot, declaration.skill);
    const available = await exists(path);
    if (available !== (declaration.role === "prerequisite")) {
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
    scenario.composition.skills
      .filter(({ skill, role }) => skill !== "bearing" && role === "prerequisite")
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
  externalEffectsObserved: false;
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
    ({ composition }) =>
      composition.capabilityProfile === "github-bounded-delivery" &&
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

  const workspaceRoot = resolve(input.workspaceRoot);
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
    await discardPreparedScenarios(workspaceRoot, preparedScenarios);
    return blocked(generationId, [
      diagnostic(
        code,
        error instanceof Error ? error.message : "Generation preflight failed.",
        scenarioId,
      ),
    ]);
  };

  const modelHome = join(workspaceRoot, "model-readback-home");
  try {
    await mkdir(modelHome);
    const modelCodexHome = await prepareIsolatedCodexHome({
      operatorCodexHome: resolve(input.operatorCodexHome),
      isolatedHome: modelHome,
    });
    await readCodexE2EModelAvailability({
      program: input.codexProgram ?? "codex",
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
          ...(input.codexProgram === undefined ? {} : { codexProgram: input.codexProgram }),
          ...(scenario.composition.fixtureProfile !== "active-github-repository"
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
      await probeCodexE2EPermissionProfile({
        launch: verified.launch,
        manifestPath: verified.paths.manifest,
        registryPath,
        sourceRoot,
        operatorCodexHome: verified.paths.operatorCodexHome,
        scenarioWorkspace: verified.paths.workspaceRoot,
        installationEntryPath: verified.paths.installationEntry,
        runtimeIsolationRoot: resolve(verified.paths.runtimeRoot, ".."),
        writeAllowedPaths:
          verified.scenario.composition.fixtureProfile === "fresh-installation-repository"
            ? [join(verified.paths.agentHome, ".agents/skills")]
            : [],
      });
      verifiedScenarios.push(await verifyLiveScenarioGeneration(prepared.paths.manifest));
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
          : { githubBaselineSha256: prepared.github.baselineInventorySha256 }),
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
    externalEffectsObserved: false as const,
  });
};
