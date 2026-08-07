#!/usr/bin/env node

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import packageMetadata from "../package.json";
import { ACTIVATION_ORIGINS, checkBearingActivation } from "./activation-policy";
import { createPlanningLineageAgentHandoff } from "./agent-planning-lineage-handoff";
import { registerAsset } from "./asset-registration";
import { runCatalogCommand } from "./catalog/cli";
import {
  executorNominationAssessmentSchema,
  resolveExecutorNominations,
  resolveExecutorWritebackProfile,
} from "./executor-registration";
import { writeInspectBenchmarkMetrics } from "./inspect-benchmark";
import { installKit } from "./installer";
import {
  nativeReferenceSchema,
  nativeWorkAffectedRelationSchema,
  normalizeNativeReconciliationRequest,
} from "./native-reconciliation-contract";
import { resolveRepositoryRoot } from "./path-boundary";
import { createPlanningGraphInstrumentation } from "./planning-graph-instrumentation";
import { parsePortalPort } from "./portal/port";
import { startPortalServer } from "./portal/server";
import { planningReferenceSchema } from "./project-read-model/contract";
import { inspectProject } from "./project-read-model/inspect";
import {
  captureProjectProviderScopes,
  rebuildProjectReadModel,
  reconcileProjectNative,
  verifyAllProjectProviderScopes,
} from "./project-read-model/provider-operations";
import { reconcileRepository } from "./reconcile-repository";
import { deactivateRepository, inspectPurgePlan, purgeRepository } from "./repo-lifecycle";
import { inspectLegacyCutoverPlan } from "./repository-cutover";
import { planRepositoryIntegration } from "./repository-integration-plan";
import { runSync } from "./sync";
import { commitSyncPlan, prepareSync } from "./sync-plan";
import type { AgentSurface } from "./types";

const HELP = `Bearing ${packageMetadata.version}

Usage:
  bearing
  bearing install --surface <agent-skills|claude> [--surface <agent-skills|claude>] [--confirm-downgrade]
  bearing setup --repo <path> --surface <agent-skills|claude> --provider-contract <repository-relative-path> [--executor <surface:skill> --executor-assessment <json>] [--retain-executor <profile>] [--remove-executor <profile>] [--confirm-repair] [--confirm-reactivate] [--accept-upgrade-direction --confirm-cutover --cutover-at <ISO-8601> --cutover-plan-token <sha256>] [--plan]
  bearing activation check --origin <model-invoked|explicit> [--repo <path>]
  bearing deactivate --repo <path>
  bearing purge --repo <path> [--plan] [--confirm-purge --purge-plan-token <sha256> (--recovery-export <path> | --accept-no-recovery-export)]
  bearing asset register --repo <path> --id <asset:id> --title <text> --kind <kind> --location <locator> --owner <reference> --producer-kind <kind> [--producer-name <name> | --executor-capability <surface:skill>] [--producer-reference <reference>] [--produced-for <reference>] [--produced-at <date-or-ISO-instant>]
  bearing catalog <rename|forget|remove|relink|reset> [options]
  bearing sync [--repo <path>] [--initialize-provider-observations | --recover-provider-observations | --full-provider-verification]
  bearing reconcile-native --scope <opaque-native-scope> [--ref <native-reference>] [--relation <json>] [--repo <path>]
  bearing provider capture --scope <opaque-native-scope> [--scope <opaque-native-scope>] [--repo <path>]
  bearing provider verify --all [--repo <path>]
  bearing cache rebuild [--repo <path>]
  bearing inspect <project|diagnostics|stable-planning-reference> [--native <native-reference>] [--repo <path>]
  bearing portal [--port <1-65535>]
  bearing --help
  bearing --version

Commands:
  <none>   Run the install/update wizard for the detected local Agent Surfaces.
  install  Install the global bundle, CLI, and skills for selected Agent Surfaces.
  setup    Enable Bearing in one repository without copying package-owned contracts or skills into it.
  activation  Check read-only repository eligibility and routing before Bearing activation.
  deactivate  Remove repository enablement and managed pointers; preserve state and native work.
  purge    Remove only the repository .bearing namespace and managed pointers after confirmation.
  asset    Register factual durable-output metadata in the repository Asset Registry.
  catalog  Apply an explicit user-level Project Catalog lifecycle or recovery operation.
  sync     Rebuild deterministic diagnostics and the Project Sitemap under .bearing/cache/.
  reconcile-native  Re-observe only the native subjects and relations affected by one completed Matt transaction.
  provider  Explicitly capture exact Work Binding scopes or verify all current scopes.
  cache     Rebuild only the disposable repository Project Read Model.
  inspect  Return one generation-scoped planning context closure.
  portal   Run the foreground loopback Portal Host and compiled browser Module.

Environment:
  BEARING_PORT  Override the Portal port when --port is absent.
`;

