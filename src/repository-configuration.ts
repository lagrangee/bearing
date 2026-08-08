import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import packageMetadata from "../package.json";
import { AGENT_SURFACES, agentSurfaceEntryFile, bearingManagedRange } from "./agent-surface-entry";
import { readCatalogState } from "./catalog/store";
import { inspectInstallPath } from "./install-boundary";
import { pointsToMattContractLocator } from "./matt-agent-surface";
import { readContainedFile, resolveRepositoryRoot } from "./path-boundary";
import { PROJECT_SNAPSHOT_VERSION } from "./project-snapshot/schema";
import { decodeMattProviderConfiguration } from "./provider-configuration";
import { validateMattSkillsV1Contract } from "./providers/matt-skills-v1";
import type { ReconcileRepositoryResult } from "./reconcile-repository";
import { reconcileRepository } from "./reconcile-repository";
import type { RepositoryLifecycleResult } from "./repo-lifecycle";
import { deactivateRepository } from "./repo-lifecycle";
import { inspectRepositoryIntegrationLifecycle } from "./repository-integration-lifecycle";
import {
  captureRepositoryTargetPreconditions,
  planRepositoryIntegration,
  type RepositoryIntegrationBlocker,
  type RepositoryTargetPrecondition,
} from "./repository-integration-plan";
import { repositoryManifestSchema } from "./schema-definitions";
import type { AgentSurface, ExecutorRegistration } from "./types";

export type RepositoryConfigurationIntent = "activate" | "deactivate";
export type RepositoryExecutorDecision = "skip" | "configure";

export type RepositoryConfigurationRequest = Readonly<{
  repoRoot: string;
  packageRoot: string;
  homeDir: string;
  intent: RepositoryConfigurationIntent;
  surfaces?: readonly AgentSurface[];
  provider?: Readonly<{
    key: "matt-skills/v1";
    contractLocator: string;
  }>;
  executorDecision?: RepositoryExecutorDecision;
  registrations?: readonly ExecutorRegistration[];
  retainProfiles?: readonly string[];
  removeProfiles?: readonly string[];
}>;

type CurrentSelections = Readonly<{
  surfaces: readonly AgentSurface[];
  provider?: Readonly<{ key: "matt-skills/v1"; contractLocator: string }>;
  executorProfiles: readonly string[];
}>;

type PathFact = Readonly<{
  target: string;
  kind: "missing" | "file" | "directory" | "symbolic-link";
  safe: boolean;
}>;

export type RepositoryConfigurationInspection = Readonly<{
  schemaVersion: 1;
  command: "configure-inspect";
  repositoryRoot: string;
  lifecycle: Readonly<{
    state: "fresh" | "active" | "deactivated" | "unsupported";
    reason: string;
    removalRequired: boolean;
  }>;
  currentSelections: CurrentSelections;
  installedCapabilityEvidence: Readonly<{
    packageVersion: string;
    packageRoot: string;
    providerContract: "not-configured" | "supported" | "unsupported";
    managedPointers: Readonly<Record<AgentSurface, "present" | "absent" | "unsafe">>;
  }>;
  pathSafety: Readonly<{
    safe: boolean;
    targets: readonly PathFact[];
  }>;
  machineFacts: Readonly<{
    manifest: "missing" | "active" | "deactivated" | "unsupported";
    cache: "missing" | "directory" | "unsafe";
    catalog: "ready" | "unavailable";
  }>;
}>;

