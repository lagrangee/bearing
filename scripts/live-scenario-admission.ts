import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import {
  CODEX_E2E_RUNTIME,
  prepareIsolatedCodexHome,
  probeCodexE2EPermissionProfile,
  readCodexE2EModelAvailability,
} from "./codex-e2e-runtime";
import { readFixedGitHubValidationRepository } from "./github-live-journey";
import { liveScenarioPackageSchema } from "./live-scenario-evidence";
import { liveScenarioPackageEvidenceIdentity } from "./live-scenario-generation";
import { liveScenarioHarnessIdentitySha256 } from "./live-scenario-generation-records";
import {
  digestLiveScenarioFixture,
  liveScenarioAgentSurfaceProfileSchema,
  liveScenarioCapabilityProfileSchema,
  liveScenarioFixtureProfileSchema,
  liveScenarioResourceKeySchema,
  liveScenarioSkillNameSchema,
  liveScenarioSkillRoleSchema,
  liveScenarioTimeProfileSchema,
  loadLiveScenarioRegistry,
  parseLiveScenarioRegistry,
} from "./live-scenario-registry";
import {
  liveScenarioDefinitionDigest,
  prepareLiveScenarioGeneration,
  verifyLiveScenarioGeneration,
} from "./live-scenario-runner";
import { sha256File } from "./release-digest";

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const generationIdSchema = z.string().uuid();
const scenarioIdSchema = z.string().regex(/^[A-Z]+-\d{2}$/u);

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const canonicalDigest = (label: string, value: unknown): string =>
  sha256(`${label}\0${JSON.stringify(value)}\n`);

const digestFiles = async (sourceRoot: string, locators: readonly string[]): Promise<string> =>
  canonicalDigest(
    "matrix-admission-files-v1",
    await Promise.all(
      locators.map(async (locator) => ({
        locator,
        sha256: await sha256File(join(sourceRoot, locator)),
      })),
    ),
  );

const admissionIdentitiesSchema = z
  .object({
    packageIdentitySha256: digestSchema,
    matrixDefinitionSha256: digestSchema,
    harnessIdentitySha256: digestSchema,
    fixtureDefinitionsSha256: digestSchema,
    matrixSkillSetSha256: digestSchema,
    agentSurfaceAdaptersSha256: digestSchema,
    capabilityAdaptersSha256: digestSchema,
    resourceDefinitionsSha256: digestSchema,
    executionConfigurationSha256: digestSchema,
  })
  .strict();

export type LiveScenarioAdmissionIdentities = z.infer<typeof admissionIdentitiesSchema>;

const skillReadbackSchema = z.discriminatedUnion("state", [
  z
    .object({
      skill: liveScenarioSkillNameSchema,
      role: liveScenarioSkillRoleSchema,
      state: z.literal("available"),
      contentIdentitySha256: digestSchema,
      entrypointIdentitySha256: digestSchema,
    })
    .strict(),
  z
    .object({
      skill: liveScenarioSkillNameSchema,
      role: liveScenarioSkillRoleSchema,
      state: z.literal("absent"),
    })
    .strict(),
]);

const compositionReadbackSchema = z
  .object({
    schemaVersion: z.literal(1),
    generationId: generationIdSchema,
    scenarioId: scenarioIdSchema,
    fixture: z
      .object({
        profile: liveScenarioFixtureProfileSchema,
        definitionsIdentitySha256: digestSchema,
        materializationIdentitySha256: digestSchema,
        startingStateSha256: digestSchema,
      })
      .strict(),
    skillTopology: z
      .object({
        skillSetIdentitySha256: digestSchema,
        observed: z.array(skillReadbackSchema),
      })
      .strict(),
    agentSurface: z
      .object({
        profile: liveScenarioAgentSurfaceProfileSchema,
        adaptersIdentitySha256: digestSchema,
        agentHomeIdentitySha256: digestSchema,
      })
      .strict(),
    capability: z
      .object({
        profile: liveScenarioCapabilityProfileSchema,
        adaptersIdentitySha256: digestSchema,
        resourceDefinitionsIdentitySha256: digestSchema,
        resourceKeys: z.array(liveScenarioResourceKeySchema),
        externalStartingStateSha256: digestSchema.optional(),
        available: z.boolean(),
      })
      .strict(),
    execution: z
      .object({
        model: z.literal(CODEX_E2E_RUNTIME.model),
        reasoningEffort: z.literal(CODEX_E2E_RUNTIME.reasoningEffort),
        timeProfile: liveScenarioTimeProfileSchema,
        configurationIdentitySha256: digestSchema,
        modelAvailable: z.boolean(),
      })
      .strict(),
    isolation: z
      .object({
        stateIdentitySha256: digestSchema,
        freshAgentHome: z.boolean(),
        coordinatorControlDenied: z.boolean(),
        siblingRuntimesDenied: z.boolean(),
        generalNetworkDenied: z.boolean(),
      })
      .strict(),
    priorState: z
      .object({
        session: z.boolean(),
        transcript: z.boolean(),
        agentDecision: z.boolean(),
        result: z.boolean(),
      })
      .strict(),
  })
  .strict();