const surfaceSchema = z.array(z.enum(["agent-skills", "claude"])).min(1);
const activationOriginSchema = z.enum(ACTIVATION_ORIGINS);

const packageRoot = (): string => {
  const adjacent = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return existsSync(join(adjacent, "skills")) ? adjacent : join(adjacent, "kit/current");
};

const homeDirectory = (): string => process.env["HOME"] ?? homedir();

const detectedSurfaces = (homeDir: string): readonly AgentSurface[] => {
  const surfaces: AgentSurface[] = [];
  if (existsSync(join(homeDir, ".agents"))) surfaces.push("agent-skills");
  if (existsSync(join(homeDir, ".claude"))) surfaces.push("claude");
  return surfaces.length === 0 ? ["agent-skills"] : surfaces;
};

const describeSurfaces = (surfaces: readonly AgentSurface[]): string =>
  surfaces
    .map((surface) => (surface === "agent-skills" ? "Codex/Agent Skills" : "Claude Code"))
    .join(", ");

const confirmWizard = async (message: string): Promise<boolean> => {
  if (!process.stdin.isTTY) return true;
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await input.question(`${message} [Y/n] `);
    return answer.trim() === "" || answer.trim().toLowerCase() === "y";
  } finally {
    input.close();
  }
};

const runInstallWizard = async (): Promise<void> => {
  const homeDir = homeDirectory();
  const surfaces = detectedSurfaces(homeDir);
  process.stdout.write(`Bearing install/update wizard\n`);
  process.stdout.write(`Home: ${homeDir}\n`);
  process.stdout.write(`Agent Surfaces: ${describeSurfaces(surfaces)}\n`);
  process.stdout.write(`Managed bundle: ${join(homeDir, ".bearing/kit/current")}\n`);
  process.stdout.write(`CLI: ${join(homeDir, ".bearing/bin/bearing")}\n`);
  process.stdout.write(
    "Agent Surface skills are owned symlinks to the version-consistent Bearing bundle.\n",
  );
  process.stdout.write(
    "Network: npm may download this package before the wizard starts; Bearing itself performs no telemetry, analytics, crash upload, repository upload, or update polling.\n",
  );
  if (!(await confirmWizard("Install or update these managed targets?"))) {
    process.stdout.write("Outcome: cancelled\n");
    return;
  }
  const result = await installKit({
    homeDir,
    packageRoot: packageRoot(),
    surfaces,
  });
  process.stdout.write(
    `Outcome: ${result.outcome}\nCLI: ${result.cliPath}\nChanged targets: ${result.changedTargets.length}\n`,
  );
};

