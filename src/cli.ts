#!/usr/bin/env node

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import packageMetadata from "../package.json";
import { CatalogCommandUsageError, runCatalogCommand } from "./catalog/cli";
import {
  DEVELOPMENT_PORTAL_PORT,
  runDevelopmentPortalCommand,
} from "./development-portal-supervisor";
import { bootstrapDevelopmentRuntime, resolveRepositoryRuntime } from "./development-runtime";
import {
  executorNominationAssessmentSchema,
  resolveExecutorNominations,
} from "./executor-registration";
import { installKit, uninstallGlobalKit } from "./installer";
import {
  nativeReferenceSchema,
  nativeWorkAffectedRelationSchema,
  normalizeNativeReconciliationRequest,
} from "./native-reconciliation-contract";
import { resolveRepositoryRoot } from "./path-boundary";
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
import {
  applyRepositoryConfiguration,
  inspectRepositoryConfiguration,
  planRepositoryConfiguration,
} from "./repository-configuration";
import { activeRuntimeContext, withRuntimeExecutionContext } from "./runtime-context";
import type { AgentSurface } from "./types";

const INSPECT_USAGE =
  "Usage: bearing inspect <project|diagnostics|stable-planning-reference> [--repo <path>]\n       bearing inspect --native <native-reference> [--repo <path>]";

const HELP = `Bearing ${packageMetadata.version}

Usage:
  bearing
  bearing install [--surface <agent-skills|claude>] [--surface <agent-skills|claude>] [--confirm-downgrade]
  bearing configure
  bearing configure inspect [--repo <path>]
  bearing configure plan --intent <activate|deactivate> [--repo <path>] [--runtime <stable|development>] [--surface <agent-skills|claude>] [--provider-contract <repository-relative-path>] [--executor-mode <skip|configure>] [--executor <surface:skill> --executor-assessment <json>] [--retain-executor <profile>] [--remove-executor <profile>]
  bearing configure apply --intent <activate|deactivate> --plan-token <sha256> [configuration options from the reviewed plan]
  bearing catalog <inspect|rename|unregister|relink|reset> [options]
  bearing reconcile-native --scope <opaque-native-scope> [--ref <native-reference>] [--relation <json>] [--repo <path>]
  bearing provider capture --scope <opaque-native-scope> [--scope <opaque-native-scope>] [--repo <path>]
  bearing provider verify --all [--repo <path>]
  bearing cache rebuild [--repo <path>]
  bearing inspect <project|diagnostics|stable-planning-reference> [--repo <path>]
  bearing inspect --native <native-reference> [--repo <path>]
  bearing portal [--port <1-65535>]
  bearing runtime <inspect|bootstrap> [--repo <path>]
  bearing --help
  bearing --version

Commands:
  <none>   Run Global Kit Install, Update, Repair, or Uninstall in one terminal wizard.
  install  Install the global bundle and CLI, with optional known Agent Surface integration.
  configure  Inspect, seal, and apply one exact Repository Configuration write set.
  catalog  Apply an explicit user-level Project Catalog lifecycle or recovery operation.
  reconcile-native  Re-observe only the native subjects and relations affected by one completed Matt transaction.
  provider  Explicitly capture exact Work Binding scopes or verify all current scopes.
  cache     Rebuild only the disposable repository Project Read Model.
  inspect  Read one typed result from the current Project Read Model generation.
  portal   Run the foreground loopback Portal Host and compiled browser Module.
  development portal  Run the source-only Development Portal supervisor on fixed port 4188.
  runtime  Inspect or explicitly bootstrap the selected repository runtime.

Environment:
  BEARING_PORT  Override the Portal port when --port is absent.
`;

const surfaceSchema = z.array(z.enum(["agent-skills", "claude"]));
const configurationIntentSchema = z.enum(["activate", "deactivate"]);
const executorModeSchema = z.enum(["skip", "configure"]);
const runtimeChannelSchema = z.enum(["stable", "development"]);

const packageRoot = (): string => {
  const adjacent = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return existsSync(join(adjacent, "skills")) ? adjacent : join(adjacent, "kit/current");
};

const homeDirectory = (): string => process.env["HOME"] ?? homedir();
const selectedHomeDirectory = (): string => activeRuntimeContext()?.homeDir ?? homeDirectory();

const writeJson = (value: unknown): void => {
  const context = activeRuntimeContext();
  const output =
    context?.receipt.channel === "development" && typeof value === "object" && value !== null
      ? { ...value, runtime: context.receipt }
      : value;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
};

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

type GlobalKitAction = "Install" | "Update" | "Repair" | "Global Uninstall";

const selectGlobalKitAction = async (): Promise<GlobalKitAction | undefined> => {
  process.stdout.write("1) Install\n2) Update\n3) Repair\n4) Global Uninstall\nq) Cancel\n");
  if (!process.stdin.isTTY) {
    process.stdout.write(
      "Interactive terminal required. Automation can use `bearing install --surface <surface>`.\n",
    );
    return undefined;
  }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await input.question("Select an action [1-4, q]: ")).trim().toLowerCase();
      if (answer === "1") return "Install";
      if (answer === "2") return "Update";
      if (answer === "3") return "Repair";
      if (answer === "4") return "Global Uninstall";
      if (answer === "" || answer === "q") return undefined;
      process.stdout.write("Select 1, 2, 3, 4, or q.\n");
    }
  } finally {
    input.close();
  }
};