type CompositionReadback = z.infer<typeof compositionReadbackSchema>;

const admissionBasisValueSchema = z
  .object({
    schemaVersion: z.literal(1),
    matrixCompositionSha256: digestSchema,
    identities: admissionIdentitiesSchema,
  })
  .strict();
const admissionBasisSchema = admissionBasisValueSchema
  .extend({ identitySha256: digestSchema })
  .strict();
export type LiveScenarioAdmissionBasis = z.infer<typeof admissionBasisSchema>;

const admittedGenerationSchema = z
  .object({
    outcome: z.literal("admitted"),
    generationId: generationIdSchema,
    basis: admissionBasisSchema,
    basisVerification: z.enum(["fresh", "reused"]),
    compositionReadbacks: z.array(
      z.object({ scenarioId: scenarioIdSchema, identitySha256: digestSchema }).strict(),
    ),
    admissionIdentitySha256: digestSchema,
    agentBehaviorStarted: z.literal(false),
    activeGenerationCreated: z.literal(false),
    externalEffectsObserved: z.literal(false),
  })
  .strict();

export type AdmittedLiveScenarioGeneration = z.infer<typeof admittedGenerationSchema>;
export const parseAdmittedLiveScenarioGeneration = (
  input: unknown,
): AdmittedLiveScenarioGeneration => admittedGenerationSchema.parse(input);

type DiagnosticCode =
  | "ambient-skill"
  | "capability-unavailable"
  | "invalid-readback"
  | "invalid-registry"
  | "invalid-reusable-basis"
  | "isolation-readback-mismatch"
  | "missing-identity"
  | "model-unavailable"
  | "readback-mismatch"
  | "reused-runtime-state"
  | "skill-topology-mismatch"
  | "stale-readback"
  | "undeclared-resource";

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

const createBasis = (
  matrixCompositionSha256: string,
  identities: LiveScenarioAdmissionIdentities,
): LiveScenarioAdmissionBasis => {
  const value = admissionBasisValueSchema.parse({
    schemaVersion: 1,
    matrixCompositionSha256,
    identities,
  });
  return admissionBasisSchema.parse({
    ...value,
    identitySha256: canonicalDigest("matrix-admission-basis-v1", value),
  });
};

const parseReusableBasis = (input: unknown): LiveScenarioAdmissionBasis => {
  const basis = admissionBasisSchema.parse(input);
  const { identitySha256, ...value } = basis;
  if (identitySha256 !== canonicalDigest("matrix-admission-basis-v1", value)) {
    throw new Error("Reusable Matrix Admission Basis identity mismatch.");
  }
  return basis;
};

const allUnique = (values: readonly string[]): boolean => new Set(values).size === values.length;