const runSetup = async (args: readonly string[]): Promise<void> => {
  const parsed = parseArgs({
    args: [...args],
    options: {
      repo: { type: "string" },
      surface: { type: "string", multiple: true },
      executor: { type: "string", multiple: true },
      "executor-assessment": { type: "string", multiple: true },
      "provider-contract": { type: "string" },
      "retain-executor": { type: "string", multiple: true },
      "remove-executor": { type: "string", multiple: true },
      "confirm-repair": { type: "boolean" },
      "confirm-reactivate": { type: "boolean" },
      "accept-upgrade-direction": { type: "boolean" },
      "confirm-cutover": { type: "boolean" },
      "cutover-at": { type: "string" },
      "cutover-plan-token": { type: "string" },
      plan: { type: "boolean" },
    },
    allowPositionals: false,
    strict: true,
  });
  const surfaces = surfaceSchema.parse(parsed.values.surface ?? []);
  const provider =
    parsed.values["provider-contract"] === undefined
      ? undefined
      : {
          key: "matt-skills/v1" as const,
          contractLocator: parsed.values["provider-contract"],
        };
  const registrations = await resolveExecutorNominations(
    homeDirectory(),
    parsed.values.executor ?? [],
    (parsed.values["executor-assessment"] ?? []).map((encoded) => {
      let assessment: unknown;
      try {
        assessment = JSON.parse(encoded);
      } catch (error) {
        throw new Error("Executor semantic assessment must be valid JSON.", { cause: error });
      }
      return executorNominationAssessmentSchema.parse(assessment);
    }),
  );
  const profiles = [
    ...registrations.map((registration) => registration.profileKey),
    ...(parsed.values["retain-executor"] ?? []),
  ];
  if (parsed.values.plan === true) {
    const plan = await planRepositoryIntegration({
      repoRoot: resolve(parsed.values.repo ?? process.cwd()),
      packageRoot: packageRoot(),
      surfaces,
      profiles,
      registrations,
      executorHomeDir: homeDirectory(),
      retainProfiles: parsed.values["retain-executor"] ?? [],
      removeProfiles: parsed.values["remove-executor"] ?? [],
      confirmRepair: parsed.values["confirm-repair"] === true,
      confirmReactivate: parsed.values["confirm-reactivate"] === true,
      acceptUpgradeDirection: parsed.values["accept-upgrade-direction"] === true,
      confirmCutover: parsed.values["confirm-cutover"] === true,
      ...(parsed.values["cutover-at"] === undefined
        ? {}
        : { cutoverAt: parsed.values["cutover-at"] }),
      ...(parsed.values["cutover-plan-token"] === undefined
        ? {}
        : { cutoverPlanToken: parsed.values["cutover-plan-token"] }),
      ...(provider === undefined ? {} : { provider }),
    });
    const cutover =
      plan.recoveryDiagnosis?.classification === "legacy-cutover" &&
      provider !== undefined &&
      parsed.values["cutover-at"] !== undefined
        ? await inspectLegacyCutoverPlan(plan.repoRoot, {
            repoRoot: plan.repoRoot,
            packageRoot: packageRoot(),
            surfaces,
            profiles,
            registrations,
            retainProfiles: parsed.values["retain-executor"] ?? [],
            removeProfiles: parsed.values["remove-executor"] ?? [],
            provider,
            cutoverAt: parsed.values["cutover-at"],
          })
        : undefined;
    process.stdout.write(
      `${JSON.stringify(
        cutover === undefined
          ? plan
          : {
              ...plan,
              canApply:
                parsed.values["accept-upgrade-direction"] === true &&
                parsed.values["confirm-cutover"] === true &&
                parsed.values["cutover-plan-token"] === cutover.confirmationToken,
              cutover,
            },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (provider === undefined) {
    throw new Error(
      "Setup requires a selected-surface Matt provider contract; no repository writes were made.",
    );
  }
  const result = await reconcileRepository({
    repoRoot: resolve(parsed.values.repo ?? process.cwd()),
    packageRoot: packageRoot(),
    homeDir: homeDirectory(),
    surfaces,
    profiles,
    registrations,
    retainProfiles: parsed.values["retain-executor"] ?? [],
    removeProfiles: parsed.values["remove-executor"] ?? [],
    confirmRepair: parsed.values["confirm-repair"] === true,
    confirmReactivate: parsed.values["confirm-reactivate"] === true,
    acceptUpgradeDirection: parsed.values["accept-upgrade-direction"] === true,
    confirmCutover: parsed.values["confirm-cutover"] === true,
    ...(parsed.values["cutover-at"] === undefined
      ? {}
      : { cutoverAt: parsed.values["cutover-at"] }),
    ...(parsed.values["cutover-plan-token"] === undefined
      ? {}
      : { cutoverPlanToken: parsed.values["cutover-plan-token"] }),
    ...(provider === undefined ? {} : { provider }),
  });
  process.stdout.write(
    `Outcome: ${result.outcome}\nRepository: ${result.repository.outcome}\nCatalog: ${result.catalog.outcome}\nManifest: ${result.repository.manifestPath}\nChanged targets: ${result.repository.changedTargets.length}\n`,
  );
  if (result.repository.recoveryBundlePath !== undefined) {
    process.stdout.write(`Recovery bundle: ${result.repository.recoveryBundlePath}\n`);
  }
  if (result.repository.cutover !== undefined) {
    process.stdout.write(
      `Cutover schema: ${result.repository.cutover.sourceSchema} -> ${result.repository.cutover.targetSchema}\nRecovery verification: ${
        result.repository.cutover.recoveryBundleVerified ? "verified" : "unverified"
      }\nTarget validation: ${result.repository.cutover.targetValidation}\n`,
    );
  }
  if (result.catalog.outcome === "failed") {
    process.stderr.write(
      `Catalog registration failed: ${result.catalog.message}\nCompleted: repository Setup Apply.\nPending: Project Catalog registration.\nPersistent external effects: the repository configuration is already valid and is not rolled back by Catalog failure.\nResumption point: apply the Catalog recovery named by the error, then rerun this exact Setup request; its repository stage will reconcile idempotently.\n`,
    );
    process.exitCode = 1;
  }
};

const runActivationCheck = async (args: readonly string[]): Promise<void> => {
  const [subcommand, ...values] = args;
  if (subcommand !== "check") {
    throw new Error("Activation requires the `check` subcommand.");
  }
  const parsed = parseArgs({
    args: values,
    options: {
      origin: { type: "string" },
      repo: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const origin = activationOriginSchema.parse(parsed.values.origin);
  const result = await checkBearingActivation(parsed.values.repo ?? process.cwd(), origin);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

const runInstall = async (args: readonly string[]): Promise<void> => {
  const parsed = parseArgs({
    args: [...args],
    options: {
      surface: { type: "string", multiple: true },
      "confirm-downgrade": { type: "boolean" },
    },
    allowPositionals: false,
    strict: true,
  });
  const surfaces = surfaceSchema.parse(parsed.values.surface ?? []);
  const result = await installKit({
    homeDir: homeDirectory(),
    packageRoot: packageRoot(),
    surfaces,
    confirmDowngrade: parsed.values["confirm-downgrade"] === true,
  });
  process.stdout.write(
    `Outcome: ${result.outcome}\nCLI: ${result.cliPath}\nChanged targets: ${result.changedTargets.length}\n`,
  );
};

const runAssetCommand = async (args: readonly string[]): Promise<void> => {
  const parsed = parseArgs({
    args: [...args],
    options: {
      repo: { type: "string" },
      id: { type: "string" },
      title: { type: "string" },
      kind: { type: "string" },
      location: { type: "string" },
      owner: { type: "string" },
      "producer-kind": { type: "string" },
      "producer-name": { type: "string" },
      "producer-reference": { type: "string" },
      "executor-capability": { type: "string" },
      "produced-for": { type: "string" },
      "produced-at": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "register") {
    throw new Error("Usage: bearing asset register [options]");
  }
  const repoRoot = resolve(parsed.values.repo ?? process.cwd());
  let producerName = parsed.values["producer-name"];
  if (
    parsed.values["producer-kind"] === "executor-profile" &&
    parsed.values["executor-capability"] === undefined
  ) {
    throw new Error("--producer-kind executor-profile requires the actual --executor-capability.");
  }
  if (parsed.values["executor-capability"] !== undefined) {
    if (parsed.values["producer-kind"] !== "executor-profile") {
      throw new Error("--executor-capability requires --producer-kind executor-profile.");
    }
    const writebackProfile = await resolveExecutorWritebackProfile(
      repoRoot,
      parsed.values["executor-capability"],
    );
    if (producerName !== undefined && producerName !== writebackProfile.profileKey) {
      throw new Error(
        `--producer-name does not match the actual executor capability; expected ${writebackProfile.profileKey}.`,
      );
    }
    producerName = writebackProfile.profileKey;
  }
  const required = {
    id: parsed.values.id,
    title: parsed.values.title,
    kind: parsed.values.kind,
    location: parsed.values.location,
    owner: parsed.values.owner,
    producerKind: parsed.values["producer-kind"],
    producerName,
  };
  if (Object.values(required).some((value) => value === undefined)) {
    throw new Error("Asset registration requires identity, location, owner, kind and producer.");
  }
  const result = await registerAsset({
    repoRoot,
    id: required.id ?? "",
    title: required.title ?? "",
    kind: required.kind ?? "",
    location: required.location ?? "",
    owner: required.owner ?? "",
    producer: {
      kind: required.producerKind as "executor-profile" | "agent-capability" | "external-source",
      name: required.producerName ?? "",
      ...(parsed.values["producer-reference"] === undefined
        ? {}
        : { reference: parsed.values["producer-reference"] }),
    },
    ...(parsed.values["executor-capability"] === undefined
      ? {}
      : { executorCapabilityLocator: parsed.values["executor-capability"] }),
    ...(parsed.values["produced-for"] === undefined
      ? {}
      : { producedFor: parsed.values["produced-for"] }),
    ...(parsed.values["produced-at"] === undefined
      ? {}
      : { producedAt: parsed.values["produced-at"] }),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

const runRepositoryLifecycle = async (
  command: "deactivate" | "purge",
  args: readonly string[],
): Promise<void> => {
  const parsed = parseArgs({
    args: [...args],
    options: {
      repo: { type: "string" },
      "confirm-purge": { type: "boolean" },
      plan: { type: "boolean" },
      "purge-plan-token": { type: "string" },
      "recovery-export": { type: "string" },
      "accept-no-recovery-export": { type: "boolean" },
    },
    allowPositionals: false,
    strict: true,
  });
  if (
    command === "deactivate" &&
    (parsed.values["confirm-purge"] === true ||
      parsed.values.plan === true ||
      parsed.values["purge-plan-token"] !== undefined ||
      parsed.values["recovery-export"] !== undefined ||
      parsed.values["accept-no-recovery-export"] === true)
  ) {
    throw new Error("Purge planning and confirmation options are valid only for `bearing purge`.");
  }
  const options = {
    repoRoot: resolve(parsed.values.repo ?? process.cwd()),
    homeDir: homeDirectory(),
  };
  if (
    command === "purge" &&
    (parsed.values.plan === true || parsed.values["confirm-purge"] !== true)
  ) {
    const plan = await inspectPurgePlan(options);
    process.stdout.write(`${JSON.stringify({ outcome: "cancelled", ...plan }, null, 2)}\n`);
    return;
  }
  const result =
    command === "deactivate"
      ? await deactivateRepository(options)
      : await purgeRepository({
          ...options,
          confirmed: parsed.values["confirm-purge"] === true,
          ...(parsed.values["purge-plan-token"] === undefined
            ? {}
            : { planToken: parsed.values["purge-plan-token"] }),
          ...(parsed.values["recovery-export"] === undefined
            ? {}
            : { recoveryExport: parsed.values["recovery-export"] }),
          acceptNoRecoveryExport: parsed.values["accept-no-recovery-export"] === true,
        });
  process.stdout.write(
    `Outcome: ${result.outcome}\nRepository: ${result.repository.outcome}\nCatalog: ${result.catalog.outcome}\nChanged targets: ${result.repository.changedTargets.length}\n`,
  );
  if (result.repository.cleanup?.outcome === "residue") {
    process.stderr.write(
      `Lifecycle cleanup residue: ${result.repository.cleanup.location}\n${result.repository.cleanup.message}\n`,
    );
  }
  if (result.catalog.outcome === "failed") {
    process.stderr.write(
      `Catalog removal failed: ${result.catalog.message}\nCompleted: repository lifecycle apply.\nPending: Project Catalog removal.\nPersistent external effects: the repository lifecycle state is already committed and is not rolled back by Catalog failure.\nResumption point: if the database is unavailable, run confirmed Catalog reset and Setup re-registration; then run \`bearing catalog remove --repo ${options.repoRoot}\`.\n`,
    );
  }
  if (result.outcome === "blocked" || result.outcome === "partial") process.exitCode = 1;
};