export type RepositoryConfigurationPlan = Readonly<{
  schemaVersion: 1;
  command: "configure-plan";
  repositoryRoot: string;
  intent: RepositoryConfigurationIntent;
  lifecycle: RepositoryConfigurationInspection["lifecycle"];
  acceptedDesiredConfiguration: Readonly<{
    surfaces: readonly AgentSurface[];
    provider?: Readonly<{ key: "matt-skills/v1"; contractLocator: string }>;
    executorDecision?: RepositoryExecutorDecision;
    registrations: readonly ExecutorRegistration[];
    retainProfiles: readonly string[];
    removeProfiles: readonly string[];
  }>;
  unresolvedChoices: readonly ("agent-surfaces" | "provider" | "executor")[];
  canApply: boolean;
  blockers: readonly RepositoryIntegrationBlocker[];
  repositoryApplyUnit: Readonly<{
    owner: "bearing-repository-configuration";
    atomic: true;
    rollback: "restore-previous-repository-bytes";
    targets: readonly string[];
    preconditions: readonly RepositoryTargetPrecondition[];
  }>;
  preservationEffects: readonly string[];
  catalogStage: Readonly<{
    owner: "bearing-project-catalog";
    action: "upsert" | "unregister";
    order: "after-repository-validation";
    rollback: "independent";
  }>;
  sealedPlanToken?: string;
}>;

export type PortalHandoff =
  | Readonly<{ state: "compatible"; origin: string; projectUrl: string }>
  | Readonly<{
      state: "incompatible";
      origin: string;
      guidance: "stop-host-and-start-current-kit";
    }>
  | Readonly<{
      state: "absent";
      origin: string;
      guidance: "run-bearing-portal-in-separate-terminal";
    }>;

export type RepositoryConfigurationResumption = Readonly<{
  operation: "repository-configuration";
  intent: RepositoryConfigurationIntent;
  pendingStage: "catalog-upsert" | "catalog-unregister";
  nextAction: "plan-and-apply-current-configuration";
}>;

export type RepositoryConfigurationApplyResult =
  | Readonly<{
      schemaVersion: 1;
      command: "configure-apply";
      intent: "activate";
      outcome: ReconcileRepositoryResult["outcome"];
      repository: ReconcileRepositoryResult["repository"];
      catalog: ReconcileRepositoryResult["catalog"];
      portalHandoff?: PortalHandoff;
      resumption?: RepositoryConfigurationResumption;
    }>
  | Readonly<{
      schemaVersion: 1;
      command: "configure-apply";
      intent: "deactivate";
      outcome: RepositoryLifecycleResult["outcome"];
      repository: RepositoryLifecycleResult["repository"];
      catalog: RepositoryLifecycleResult["catalog"];
      resumption?: RepositoryConfigurationResumption;
    }>;

const lifecycle = (
  inspected: Awaited<ReturnType<typeof inspectRepositoryIntegrationLifecycle>>,
): RepositoryConfigurationInspection["lifecycle"] => ({
  state: inspected.kind === "invalid-or-unsupported" ? "unsupported" : inspected.kind,
  reason: inspected.reason,
  removalRequired: inspected.kind === "invalid-or-unsupported",
});

const safeRead = async (root: string, target: string): Promise<string | undefined> => {
  try {
    return (await readContainedFile(root, join(root, target))).toString("utf8");
  } catch {
    return undefined;
  }
};

const currentSelections = async (
  root: string,
  state: RepositoryConfigurationInspection["lifecycle"]["state"],
): Promise<CurrentSelections> => {
  if (state !== "active" && state !== "deactivated") {
    return { surfaces: [], executorProfiles: [] };
  }
  const manifestSource = await safeRead(root, ".bearing/manifest.json");
  const providerSource = await safeRead(root, ".bearing/provider.json");
  let manifestValue: unknown;
  try {
    manifestValue = manifestSource === undefined ? undefined : JSON.parse(manifestSource);
  } catch {
    return { surfaces: [], executorProfiles: [] };
  }
  const manifest = repositoryManifestSchema.safeParse(manifestValue);
  if (!manifest.success) return { surfaces: [], executorProfiles: [] };
  let provider: CurrentSelections["provider"];
  try {
    const decoded =
      providerSource === undefined ? undefined : decodeMattProviderConfiguration(providerSource);
    if (decoded !== undefined) {
      provider = { key: decoded.provider, contractLocator: decoded.contractLocator };
    }
  } catch {
    provider = undefined;
  }
  return {
    surfaces: manifest.data.surfaces,
    ...(provider === undefined ? {} : { provider }),
    executorProfiles: manifest.data.executorProfiles,
  };
};