const admitTrustedReadbacks = (
  input: Readonly<{
    generationId: string;
    registry: Awaited<ReturnType<typeof loadLiveScenarioRegistry>>;
    identities: LiveScenarioAdmissionIdentities;
    readbacks: readonly CompositionReadback[];
    reusableBasis?: unknown;
  }>,
) => {
  const basis = createBasis(
    canonicalDigest(
      "matrix-composition-v1",
      input.registry.scenarios.map(({ id, fixture, composition }) => ({
        id,
        fixture,
        composition,
      })),
    ),
    input.identities,
  );
  let reusableBasis: LiveScenarioAdmissionBasis | undefined;
  if (input.reusableBasis !== undefined) {
    try {
      reusableBasis = parseReusableBasis(input.reusableBasis);
    } catch {
      return blocked(input.generationId, [
        diagnostic("invalid-reusable-basis", "Reusable Admission Basis identity is invalid."),
      ]);
    }
  }

  const diagnostics: LiveScenarioAdmissionDiagnostic[] = [];
  const expectedIds = input.registry.scenarios.map(({ id }) => id);
  const readbackIds = input.readbacks.map(({ scenarioId }) => scenarioId);
  if (
    readbackIds.length !== expectedIds.length ||
    !allUnique(readbackIds) ||
    expectedIds.some((id) => !readbackIds.includes(id))
  ) {
    diagnostics.push(
      diagnostic(
        "readback-mismatch",
        "Admission requires one fresh readback per registered Scenario.",
      ),
    );
  }

  for (const scenario of input.registry.scenarios) {
    const readback = input.readbacks.find(({ scenarioId }) => scenarioId === scenario.id);
    if (readback === undefined) continue;
    if (readback.generationId !== input.generationId) {
      diagnostics.push(
        diagnostic("stale-readback", "Readback belongs to another Generation.", scenario.id),
      );
      continue;
    }
    if (
      readback.fixture.profile !== scenario.composition.fixtureProfile ||
      readback.fixture.definitionsIdentitySha256 !== input.identities.fixtureDefinitionsSha256 ||
      readback.skillTopology.skillSetIdentitySha256 !== input.identities.matrixSkillSetSha256 ||
      readback.agentSurface.profile !== scenario.composition.agentSurfaceProfile ||
      readback.agentSurface.adaptersIdentitySha256 !==
        input.identities.agentSurfaceAdaptersSha256 ||
      readback.capability.profile !== scenario.composition.capabilityProfile ||
      readback.capability.adaptersIdentitySha256 !== input.identities.capabilityAdaptersSha256 ||
      readback.capability.resourceDefinitionsIdentitySha256 !==
        input.identities.resourceDefinitionsSha256 ||
      readback.execution.configurationIdentitySha256 !==
        input.identities.executionConfigurationSha256 ||
      readback.execution.model !== scenario.composition.model ||
      readback.execution.reasoningEffort !== scenario.composition.reasoningEffort ||
      readback.execution.timeProfile !== scenario.composition.timeProfile
    ) {
      diagnostics.push(
        diagnostic("readback-mismatch", "Readback contradicts declared Composition.", scenario.id),
      );
    }

    const declaredSkills = new Map(
      scenario.composition.skills.map(({ skill, role }) => [skill, role] as const),
    );
    const observedSkills = new Map(
      readback.skillTopology.observed.map(
        (observation) => [observation.skill, observation] as const,
      ),
    );
    for (const observed of readback.skillTopology.observed) {
      if (!declaredSkills.has(observed.skill)) {
        diagnostics.push(
          diagnostic(
            "ambient-skill",
            `Undeclared Skill is available: ${observed.skill}.`,
            scenario.id,
          ),
        );
      }
    }
    for (const [skill, role] of declaredSkills) {
      const observed = observedSkills.get(skill);
      const expectedState = role === "prerequisite" ? "available" : "absent";
      if (observed === undefined || observed.role !== role || observed.state !== expectedState) {
        diagnostics.push(
          diagnostic(
            "skill-topology-mismatch",
            `Readback contradicts the declared ${role} Skill: ${skill}.`,
            scenario.id,
          ),
        );
      }
    }

    const declaredResources = scenario.composition.resourceKeys;
    if (readback.capability.resourceKeys.some((key) => !declaredResources.includes(key))) {
      diagnostics.push(
        diagnostic(
          "undeclared-resource",
          "Readback exposed an undeclared Resource Key.",
          scenario.id,
        ),
      );
    } else if (
      readback.capability.resourceKeys.length !== declaredResources.length ||
      declaredResources.some((key) => !readback.capability.resourceKeys.includes(key))
    ) {
      diagnostics.push(
        diagnostic("readback-mismatch", "Readback omitted a declared Resource Key.", scenario.id),
      );
    }
    if (!readback.capability.available) {
      diagnostics.push(
        diagnostic("capability-unavailable", "Declared capability is unavailable.", scenario.id),
      );
    }
    if (!readback.execution.modelAvailable) {
      diagnostics.push(
        diagnostic("model-unavailable", "Exact model and effort are unavailable.", scenario.id),
      );
    }
    if (Object.values(readback.priorState).some(Boolean)) {
      diagnostics.push(
        diagnostic(
          "reused-runtime-state",
          "Fresh runtime contains prior behavior state.",
          scenario.id,
        ),
      );
    }
    if (Object.values(readback.isolation).some((value) => value === false)) {
      diagnostics.push(
        diagnostic("isolation-readback-mismatch", "Isolation baseline is incomplete.", scenario.id),
      );
    }
  }

  for (const identities of [
    input.readbacks.map(({ agentSurface }) => agentSurface.agentHomeIdentitySha256),
    input.readbacks.map(({ isolation }) => isolation.stateIdentitySha256),
  ]) {
    if (!allUnique(identities)) {
      diagnostics.push(
        diagnostic(
          "reused-runtime-state",
          "Scenario Agent home and isolation identities must be unique.",
        ),
      );
      break;
    }
  }
  const externalBaselines = input.readbacks.flatMap(({ capability }) =>
    capability.externalStartingStateSha256 === undefined
      ? []
      : [capability.externalStartingStateSha256],
  );
  if (!allUnique(externalBaselines)) {
    diagnostics.push(
      diagnostic("reused-runtime-state", "External capability baselines must be fresh."),
    );
  }
  if (diagnostics.length > 0) return blocked(input.generationId, diagnostics);

  const compositionReadbacks = input.readbacks.map((readback) => ({
    scenarioId: readback.scenarioId,
    identitySha256: canonicalDigest("matrix-composition-readback-v1", readback),
  }));
  const value = {
    outcome: "admitted" as const,
    generationId: input.generationId,
    basis,
    basisVerification:
      reusableBasis?.identitySha256 === basis.identitySha256
        ? ("reused" as const)
        : ("fresh" as const),
    compositionReadbacks,
    agentBehaviorStarted: false as const,
    activeGenerationCreated: false as const,
    externalEffectsObserved: false as const,
  };
  return admittedGenerationSchema.parse({
    ...value,
    admissionIdentitySha256: canonicalDigest("matrix-admission-v1", value),
  });
};