const runInstallWizard = async (): Promise<void> => {
  const homeDir = homeDirectory();
  const surfaces = detectedSurfaces(homeDir);
  process.stdout.write(`Bearing Global Kit maintenance\n`);
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
  const action = await selectGlobalKitAction();
  if (action === undefined) {
    process.stdout.write("Outcome: cancelled\n");
    return;
  }
  process.stdout.write(`Action: ${action}\n`);
  if (action === "Global Uninstall") {
    const result = await uninstallGlobalKit(homeDir);
    process.stdout.write(
      `Outcome: ${result.outcome}\nRemoved targets: ${result.removedTargets.length}\nPreserved: Project Catalog, repository state, provider configuration, profiles, artifacts, and native work.\n`,
    );
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

const runConfigure = async (args: readonly string[]): Promise<void> => {
  const [subcommand, ...values] = args;
  if (subcommand === undefined) {
    process.stdout.write(
      "Repository Configuration is Agent-led. Load the selected Bearing Skill, inspect machine facts, resolve one material choice at a time, then review one sealed plan.\n",
    );
    return;
  }
  if (subcommand === "inspect") {
    const parsed = parseArgs({
      args: values,
      options: { repo: { type: "string" } },
      allowPositionals: false,
      strict: true,
    });
    const result = await inspectRepositoryConfiguration({
      repoRoot: resolve(parsed.values.repo ?? process.cwd()),
      packageRoot: packageRoot(),
      homeDir: selectedHomeDirectory(),
    });
    writeJson(result);
    return;
  }
  if (subcommand !== "plan" && subcommand !== "apply") {
    throw new CommandUsageError("Usage: bearing configure <inspect|plan|apply> [options]");
  }
  const parsed = parseArgs({
    args: values,
    options: {
      repo: { type: "string" },
      intent: { type: "string" },
      surface: { type: "string", multiple: true },
      executor: { type: "string", multiple: true },
      "executor-assessment": { type: "string", multiple: true },
      "executor-mode": { type: "string" },
      "provider-contract": { type: "string" },
      runtime: { type: "string" },
      "retain-executor": { type: "string", multiple: true },
      "remove-executor": { type: "string", multiple: true },
      "plan-token": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const intent = configurationIntentSchema.parse(parsed.values.intent);
  const surfaces =
    parsed.values.surface === undefined ? [] : surfaceSchema.parse(parsed.values.surface);
  const provider =
    parsed.values["provider-contract"] === undefined
      ? undefined
      : {
          key: "matt-skills/v1" as const,
          contractLocator: parsed.values["provider-contract"],
        };
  const registrations = await resolveExecutorNominations(
    selectedHomeDirectory(),
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
  const request = {
    repoRoot: resolve(parsed.values.repo ?? process.cwd()),
    packageRoot: packageRoot(),
    homeDir: selectedHomeDirectory(),
    intent,
    ...(parsed.values.runtime === undefined
      ? {}
      : { runtime: runtimeChannelSchema.parse(parsed.values.runtime) }),
    surfaces,
    ...(provider === undefined ? {} : { provider }),
    ...(parsed.values["executor-mode"] === undefined
      ? {}
      : { executorDecision: executorModeSchema.parse(parsed.values["executor-mode"]) }),
    registrations,
    retainProfiles: parsed.values["retain-executor"] ?? [],
    removeProfiles: parsed.values["remove-executor"] ?? [],
  };
  if (subcommand === "plan") {
    const plan = await planRepositoryConfiguration(request);
    writeJson(plan);
    if (!plan.canApply) process.exitCode = 1;
    return;
  }
  if (parsed.values["plan-token"] === undefined) {
    throw new CommandUsageError("Configure Apply requires --plan-token from the reviewed plan.");
  }
  const result = await applyRepositoryConfiguration({
    ...request,
    sealedPlanToken: parsed.values["plan-token"],
  });
  writeJson(result);
  if (result.outcome === "partial" || result.outcome === "blocked") {
    process.exitCode = 1;
  }
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
  writeJson({ ...result, request });
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
  const repoRoot = resolve(parsed.values.repo ?? process.cwd());
  const result =
    operation === "capture"
      ? await captureProjectProviderScopes(repoRoot, parsed.values.scope ?? [])
      : await verifyAllProjectProviderScopes(repoRoot);
  writeJson(result);
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
  writeJson(result);
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
        },
        allowPositionals: true,
        strict: true,
      });
    } catch (error) {
      throw new CommandUsageError(INSPECT_USAGE, { cause: error });
    }
  })();
  const [request, ...requestExtra] = parsed.positionals;
  if ((request === undefined) === (parsed.values.native === undefined) || requestExtra.length > 0) {
    throw new CommandUsageError(INSPECT_USAGE);
  }
  {
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
      throw new CommandUsageError(INSPECT_USAGE);
    }
    const result = await inspectProject(
      await resolveRepositoryRoot(resolve(parsed.values.repo ?? process.cwd())),
      inspectRequest,
    );
    writeJson(result);
    if (
      result.outcome === "unfulfilled" ||
      result.outcome === "recovery-required" ||
      result.outcome === "need-update"
    ) {
      process.exitCode = 1;
    }
    return;
  }
};