const pathFact = async (root: string, target: string): Promise<PathFact> => {
  try {
    const state = await inspectInstallPath(join(root, target));
    const safe =
      state.kind === "missing" ||
      state.kind === "directory" ||
      (state.kind === "file" && state.linkCount === 1);
    return { target, kind: state.kind, safe };
  } catch {
    return { target, kind: "symbolic-link", safe: false };
  }
};

const pointerEvidence = async (
  root: string,
  surface: AgentSurface,
): Promise<"present" | "absent" | "unsafe"> => {
  const target = agentSurfaceEntryFile(surface);
  const state = await inspectInstallPath(join(root, target));
  if (state.kind === "missing") return "absent";
  if (state.kind !== "file" || state.linkCount !== 1) return "unsafe";
  const source = await safeRead(root, target);
  if (source === undefined) return "unsafe";
  try {
    return bearingManagedRange(source) === undefined ? "absent" : "present";
  } catch {
    return "unsafe";
  }
};

const providerEvidence = async (
  root: string,
  selections: CurrentSelections,
): Promise<"not-configured" | "supported" | "unsupported"> => {
  if (selections.provider === undefined) return "not-configured";
  const contract = await safeRead(root, selections.provider.contractLocator);
  if (contract === undefined || validateMattSkillsV1Contract(contract).state !== "supported") {
    return "unsupported";
  }
  const pointers = await Promise.all(
    selections.surfaces.map(async (surface) => {
      const source = await safeRead(root, agentSurfaceEntryFile(surface));
      return (
        source !== undefined &&
        pointsToMattContractLocator(source, selections.provider?.contractLocator ?? "")
      );
    }),
  );
  return pointers.every(Boolean) ? "supported" : "unsupported";
};

export const inspectRepositoryConfiguration = async (options: {
  repoRoot: string;
  packageRoot: string;
  homeDir: string;
}): Promise<RepositoryConfigurationInspection> => {
  const root = await resolveRepositoryRoot(options.repoRoot);
  const inspectedLifecycle = lifecycle(await inspectRepositoryIntegrationLifecycle(root));
  const selections = await currentSelections(root, inspectedLifecycle.state);
  const targets = await Promise.all([
    pathFact(root, ".bearing"),
    pathFact(root, ".bearing/manifest.json"),
    pathFact(root, ".bearing/provider.json"),
    pathFact(root, ".bearing/cache"),
    ...AGENT_SURFACES.map((surface) => pathFact(root, agentSurfaceEntryFile(surface))),
  ]);
  const catalog = await readCatalogState({ homeDir: options.homeDir });
  const cache = targets.find((item) => item.target === ".bearing/cache");
  return {
    schemaVersion: 1,
    command: "configure-inspect",
    repositoryRoot: root,
    lifecycle: inspectedLifecycle,
    currentSelections: selections,
    installedCapabilityEvidence: {
      packageVersion: packageMetadata.version,
      packageRoot: resolve(options.packageRoot),
      providerContract: await providerEvidence(root, selections),
      managedPointers: {
        "agent-skills": await pointerEvidence(root, "agent-skills"),
        claude: await pointerEvidence(root, "claude"),
      },
    },
    pathSafety: { safe: targets.every((item) => item.safe), targets },
    machineFacts: {
      manifest:
        inspectedLifecycle.state === "fresh"
          ? "missing"
          : inspectedLifecycle.state === "unsupported"
            ? "unsupported"
            : inspectedLifecycle.state,
      cache:
        cache?.kind === "missing"
          ? "missing"
          : cache?.kind === "directory"
            ? "directory"
            : "unsafe",
      catalog: catalog.state === "ready" ? "ready" : "unavailable",
    },
  };
};