const runSyncCommand = async (args: readonly string[]): Promise<void> => {
  const parsed = parseArgs({
    args: [...args],
    options: {
      repo: { type: "string" },
      "initialize-provider-observations": { type: "boolean" },
      "recover-provider-observations": { type: "boolean" },
      "full-provider-verification": { type: "boolean" },
    },
    allowPositionals: false,
    strict: true,
  });
  const providerIntentCount = [
    parsed.values["initialize-provider-observations"],
    parsed.values["recover-provider-observations"],
    parsed.values["full-provider-verification"],
  ].filter((value) => value === true).length;
  if (providerIntentCount > 1) {
    throw new Error(
      "Choose exactly one provider observation baseline, recovery, or full verification intent.",
    );
  }
  const providerObservationIntent =
    parsed.values["initialize-provider-observations"] === true
      ? ("initial-baseline" as const)
      : parsed.values["recover-provider-observations"] === true
        ? ("recovery" as const)
        : parsed.values["full-provider-verification"] === true
          ? ("full-verification" as const)
          : ("ordinary-sync" as const);
  const result = await runSync(resolve(parsed.values.repo ?? process.cwd()), {
    providerObservationIntent,
  });
  process.stdout.write(
    `Report: ${result.reportPath}\nSitemap: ${result.sitemapPath}\nInput fingerprint: ${result.fingerprint}\nDiagnostics: ${result.diagnostics.length}\nProvider observations: ${result.providerObservationOperation.intent}/${result.providerObservationOperation.outcome} (${result.providerObservationOperation.acquisitionCount} acquisitions)\nNative scope inspection: ${result.nativeScopeInspectionOperation.intent.kind}/${result.nativeScopeInspectionOperation.outcome} (${result.nativeScopeInspectionOperation.acquisitionCount} acquisitions)\nOutcome: ${result.changed ? "applied" : "no-op"}\n`,
  );
  if (result.diagnostics.some((diagnostic) => diagnostic.impact === "blocking")) {
    process.exitCode = 1;
  }
};