export const validateLiveScenarioAdmissionReadbacks = (
  input: Readonly<{
    generationId: unknown;
    registry: unknown;
    identities: unknown;
    compositionReadbacks: unknown;
    reusableBasis?: unknown;
  }>,
) => {
  let generationId: string;
  try {
    generationId = generationIdSchema.parse(input.generationId);
  } catch {
    return Object.freeze({
      outcome: "preflight blocked" as const,
      agentBehaviorStarted: false as const,
      activeGenerationCreated: false as const,
      externalEffectsObserved: false as const,
      diagnostics: Object.freeze([
        diagnostic("missing-identity", "Admission requires one valid Generation identity."),
      ]),
    });
  }
  let registry: ReturnType<typeof parseLiveScenarioRegistry>;
  try {
    registry = parseLiveScenarioRegistry(input.registry);
  } catch {
    return blocked(generationId, [
      diagnostic("invalid-registry", "Admission requires one valid declarative registry."),
    ]);
  }
  let identities: LiveScenarioAdmissionIdentities;
  try {
    identities = admissionIdentitiesSchema.parse(input.identities);
  } catch {
    return blocked(generationId, [
      diagnostic("missing-identity", "Admission requires every exact basis identity."),
    ]);
  }
  let readbacks: readonly CompositionReadback[];
  try {
    readbacks = z.array(compositionReadbackSchema).parse(input.compositionReadbacks);
  } catch {
    return blocked(generationId, [
      diagnostic("invalid-readback", "Composition Readbacks are invalid or incomplete."),
    ]);
  }
  return admitTrustedReadbacks({
    generationId,
    registry,
    identities,
    readbacks,
    ...(input.reusableBasis === undefined ? {} : { reusableBasis: input.reusableBasis }),
  });
};

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
};

type PreparedScenario = Awaited<ReturnType<typeof prepareLiveScenarioGeneration>>;
type VerifiedScenario = Awaited<ReturnType<typeof verifyLiveScenarioGeneration>>;