class CommandUsageError extends Error {
  readonly exitCode = 2;
  readonly name = "CommandUsageError";
}

const runPortal = async (args: readonly string[]): Promise<void> => {
  const port = parsePortalPort(args, process.env);
  const runtime = activeRuntimeContext();
  const server = await startPortalServer({
    packageRoot: packageRoot(),
    packageVersion: packageMetadata.version,
    homeDir: selectedHomeDirectory(),
    port,
    ...(runtime?.receipt.channel === "development"
      ? {
          developmentRuntimeIdentity: {
            schemaVersion: 1 as const,
            channel: "development" as const,
            runtimeIdentity: runtime.receipt.runtimeIdentity,
            stateRootIdentity: runtime.receipt.stateRootIdentity,
          },
        }
      : {}),
  });
  process.stdout.write(`Bearing Portal ready: ${server.url}\n`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await server.close();
  process.stdout.write("Bearing Portal stopped.\n");
};

const runDevelopmentCommand = async (args: readonly string[]): Promise<void> => {
  const [operation, ...operationArgs] = args;
  if (operation !== "portal") {
    throw new CommandUsageError("Usage: bearing development portal [--repo <path>]");
  }
  parseArgs({
    args: operationArgs,
    options: { repo: { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  const context = activeRuntimeContext();
  if (context === undefined) throw new Error("Development Runtime context is unavailable.");
  await runDevelopmentPortalCommand({
    context,
    packageRoot: packageRoot(),
    cliLocator: fileURLToPath(import.meta.url),
    resolveCurrentRuntime: () =>
      resolveRepositoryRuntime({
        repoRoot: context.repositoryRoot,
        packageRoot: packageRoot(),
        publicHomeDir: homeDirectory(),
        invokedCliPath: fileURLToPath(import.meta.url),
      }),
    port: DEVELOPMENT_PORTAL_PORT,
  });
};

const repositoryRootArgument = (args: readonly string[]): string => {
  const index = args.indexOf("--repo");
  return resolve(index === -1 ? process.cwd() : (args[index + 1] ?? process.cwd()));
};

const runRuntimeCommand = async (args: readonly string[]): Promise<void> => {
  const [operation, ...operationArgs] = args;
  if (operation !== "inspect" && operation !== "bootstrap") {
    throw new CommandUsageError("Usage: bearing runtime <inspect|bootstrap> [--repo <path>]");
  }
  const parsed = parseArgs({
    args: operationArgs,
    options: { repo: { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  const options = {
    repoRoot: resolve(parsed.values.repo ?? process.cwd()),
    packageRoot: packageRoot(),
    publicHomeDir: homeDirectory(),
    invokedCliPath: fileURLToPath(import.meta.url),
  };
  const result =
    operation === "bootstrap"
      ? await bootstrapDevelopmentRuntime(options)
      : await resolveRepositoryRuntime(options);
  writeJson(result);
  if (result.outcome !== "resolved" && result.outcome !== "applied" && result.outcome !== "no-op") {
    process.exitCode = 1;
  }
};

const dispatchRepositoryCommand = async (
  command: string,
  args: readonly string[],
): Promise<void> => {
  if (command === "configure") {
    await runConfigure(args);
    return;
  }
  if (command === "catalog") {
    process.stdout.write(await runCatalogCommand(args, selectedHomeDirectory()));
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
  if (command === "development") {
    await runDevelopmentCommand(args);
    return;
  }
  throw new Error("Unknown command. Run bearing --help.");
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
  if (command === "runtime") {
    await runRuntimeCommand(args);
    return;
  }
  if (command === "configure" && args.length === 0) {
    await runConfigure(args);
    return;
  }
  if (command === "catalog" && ["--help", "-h"].includes(args[0] ?? "")) {
    await dispatchRepositoryCommand(command, args);
    return;
  }
  const runtime = await resolveRepositoryRuntime({
    repoRoot: repositoryRootArgument(args),
    packageRoot: packageRoot(),
    publicHomeDir: homeDirectory(),
    invokedCliPath: fileURLToPath(import.meta.url),
  });
  if (runtime.outcome !== "resolved") {
    writeJson(runtime);
    process.exitCode = 1;
    return;
  }
  await withRuntimeExecutionContext(runtime.context, () =>
    dispatchRepositoryCommand(command, args),
  );
};

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode =
    error instanceof CommandUsageError || error instanceof CatalogCommandUsageError
      ? error.exitCode
      : 1;
}