const runNativeReconciliationCommand = async (args: readonly string[]): Promise<void> => {
  const parsed = (() => {
    try {
      return parseArgs({
        args: [...args],
        options: {
          repo: { type: "string" },
          scope: { type: "string" },
          ref: { type: "string", multiple: true },
          relation: { type: "string", multiple: true },
        },
        allowPositionals: false,
        strict: true,
      });
    } catch (error) {
      throw new CommandUsageError(
        "Usage: bearing reconcile-native --scope <opaque-native-scope> [--ref <native-reference>] [--relation <json>] [--repo <path>]",
        { cause: error },
      );
    }
  })();
  const nativeScope = parsed.values.scope;
  if (nativeScope === undefined) {
    throw new CommandUsageError(
      "Targeted native reconciliation requires --scope <opaque-native-scope>.",
    );
  }
  const relations = (() => {
    try {
      return (parsed.values.relation ?? []).map((encoded) => {
        const value: unknown = JSON.parse(encoded);
        return nativeWorkAffectedRelationSchema.parse(value);
      });
    } catch (error) {
      throw new CommandUsageError("Every --relation value must be one JSON relation object.", {
        cause: error,
      });
    }
  })();
  const request = (() => {
    try {
      return normalizeNativeReconciliationRequest({
        binding: { provider: "matt-skills/v1", nativeScope },
        subjects: parsed.values.ref ?? [],
        relations,
      });
    } catch (error) {
      throw new CommandUsageError("Targeted native reconciliation input is invalid.", {
        cause: error,
      });
    }
  })();
  const result = await reconcileProjectNative(
    await resolveRepositoryRoot(resolve(parsed.values.repo ?? process.cwd())),
    {
      binding: request.binding,
      subjects: request.subjects,
      relations: request.relations,
    },
  );
  process.stdout.write(`${JSON.stringify({ ...result, request }, null, 2)}\n`);
  if (result.outcome !== "complete") process.exitCode = 1;
};