const normalizedSurfaces = (
  surfaces: readonly AgentSurface[] | undefined,
): readonly AgentSurface[] =>
  [...new Set(surfaces ?? [])].sort((left, right) => left.localeCompare(right, "en"));

const normalizedProfiles = (profiles: readonly string[] | undefined): readonly string[] =>
  [...new Set(profiles ?? [])].sort((left, right) => left.localeCompare(right, "en"));

const planFingerprint = (plan: Omit<RepositoryConfigurationPlan, "sealedPlanToken">): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(plan)).digest("hex")}`;

const appendCachePrecondition = async (
  root: string,
  preconditions: readonly RepositoryTargetPrecondition[],
): Promise<readonly RepositoryTargetPrecondition[]> => {
  const cache = await captureRepositoryTargetPreconditions(root, [
    ".bearing/cache/project-read-model.sqlite",
  ]);
  return [...preconditions, ...cache].sort((left, right) =>
    left.target.localeCompare(right.target, "en"),
  );
};

export const planRepositoryConfiguration = async (
  request: RepositoryConfigurationRequest,
): Promise<RepositoryConfigurationPlan> => {
  const inspection = await inspectRepositoryConfiguration(request);
  const surfaces = normalizedSurfaces(request.surfaces);
  const registrations = [...(request.registrations ?? [])].sort((left, right) =>
    left.profileKey.localeCompare(right.profileKey, "en"),
  );
  const retainProfiles = normalizedProfiles(request.retainProfiles);
  const removeProfiles = normalizedProfiles(request.removeProfiles);
  const acceptedDesiredConfiguration = {
    surfaces,
    ...(request.provider === undefined ? {} : { provider: request.provider }),
    ...(request.executorDecision === undefined
      ? {}
      : { executorDecision: request.executorDecision }),
    registrations,
    retainProfiles,
    removeProfiles,
  };
  const unresolvedChoices =
    request.intent === "deactivate"
      ? []
      : [
          ...(surfaces.length === 0 ? (["agent-surfaces"] as const) : []),
          ...(request.provider === undefined ? (["provider"] as const) : []),
          ...(request.executorDecision === undefined ? (["executor"] as const) : []),
        ];

  let targets: readonly string[] = [];
  let preconditions: readonly RepositoryTargetPrecondition[] = [];
  let blockers: readonly RepositoryIntegrationBlocker[] = [];
  let canApply = false;
  if (unresolvedChoices.length === 0 && inspection.lifecycle.state !== "unsupported") {
    if (request.intent === "deactivate") {
      targets = [
        ".bearing/manifest.json",
        ".bearing/cache/",
        ...inspection.currentSelections.surfaces.map(agentSurfaceEntryFile),
      ].sort((left, right) => left.localeCompare(right, "en"));
      preconditions = await captureRepositoryTargetPreconditions(
        inspection.repositoryRoot,
        targets.map((target) => (target.endsWith("/") ? target.slice(0, -1) : target)),
      );
      canApply =
        inspection.lifecycle.state === "active" || inspection.lifecycle.state === "deactivated";
      if (!canApply) {
        blockers = [
          {
            code: "unsafe-repository-target",
            target: ".bearing/manifest.json",
            message: "Repository Configuration cannot deactivate a Fresh repository.",
          },
        ];
      }
    } else {
      const profiles = normalizedProfiles([
        ...registrations.map((registration) => registration.profileKey),
        ...retainProfiles,
      ]);
      const integration = await planRepositoryIntegration({
        repoRoot: inspection.repositoryRoot,
        packageRoot: request.packageRoot,
        surfaces,
        profiles,
        registrations,
        executorHomeDir: request.homeDir,
        retainProfiles,
        removeProfiles,
        confirmRepair: true,
        confirmReactivate: true,
        ...(request.provider === undefined ? {} : { provider: request.provider }),
      });
      targets = integration.stages.repositoryApplyUnit.targets;
      preconditions = integration.stages.repositoryApplyUnit.preconditions;
      blockers = integration.blockers;
      canApply = integration.canApply;
      if (!canApply && blockers.length === 0) {
        blockers = [
          {
            code: "unsupported-provider-contract",
            target: request.provider?.contractLocator ?? ".bearing/provider.json",
            message: "The nominated provider contract is unavailable or unsupported.",
          },
        ];
      }
      if (inspection.lifecycle.state === "fresh" || inspection.lifecycle.state === "deactivated") {
        targets = [...targets, ".bearing/cache/project-read-model.sqlite"].sort((left, right) =>
          left.localeCompare(right, "en"),
        );
        preconditions = await appendCachePrecondition(inspection.repositoryRoot, preconditions);
      }
    }
  }
  if (inspection.lifecycle.state === "unsupported") {
    blockers = [
      {
        code: "unsafe-repository-target",
        target: ".bearing",
        message:
          "Unsupported Preview state is removal-required. Use an explicit Agent-reviewed platform removal, then run Fresh Repository Configuration.",
      },
    ];
    canApply = false;
  }
  if (request.executorDecision === "skip" && registrations.length > 0) {
    blockers = [
      ...blockers,
      {
        code: "unsupported-executor-registration",
        target: ".bearing/executor-profiles",
        message: "Executor skip cannot include an executor registration.",
      },
    ];
    canApply = false;
  }
  if (
    request.executorDecision === "configure" &&
    registrations.length === 0 &&
    retainProfiles.length === 0 &&
    removeProfiles.length === 0
  ) {
    blockers = [
      ...blockers,
      {
        code: "unsupported-executor-registration",
        target: ".bearing/executor-profiles",
        message: "Executor configure requires one nominated or explicitly retained profile.",
      },
    ];
    canApply = false;
  }

  const unsealed: Omit<RepositoryConfigurationPlan, "sealedPlanToken"> = {
    schemaVersion: 1,
    command: "configure-plan",
    repositoryRoot: inspection.repositoryRoot,
    intent: request.intent,
    lifecycle: inspection.lifecycle,
    acceptedDesiredConfiguration,
    unresolvedChoices,
    canApply: canApply && blockers.length === 0,
    blockers,
    repositoryApplyUnit: {
      owner: "bearing-repository-configuration",
      atomic: true,
      rollback: "restore-previous-repository-bytes",
      targets,
      preconditions,
    },
    preservationEffects:
      request.intent === "deactivate"
        ? [
            "canonical Bearing State",
            "Provider Configuration",
            "Execution Profiles",
            "durable artifacts",
            "native work",
          ]
        : ["canonical planning state", "native work", "provider-owned source"],
    catalogStage: {
      owner: "bearing-project-catalog",
      action: request.intent === "deactivate" ? "unregister" : "upsert",
      order: "after-repository-validation",
      rollback: "independent",
    },
  };
  return unsealed.canApply ? { ...unsealed, sealedPlanToken: planFingerprint(unsealed) } : unsealed;
};

const portalOrigin = (environment: Readonly<Record<string, string | undefined>>): string => {
  const value = environment["BEARING_PORT"];
  const port = value === undefined ? 4178 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("BEARING_PORT must be an integer from 1 to 65535.");
  }
  return `http://127.0.0.1:${port}`;
};