const discardPreparedScenarios = async (
  workspaceRoot: string,
  preparedScenarios: readonly PreparedScenario[],
): Promise<void> => {
  const runtimeRoots = [...new Set(preparedScenarios.map(({ paths }) => paths.runtimeRoot))];
  await Promise.all(runtimeRoots.map((root) => rm(root, { recursive: true, force: true })));
  await rm(workspaceRoot, { recursive: true, force: true });
  const roots = [...runtimeRoots, workspaceRoot];
  const remaining = (
    await Promise.all(roots.map(async (root) => ((await exists(root)) ? root : undefined)))
  ).filter((root) => root !== undefined);
  if (remaining.length > 0) {
    throw new Error(`Generation Admission cleanup left runtime roots: ${remaining.join(", ")}`);
  }
};

export const discardLiveScenarioGenerationAdmission = async (input: {
  workspaceRoot: string;
  preparedScenarios: readonly PreparedScenario[];
}): Promise<void> =>
  discardPreparedScenarios(resolve(input.workspaceRoot), input.preparedScenarios);

const createSkillReadback = async (prepared: VerifiedScenario) => {
  const actualEntries = await readdir(join(prepared.paths.agentHome, "skill-directory"));
  const declared = new Map<string, z.infer<typeof liveScenarioSkillRoleSchema>>(
    prepared.scenario.composition.skills.map((value) => [value.skill, value.role] as const),
  );
  const ambient = actualEntries.filter((skill) => !declared.has(skill));
  const observations = [];
  for (const declaration of prepared.scenario.composition.skills) {
    const path = join(prepared.paths.agentHome, "skill-directory", declaration.skill);
    if (await exists(path)) {
      observations.push({
        ...declaration,
        state: "available" as const,
        contentIdentitySha256: await digestLiveScenarioFixture(path),
        entrypointIdentitySha256: await sha256File(join(path, "SKILL.md")),
      });
    } else observations.push({ ...declaration, state: "absent" as const });
  }
  return { observations, ambient } as const;
};

const createCapabilityReadback = async (input: {
  generationId: string;
  prepared: VerifiedScenario;
  adaptersIdentitySha256: string;
  resourceDefinitionsIdentitySha256: string;
}) => {
  const { scenario } = input.prepared;
  if (scenario.composition.capabilityProfile === "github-bounded-delivery") {
    const baseline = input.prepared.paths.baselineInventory;
    const available =
      input.prepared.github !== undefined && baseline !== undefined && (await exists(baseline));
    return {
      profile: scenario.composition.capabilityProfile,
      adaptersIdentitySha256: input.adaptersIdentitySha256,
      resourceDefinitionsIdentitySha256: input.resourceDefinitionsIdentitySha256,
      resourceKeys: [...scenario.composition.resourceKeys],
      externalStartingStateSha256: canonicalDigest("matrix-external-baseline-v1", {
        generationId: input.generationId,
        scenarioId: scenario.id,
        github: input.prepared.github,
        baselineSha256:
          baseline === undefined || !(await exists(baseline)) ? null : await sha256File(baseline),
      }),
      available,
    } as const;
  }
  if (scenario.composition.capabilityProfile === "bounded-local-npm-update") {
    const configuration = join(
      input.prepared.paths.runtimeRoot,
      "bounded-update-capability/config.json",
    );
    const npm = join(input.prepared.paths.agentHome, ".bearing/bin/npm");
    const available = (await exists(configuration)) && (await exists(npm));
    return {
      profile: scenario.composition.capabilityProfile,
      adaptersIdentitySha256: input.adaptersIdentitySha256,
      resourceDefinitionsIdentitySha256: input.resourceDefinitionsIdentitySha256,
      resourceKeys: [...scenario.composition.resourceKeys],
      externalStartingStateSha256: canonicalDigest("matrix-external-baseline-v1", {
        generationId: input.generationId,
        scenarioId: scenario.id,
        configurationSha256: available ? await sha256File(configuration) : null,
      }),
      available,
    } as const;
  }
  return {
    profile: scenario.composition.capabilityProfile,
    adaptersIdentitySha256: input.adaptersIdentitySha256,
    resourceDefinitionsIdentitySha256: input.resourceDefinitionsIdentitySha256,
    resourceKeys: [...scenario.composition.resourceKeys],
    available: true,
  } as const;
};