const runProviderCommand = async (args: readonly string[]): Promise<void> => {
  const [operation, ...operationArgs] = args;
  if (operation !== "capture" && operation !== "verify") {
    throw new CommandUsageError(
      "Usage: bearing provider <capture --scope <opaque-native-scope> [--scope <opaque-native-scope>] | verify --all> [--repo <path>]",
    );
  }
  const parsed = (() => {
    try {
      return parseArgs({
        args: operationArgs,
        options: {
          repo: { type: "string" },
          scope: { type: "string", multiple: true },
          all: { type: "boolean" },
        },
        allowPositionals: false,
        strict: true,
      });
    } catch (error) {
      throw new CommandUsageError("Provider acquisition input is invalid.", { cause: error });
    }
  })();
  if (
    (operation === "capture" &&
      ((parsed.values.scope?.length ?? 0) === 0 || parsed.values.all === true)) ||
    (operation === "verify" &&
      (parsed.values.all !== true || (parsed.values.scope?.length ?? 0) > 0))
  ) {
    throw new CommandUsageError(
      operation === "capture"
        ? "Usage: bearing provider capture --scope <opaque-native-scope> [--scope <opaque-native-scope>] [--repo <path>]"
        : "Usage: bearing provider verify --all [--repo <path>]",
    );
  }
  const repoRoot = await resolveRepositoryRoot(resolve(parsed.values.repo ?? process.cwd()));
  const result =
    operation === "capture"
      ? await captureProjectProviderScopes(repoRoot, parsed.values.scope ?? [])
      : await verifyAllProjectProviderScopes(repoRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.outcome !== "complete") process.exitCode = 1;
};