export const inspectPortalHandoff = async (
  entryId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PortalHandoff> => {
  const origin = portalOrigin(environment);
  let healthResponse: Response;
  try {
    healthResponse = await fetch(`${origin}/healthz`, {
      signal: AbortSignal.timeout(500),
    });
  } catch {
    return { state: "absent", origin, guidance: "run-bearing-portal-in-separate-terminal" };
  }
  try {
    const health = (await healthResponse.json()) as Record<string, unknown>;
    const compatible =
      healthResponse.ok &&
      health["state"] === "ready" &&
      health["packageVersion"] === packageMetadata.version &&
      health["readModelVersion"] === PROJECT_SNAPSHOT_VERSION;
    if (!compatible) {
      return { state: "incompatible", origin, guidance: "stop-host-and-start-current-kit" };
    }
    const catalogResponse = await fetch(`${origin}/api/v1/catalog`, {
      signal: AbortSignal.timeout(500),
    });
    const catalog = (await catalogResponse.json()) as Record<string, unknown>;
    const entries = Array.isArray(catalog["entries"]) ? catalog["entries"] : [];
    const present = entries.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "entryId" in entry &&
        entry.entryId === entryId,
    );
    if (!catalogResponse.ok || catalog["state"] !== "ready" || !present) {
      return { state: "incompatible", origin, guidance: "stop-host-and-start-current-kit" };
    }
    return { state: "compatible", origin, projectUrl: `${origin}/projects/${entryId}` };
  } catch {
    return { state: "incompatible", origin, guidance: "stop-host-and-start-current-kit" };
  }
};