export const prepareLiveScenarioGenerationAdmission = async (input: {
  sourceRoot: string;
  workspaceRoot: string;
  operatorCodexHome: string;
  registryPath: string;
  generationId: string;
  package: unknown;
  generationEvidenceRoot: string;
  codexProgram?: string;
  githubCheckout?: string;
  githubProgram?: string;
  reusableBasis?: unknown;
}) => {
  let generationId: string;
  try {
    generationId = generationIdSchema.parse(input.generationId);
  } catch {
    return blocked(undefined, [
      diagnostic("missing-identity", "Admission requires one valid Generation identity."),
    ]);
  }
  let sourceRoot: string;
  try {
    sourceRoot = await realpath(resolve(input.sourceRoot));
  } catch (error) {
    return blocked(generationId, [
      diagnostic(
        "invalid-readback",
        error instanceof Error ? error.message : "Admission source root is unavailable.",
      ),
    ]);
  }
  const workspaceRoot = resolve(input.workspaceRoot);
  let registryPath: string;
  let registry: Awaited<ReturnType<typeof loadLiveScenarioRegistry>>;
  try {
    registryPath = await realpath(resolve(sourceRoot, input.registryPath));
    registry = await loadLiveScenarioRegistry(registryPath);
  } catch {
    return blocked(generationId, [
      diagnostic("invalid-registry", "Admission requires one valid declarative registry."),
    ]);
  }
  let matrixPackage: z.infer<typeof liveScenarioPackageSchema>;
  try {
    matrixPackage = liveScenarioPackageSchema.parse(input.package);
  } catch {
    return blocked(generationId, [
      diagnostic("missing-identity", "Admission requires one exact package identity."),
    ]);
  }
  let harnessIdentitySha256: string;
  try {
    harnessIdentitySha256 = await liveScenarioHarnessIdentitySha256({ sourceRoot });
  } catch {
    return blocked(generationId, [
      diagnostic("missing-identity", "Admission requires one exact Harness identity."),
    ]);
  }
  const preparedScenarios: PreparedScenario[] = [];
  let workspaceCreated = false;
  try {
    await mkdir(workspaceRoot);
    workspaceCreated = true;
    await mkdir(join(workspaceRoot, "scenarios"));
  } catch {
    if (workspaceCreated) await rm(workspaceRoot, { recursive: true, force: true });
    return blocked(generationId, [
      diagnostic("reused-runtime-state", "Generation workspace must be new and empty."),
    ]);
  }

  try {
    const modelHome = join(workspaceRoot, "model-readback-home");
    await mkdir(modelHome);
    const modelCodexHome = await prepareIsolatedCodexHome({
      operatorCodexHome: resolve(input.operatorCodexHome),
      isolatedHome: modelHome,
    });
    let modelReadback: Awaited<ReturnType<typeof readCodexE2EModelAvailability>>;
    try {
      modelReadback = await readCodexE2EModelAvailability({
        program: input.codexProgram ?? "codex",
        isolatedHome: modelHome,
        codexHome: modelCodexHome,
      });
    } catch (error) {
      await discardPreparedScenarios(workspaceRoot, preparedScenarios);
      return blocked(generationId, [
        diagnostic(
          "model-unavailable",
          error instanceof Error ? error.message : "Exact Matrix model and effort are unavailable.",
        ),
      ]);
    }
    await rm(modelHome, { recursive: true, force: true });
    if (await exists(modelHome)) {
      throw new Error("Model availability readback home remained after its receipt was sealed.");
    }
    const missingCapability = registry.scenarios.find(
      ({ composition }) =>
        composition.capabilityProfile === "github-bounded-delivery" &&
        input.githubCheckout === undefined,
    );
    if (missingCapability !== undefined) {
      await discardPreparedScenarios(workspaceRoot, preparedScenarios);
      return blocked(generationId, [
        diagnostic(
          "capability-unavailable",
          "GitHub bounded delivery requires one fixed validation checkout.",
          missingCapability.id,
        ),
      ]);
    }
    for (const scenario of registry.scenarios) {
      preparedScenarios.push(
        await prepareLiveScenarioGeneration({
          sourceRoot,
          workspaceRoot: join(workspaceRoot, "scenarios", scenario.id),
          operatorCodexHome: resolve(input.operatorCodexHome),
          registryPath: relative(sourceRoot, registryPath),
          scenarioId: scenario.id,
          package: matrixPackage,
          generationId,
          generationEvidenceRoot: resolve(input.generationEvidenceRoot),
          deferPermissionProbe: true,
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
    }

    const verificationOutcomes = await Promise.allSettled(
      preparedScenarios.map(async (prepared) => {
        const verified = await verifyLiveScenarioGeneration(prepared.paths.manifest);
        const siblingRuntimeRoots = preparedScenarios
          .map(({ paths }) => paths.runtimeRoot)
          .filter((runtimeRoot) => runtimeRoot !== prepared.paths.runtimeRoot);
        const scenarioContainer = dirname(prepared.paths.workspaceRoot);
        const operatorCodexHome = verified.paths.operatorCodexHome;
        const readDeniedPaths = [
          sourceRoot,
          registryPath,
          scenarioContainer,
          resolve(input.generationEvidenceRoot),
          operatorCodexHome,
          ...siblingRuntimeRoots,
        ];
        await probeCodexE2EPermissionProfile({
          program: verified.launch.initial.program,
          repositoryRoot: verified.paths.repository,
          isolatedHome: verified.paths.agentHome,
          codexHome: verified.launch.environment.CODEX_HOME,
          manifestPath: verified.paths.manifest,
          registryPath,
          sourceRoot,
          operatorCodexHome,
          scenarioWorkspace: verified.paths.workspaceRoot,
          installationEntryPath: verified.paths.installationEntry,
          readDeniedPaths,
          writeAllowedPaths:
            verified.scenario.composition.fixtureProfile === "fresh-installation-repository"
              ? [join(verified.paths.agentHome, ".agents/skills")]
              : [],
        });
        return verifyLiveScenarioGeneration(prepared.paths.manifest);
      }),
    );
    const failedVerification = verificationOutcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    if (failedVerification !== undefined) throw failedVerification.reason;
    const verifiedScenarios = verificationOutcomes.map((outcome) => {
      if (outcome.status !== "fulfilled") {
        throw new Error("Matrix verification settlement is inconsistent.");
      }
      return outcome.value;
    });

    const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
      sourceRoot,
      registryPath: relative(sourceRoot, registryPath),
    });
    const fixtureDefinitionsSha256 = await digestLiveScenarioFixture(
      join(sourceRoot, "validation/live-journey/fixtures"),
    );
    const agentSurfaceAdaptersSha256 = await digestFiles(sourceRoot, [
      "scripts/codex-e2e-runtime.ts",
    ]);
    const capabilityAdaptersSha256 = await digestFiles(sourceRoot, [
      "scripts/g1-local-npm-capability.mjs",
      "scripts/github-live-journey.ts",
      "scripts/live-scenario-runner.ts",
    ]);
    const requiresGitHubResource = registry.scenarios.some(({ composition }) =>
      composition.resourceKeys.includes("github-validation-repository"),
    );
    const resourceDefinitionsSha256 = requiresGitHubResource
      ? canonicalDigest(
          "matrix-resource-definitions-v1",
          await readFixedGitHubValidationRepository(sourceRoot),
        )
      : canonicalDigest("matrix-resource-definitions-v1", []);
    const skillReadbacks = await Promise.all(verifiedScenarios.map(createSkillReadback));
    const ambientSkills = skillReadbacks.flatMap(({ ambient }, index) =>
      ambient.map((skill) => ({ scenarioId: verifiedScenarios[index]?.scenario.id, skill })),
    );
    if (ambientSkills.length > 0) {
      await discardPreparedScenarios(workspaceRoot, preparedScenarios);
      return blocked(
        generationId,
        ambientSkills.map(({ scenarioId, skill }) =>
          diagnostic("ambient-skill", `Undeclared Skill is available: ${skill}.`, scenarioId),
        ),
      );
    }
    const matrixSkillSetSha256 = canonicalDigest(
      "matrix-skill-set-v1",
      skillReadbacks.map(({ observations }) => observations),
    );
    const executionConfigurationSha256 = canonicalDigest("matrix-execution-v1", {
      runtime: CODEX_E2E_RUNTIME,
      modelCatalogIdentitySha256: modelReadback.catalogIdentitySha256,
      scenarios: registry.scenarios.map(({ id, composition }) => ({
        id,
        model: composition.model,
        reasoningEffort: composition.reasoningEffort,
        timeProfile: composition.timeProfile,
      })),
    });
    const identities = admissionIdentitiesSchema.parse({
      packageIdentitySha256: canonicalDigest(
        "matrix-package-v1",
        liveScenarioPackageEvidenceIdentity(matrixPackage),
      ),
      matrixDefinitionSha256,
      harnessIdentitySha256,
      fixtureDefinitionsSha256,
      matrixSkillSetSha256,
      agentSurfaceAdaptersSha256,
      capabilityAdaptersSha256,
      resourceDefinitionsSha256,
      executionConfigurationSha256,
    });
    if (harnessIdentitySha256 !== (await liveScenarioHarnessIdentitySha256({ sourceRoot }))) {
      await discardPreparedScenarios(workspaceRoot, preparedScenarios);
      return blocked(generationId, [
        diagnostic("invalid-readback", "Matrix Harness identity changed during Admission."),
      ]);
    }
    const readbacks = await Promise.all(
      verifiedScenarios.map(async (prepared, index) => {
        const scenario = prepared.scenario;
        const [observations, attempts, transcripts, session] = await Promise.all([
          readdir(prepared.paths.observations),
          readdir(prepared.paths.attempts),
          readdir(prepared.paths.transcripts),
          exists(prepared.paths.sessionState),
        ]);
        return compositionReadbackSchema.parse({
          schemaVersion: 1,
          generationId,
          scenarioId: scenario.id,
          fixture: {
            profile: scenario.composition.fixtureProfile,
            definitionsIdentitySha256: fixtureDefinitionsSha256,
            materializationIdentitySha256: canonicalDigest("matrix-fixture-materialization-v1", {
              generationId,
              scenarioId: scenario.id,
              repository: await realpath(prepared.paths.repository),
              startingStateSha256: prepared.startingStateSha256,
            }),
            startingStateSha256: prepared.startingStateSha256,
          },
          skillTopology: {
            skillSetIdentitySha256: matrixSkillSetSha256,
            observed: skillReadbacks[index]?.observations ?? [],
          },
          agentSurface: {
            profile: scenario.composition.agentSurfaceProfile,
            adaptersIdentitySha256: agentSurfaceAdaptersSha256,
            agentHomeIdentitySha256: canonicalDigest("matrix-agent-home-v1", {
              generationId,
              scenarioId: scenario.id,
              path: await realpath(prepared.paths.agentHome),
              topologySha256: await digestLiveScenarioFixture(prepared.paths.agentHome),
              operatorContextFingerprint: prepared.operatorContextFingerprint,
            }),
          },
          capability: await createCapabilityReadback({
            generationId,
            prepared,
            adaptersIdentitySha256: capabilityAdaptersSha256,
            resourceDefinitionsIdentitySha256: resourceDefinitionsSha256,
          }),
          execution: {
            model: scenario.composition.model,
            reasoningEffort: scenario.composition.reasoningEffort,
            timeProfile: scenario.composition.timeProfile,
            configurationIdentitySha256: executionConfigurationSha256,
            modelAvailable: true,
          },
          isolation: {
            stateIdentitySha256: canonicalDigest("matrix-isolation-v1", {
              generationId,
              scenarioId: scenario.id,
              launch: prepared.launch,
              runtimeRoot: prepared.paths.runtimeRoot,
              deniedRuntimeRoots: preparedScenarios
                .map(({ paths }) => paths.runtimeRoot)
                .filter((runtimeRoot) => runtimeRoot !== prepared.paths.runtimeRoot),
            }),
            freshAgentHome: true,
            coordinatorControlDenied: true,
            siblingRuntimesDenied: true,
            generalNetworkDenied: true,
          },
          priorState: {
            session,
            transcript: transcripts.length > 0,
            agentDecision: observations.length > 0,
            result: attempts.length > 0,
          },
        });
      }),
    );
    const admission = validateLiveScenarioAdmissionReadbacks({
      generationId,
      registry,
      identities,
      compositionReadbacks: readbacks,
      ...(input.reusableBasis === undefined ? {} : { reusableBasis: input.reusableBasis }),
    });
    if (admission.outcome !== "admitted") {
      await discardPreparedScenarios(workspaceRoot, preparedScenarios);
      return admission;
    }
    return Object.freeze({
      ...admission,
      workspaceRoot,
      preparedScenarios: Object.freeze(preparedScenarios),
    });
  } catch (error) {
    await discardPreparedScenarios(workspaceRoot, preparedScenarios);
    return blocked(generationId, [
      diagnostic(
        "invalid-readback",
        error instanceof Error ? error.message : "Matrix Composition Readback failed.",
      ),
    ]);
  }
};