const runCacheCommand = async (args: readonly string[]): Promise<void> => {
  const [operation, ...operationArgs] = args;
  if (operation !== "rebuild") {
    throw new CommandUsageError("Usage: bearing cache rebuild [--repo <path>]");
  }
  const parsed = (() => {
    try {
      return parseArgs({
        args: operationArgs,
        options: { repo: { type: "string" } },
        allowPositionals: false,
        strict: true,
      });
    } catch (error) {
      throw new CommandUsageError("Usage: bearing cache rebuild [--repo <path>]", {
        cause: error,
      });
    }
  })();
  const result = await rebuildProjectReadModel(
    await resolveRepositoryRoot(resolve(parsed.values.repo ?? process.cwd())),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.outcome !== "complete") process.exitCode = 1;
};

const runInspectCommand = async (args: readonly string[]): Promise<void> => {
  const parsed = (() => {
    try {
      return parseArgs({
        args: [...args],
        options: {
          repo: { type: "string" },
          native: { type: "string" },
          "benchmark-metrics-file": { type: "string" },
          "portal-entry": { type: "string" },
        },
        allowPositionals: true,
        strict: true,
      });
    } catch (error) {
      throw new CommandUsageError(
        "Usage: bearing inspect <project|diagnostics|stable-planning-reference> [--repo <path>]",
        { cause: error },
      );
    }
  })();
  const [request, ...requestExtra] = parsed.positionals;
  if (
    (request !== undefined || parsed.values.native !== undefined) &&
    !(request !== undefined && parsed.values.native !== undefined) &&
    requestExtra.length === 0 &&
    parsed.values["benchmark-metrics-file"] === undefined &&
    parsed.values["portal-entry"] === undefined
  ) {
    const inspectRequest =
      parsed.values.native !== undefined
        ? nativeReferenceSchema.safeParse(parsed.values.native).success
          ? ({ kind: "native-reference", reference: parsed.values.native } as const)
          : undefined
        : request === "project"
          ? ({ kind: "project" } as const)
          : request === "diagnostics"
            ? ({ kind: "diagnostics" } as const)
            : request !== undefined && planningReferenceSchema.safeParse(request).success
              ? ({ kind: "planning-reference", reference: request } as const)
              : undefined;
    if (inspectRequest === undefined) {
      throw new CommandUsageError(
        "Usage: bearing inspect <project|diagnostics|stable-planning-reference> [--native <native-reference>] [--repo <path>]",
      );
    }
    const result = await inspectProject(
      await resolveRepositoryRoot(resolve(parsed.values.repo ?? process.cwd())),
      inspectRequest,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (
      result.outcome === "unfulfilled" ||
      result.outcome === "recovery-required" ||
      result.outcome === "need-update"
    ) {
      process.exitCode = 1;
    }
    return;
  }
  const [kind, id, ...extra] = parsed.positionals;
  if (
    (kind !== "roadmap" && kind !== "gate" && kind !== "effort") ||
    id === undefined ||
    extra.length > 0
  ) {
    throw new CommandUsageError(
      "Usage: bearing inspect <roadmap|gate|effort> <stable-id> [--repo <path>] [--portal-entry <catalog-entry-id>]",
    );
  }
  const repoRoot = resolve(parsed.values.repo ?? process.cwd());
  const metricsFile = parsed.values["benchmark-metrics-file"];
  const instrumentation =
    metricsFile === undefined ? undefined : createPlanningGraphInstrumentation();
  const plan = await prepareSync(
    repoRoot,
    instrumentation === undefined ? {} : { planningGraphInstrumentation: instrumentation },
  );
  const closureStarted = performance.now();
  const result = plan.planningGraph.contextFor({ kind, id });
  const closureCompleted = performance.now();
  await commitSyncPlan(plan);
  const outputStarted = performance.now();
  const portalEntry = parsed.values["portal-entry"];
  const outputValue =
    portalEntry === undefined
      ? result
      : {
          ...result,
          handoff: createPlanningLineageAgentHandoff(portalEntry, { kind, id }),
        };
  const output = `${JSON.stringify(outputValue, null, 2)}\n`;
  const outputCompleted = performance.now();
  process.stdout.write(output);
  if (metricsFile !== undefined && instrumentation !== undefined) {
    const observed = instrumentation.snapshot();
    writeInspectBenchmarkMetrics(repoRoot, metricsFile, {
      schemaVersion: 1,
      benchmark: "inspect-sample",
      processId: process.pid,
      runtime: { nodeVersion: process.version },
      target: { kind, id },
      fingerprint: result.fingerprint,
      state: result.state,
      phases: {
        discovery: plan.metrics.phaseMs.discovery,
        capture: plan.metrics.phaseMs.capture,
        decode: plan.metrics.phaseMs.decode,
        graphBuild: plan.planningPhaseMs.graphBuild,
        closure: closureCompleted - closureStarted,
        output: plan.planningPhaseMs.output + (outputCompleted - outputStarted),
        cacheComparison: plan.planningPhaseMs.cacheComparison,
      },
      structural: {
        inputReads: plan.metrics.inputReadCount,
        capturedInputs: plan.metrics.capturedInputCount,
        bearingRecords: plan.metrics.bearingRecordCount,
        recordDecodes: plan.metrics.recordDecodeCount,
        providerObservations: plan.metrics.providerAcquisitionCount,
        planningGraphBuilds: observed.planningGraphBuilds,
        rootClosures: observed.rootClosures,
        repositoryRevalidations: plan.metrics.repositoryRevalidationCount,
      },
    });
  }
  if (result.state === "invalid") process.exitCode = 1;
};

class CommandUsageError extends Error {
  readonly exitCode = 2;
  readonly name = "CommandUsageError";
}

const runPortal = async (args: readonly string[]): Promise<void> => {
  const port = parsePortalPort(args, process.env);
  const server = await startPortalServer({
    packageRoot: packageRoot(),
    packageVersion: packageMetadata.version,
    homeDir: homeDirectory(),
    port,
  });
  process.stdout.write(`Bearing Portal ready: ${server.url}\n`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await server.close();
  process.stdout.write("Bearing Portal stopped.\n");
};

const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) {
    await runInstallWizard();
    return;
  }
  if (command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${packageMetadata.version}\n`);
    return;
  }
  if (command === "install") {
    await runInstall(args);
    return;
  }
  if (command === "setup") {
    await runSetup(args);
    return;
  }
  if (command === "activation") {
    await runActivationCheck(args);
    return;
  }
  if (command === "deactivate" || command === "purge") {
    await runRepositoryLifecycle(command, args);
    return;
  }
  if (command === "catalog") {
    process.stdout.write(await runCatalogCommand(args, homeDirectory()));
    return;
  }
  if (command === "asset") {
    await runAssetCommand(args);
    return;
  }
  if (command === "sync") {
    await runSyncCommand(args);
    return;
  }
  if (command === "reconcile-native") {
    await runNativeReconciliationCommand(args);
    return;
  }
  if (command === "provider") {
    await runProviderCommand(args);
    return;
  }
  if (command === "cache") {
    await runCacheCommand(args);
    return;
  }
  if (command === "inspect") {
    await runInspectCommand(args);
    return;
  }
  if (command === "portal") {
    await runPortal(args);
    return;
  }
  throw new Error("Unknown command. Run bearing --help.");
};

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error instanceof CommandUsageError ? error.exitCode : 1;
}