export const applyRepositoryConfiguration = async (
  request: RepositoryConfigurationRequest & Readonly<{ sealedPlanToken: string }>,
): Promise<RepositoryConfigurationApplyResult> => {
  const plan = await planRepositoryConfiguration(request);
  if (!plan.canApply || plan.sealedPlanToken === undefined) {
    throw new Error("Repository Configuration has no complete sealed plan; no writes were made.");
  }
  if (request.sealedPlanToken !== plan.sealedPlanToken) {
    throw new Error(
      `Repository Configuration plan is stale or does not match the reviewed write set. Expected ${plan.sealedPlanToken}; received ${request.sealedPlanToken}.`,
    );
  }
  if (request.intent === "deactivate") {
    const result = await deactivateRepository({
      repoRoot: plan.repositoryRoot,
      homeDir: request.homeDir,
    });
    return {
      schemaVersion: 1,
      command: "configure-apply",
      outcome: result.outcome,
      intent: request.intent,
      repository: result.repository,
      catalog: result.catalog,
      ...(result.catalog.outcome === "failed"
        ? {
            resumption: {
              operation: "repository-configuration" as const,
              intent: request.intent,
              pendingStage: "catalog-unregister" as const,
              nextAction: "plan-and-apply-current-configuration" as const,
            },
          }
        : {}),
    };
  }
  const desired = plan.acceptedDesiredConfiguration;
  if (desired.provider === undefined) {
    throw new Error("Sealed Repository Configuration has no provider prerequisite.");
  }
  const repository = await reconcileRepository({
    repoRoot: plan.repositoryRoot,
    packageRoot: request.packageRoot,
    homeDir: request.homeDir,
    surfaces: desired.surfaces,
    profiles: normalizedProfiles([
      ...desired.registrations.map((registration) => registration.profileKey),
      ...desired.retainProfiles,
    ]),
    registrations: desired.registrations,
    retainProfiles: desired.retainProfiles,
    removeProfiles: desired.removeProfiles,
    confirmRepair: true,
    confirmReactivate: true,
    provider: desired.provider,
  });
  const inspectedPortalHandoff =
    repository.catalog.outcome === "failed"
      ? undefined
      : await inspectPortalHandoff(repository.catalog.entryId);
  const portalHandoff =
    repository.outcome === "no-op" && inspectedPortalHandoff?.state !== "compatible"
      ? undefined
      : inspectedPortalHandoff;
  return {
    schemaVersion: 1,
    command: "configure-apply",
    outcome: repository.outcome,
    intent: request.intent,
    repository: repository.repository,
    catalog: repository.catalog,
    ...(portalHandoff === undefined ? {} : { portalHandoff }),
    ...(repository.catalog.outcome === "failed"
      ? {
          resumption: {
            operation: "repository-configuration" as const,
            intent: request.intent,
            pendingStage: "catalog-upsert" as const,
            nextAction: "plan-and-apply-current-configuration" as const,
          },
        }
      : {}),
  };
};
