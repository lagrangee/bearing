import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { realpath, watch } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type DevelopmentPortalHealth,
  developmentPortalHealthSchema,
} from "./development-portal-health";
import type { RuntimeExecutionContext } from "./runtime-context";

export const DEVELOPMENT_PORTAL_PORT = 4188;
export const DEVELOPMENT_PORTAL_RUNTIME_REQUIRED =
  "Development Portal requires the selected source repository Development Runtime. Stable or external runtime state is not accepted.";

const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
const KILL_TIMEOUT_MS = 2_000;
const PUBLICATION_SETTLE_MS = 25;

type ChildExit = Readonly<{ code: number | null; signal: NodeJS.Signals | null }>;

type RunningDevelopmentPortalChild = Readonly<{
  health: DevelopmentPortalHealth;
  exited: Promise<ChildExit>;
  close(): Promise<void>;
}>;

type HealthReader = (url: string, signal: AbortSignal) => Promise<Response>;
type BuildPublicationObserver = (signal: AbortSignal) => AsyncIterable<void>;
type DevelopmentPortalRuntimeResolution =
  | Readonly<{ outcome: "resolved"; context: RuntimeExecutionContext }>
  | Readonly<{ outcome: "unfulfilled" | "recovery-required" | "need-update" }>;

export const observeDevelopmentBuildPublications = (
  sourceRoot: string,
  signal: AbortSignal,
): AsyncIterable<void> => {
  const events = watch(resolve(sourceRoot), { signal });
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<void> {
      try {
        for await (const event of events) {
          if (event.filename === "dist" || event.filename === null) yield;
        }
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
    },
  };
};

const waitFor = async <Result>(
  operation: Promise<Result>,
  timeoutMs: number,
  message: string,
): Promise<Result> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const stopOwnedChild = async (
  child: ChildProcessWithoutNullStreams,
  exited: Promise<ChildExit>,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try {
    await waitFor(exited, STOP_TIMEOUT_MS, "Development Portal child did not stop after TERM.");
    return;
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  await waitFor(exited, KILL_TIMEOUT_MS, "Development Portal child did not stop after KILL.");
};

const portConflict = (port: number): Error =>
  new Error(
    `Development Portal port conflict: 127.0.0.1:${port} is already owned by another process. The process was not inspected, terminated, or adopted.`,
  );

const expectedDevelopmentIdentity = (context: RuntimeExecutionContext) => {
  const receipt = context.receipt;
  if (receipt.channel !== "development" || receipt.portalBuildId === undefined) {
    throw new Error(DEVELOPMENT_PORTAL_RUNTIME_REQUIRED);
  }
  return {
    schemaVersion: 1 as const,
    channel: "development" as const,
    runtimeIdentity: receipt.runtimeIdentity,
    stateRootIdentity: receipt.stateRootIdentity,
    portalBuildIdentity: receipt.portalBuildId,
  };
};

const startDevelopmentPortalChild = async (options: {
  context: RuntimeExecutionContext;
  cliLocator: string;
  childExecutable: string;
  signal: AbortSignal;
  readHealth: HealthReader;
  port: number;
}): Promise<RunningDevelopmentPortalChild> => {
  options.signal.throwIfAborted();
  const expected = expectedDevelopmentIdentity(options.context);
  const child = spawn(
    options.childExecutable,
    [options.cliLocator, "portal", "--port", String(options.port)],
    {
      cwd: options.context.repositoryRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdin.end();
  let stdout = "";
  let stderr = "";
  const readyLine = `Bearing Portal ready: http://127.0.0.1:${options.port}`;
  let resolveReadiness: (() => void) | undefined;
  const readiness = new Promise<void>((resolveReady) => {
    resolveReadiness = resolveReady;
  });
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout = `${stdout}${chunk}`.slice(-1_048_576);
    if (stdout.split(/\r?\n/u).includes(readyLine)) resolveReadiness?.();
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-1_048_576);
  });
  const exited = new Promise<ChildExit>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  let rejectInterruption: (reason?: unknown) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, rejectInterrupted) => {
    rejectInterruption = rejectInterrupted;
  });
  const interrupt = (): void => rejectInterruption(options.signal.reason);
  if (options.signal.aborted) interrupt();
  else options.signal.addEventListener("abort", interrupt, { once: true });
  try {
    try {
      await waitFor(
        Promise.race([
          readiness,
          exited.then(() => {
            if (stderr.includes("Bearing Portal could not bind the loopback Host.")) {
              throw portConflict(options.port);
            }
            throw new Error(
              `Development Portal child failed before readiness: ${(stderr || stdout).trim()}`,
            );
          }),
          interrupted,
        ]),
        START_TIMEOUT_MS,
        "Development Portal child readiness timed out.",
      );
    } finally {
      options.signal.removeEventListener("abort", interrupt);
    }
    const response = await options.readHealth(
      `http://127.0.0.1:${options.port}/healthz`,
      options.signal,
    );
    const health = developmentPortalHealthSchema.parse(await response.json());
    if (!response.ok || JSON.stringify(health.development) !== JSON.stringify(expected)) {
      throw new Error(
        "Development Portal child health identity does not match the selected runtime.",
      );
    }
    return {
      health,
      exited,
      close: () => stopOwnedChild(child, exited),
    };
  } catch (error) {
    await stopOwnedChild(child, exited);
    throw error;
  }
};

export const runDevelopmentPortalCommand = async (options: {
  context: RuntimeExecutionContext;
  packageRoot: string;
  cliLocator: string;
  childExecutable?: string;
  readHealth?: HealthReader;
  resolveCurrentRuntime?: () => Promise<DevelopmentPortalRuntimeResolution>;
  observeBuildPublications?: BuildPublicationObserver;
  port?: number;
}): Promise<void> => {
  const canonicalPackageRoot = await realpath(resolve(options.packageRoot));
  if (
    options.context.receipt.channel !== "development" ||
    options.context.receipt.buildIdentity === undefined ||
    options.context.repositoryRoot !== canonicalPackageRoot
  ) {
    throw new Error(DEVELOPMENT_PORTAL_RUNTIME_REQUIRED);
  }
  const shutdownController = new AbortController();
  let resolveShutdown: (() => void) | undefined;
  const shutdown = new Promise<void>((resolveSignal) => {
    resolveShutdown = resolveSignal;
  });
  const requestShutdown = (): void => {
    shutdownController.abort();
    resolveShutdown?.();
  };
  process.on("SIGINT", requestShutdown);
  process.on("SIGTERM", requestShutdown);
  let running: RunningDevelopmentPortalChild | undefined;
  let reportedCurrent = false;
  const publicationIterator = (
    options.observeBuildPublications ??
    ((signal) => observeDevelopmentBuildPublications(canonicalPackageRoot, signal))
  )(shutdownController.signal)[Symbol.asyncIterator]();
  type SupervisorEvent =
    | Readonly<{ kind: "publication"; done: boolean }>
    | Readonly<{ kind: "observer-failed"; error: unknown }>;
  const observeNextPublication = (): Promise<SupervisorEvent> =>
    publicationIterator.next().then(
      (result) => ({ kind: "publication" as const, done: result.done === true }),
      (error: unknown) => ({ kind: "observer-failed" as const, error }),
    );
  let nextPublication = observeNextPublication();
  let currentContext = options.context;
  let currentBuildIdentity = options.context.receipt.buildIdentity;
  const preservesDevelopmentSelection = (context: RuntimeExecutionContext): boolean =>
    context.repositoryRoot === currentContext.repositoryRoot &&
    context.homeDir === currentContext.homeDir &&
    context.projectReadModelPath === currentContext.projectReadModelPath &&
    context.receipt.channel === "development" &&
    context.receipt.stateRootIdentity === currentContext.receipt.stateRootIdentity &&
    context.receipt.buildIdentity !== undefined &&
    context.receipt.portalBuildId !== undefined;
  const resolvePublishedRuntime = async (): Promise<DevelopmentPortalRuntimeResolution> => {
    if (options.resolveCurrentRuntime === undefined) {
      return { outcome: "resolved", context: currentContext };
    }
    let finalResolution: DevelopmentPortalRuntimeResolution | undefined;
    let finalError: unknown;
    for (const attempt of [0, 1]) {
      try {
        const resolution = await options.resolveCurrentRuntime();
        if (resolution.outcome === "resolved") return resolution;
        finalResolution = resolution;
        finalError = undefined;
      } catch (error) {
        finalError = error;
      }
      if (attempt === 0) {
        await delay(PUBLICATION_SETTLE_MS, undefined, { signal: shutdownController.signal });
      }
    }
    if (finalError !== undefined) throw finalError;
    if (finalResolution !== undefined) return finalResolution;
    throw new Error("Development Runtime resolution produced no result.");
  };
  const childOptions = (context: RuntimeExecutionContext) => ({
    context,
    cliLocator: options.cliLocator,
    childExecutable: options.childExecutable ?? process.execPath,
    signal: shutdownController.signal,
    readHealth:
      options.readHealth ??
      ((url: string, signal: AbortSignal) =>
        fetch(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(START_TIMEOUT_MS)]),
        })),
    port: options.port ?? DEVELOPMENT_PORTAL_PORT,
  });
  try {
    const startupResolution = await resolvePublishedRuntime();
    if (startupResolution.outcome !== "resolved") {
      throw new Error(
        `Development Portal startup runtime resolution is ${startupResolution.outcome}.`,
      );
    }
    const startupBuildIdentity = startupResolution.context.receipt.buildIdentity;
    if (
      !preservesDevelopmentSelection(startupResolution.context) ||
      startupBuildIdentity === undefined
    ) {
      throw new Error(
        "Development Portal startup runtime does not preserve the selected Development repository, State Root, and Project Read Model.",
      );
    }
    currentContext = startupResolution.context;
    currentBuildIdentity = startupBuildIdentity;
    running = await startDevelopmentPortalChild(childOptions(currentContext));
    if (shutdownController.signal.aborted) return;
    reportedCurrent = true;
    process.stdout.write(
      `Bearing Development Portal current: ${JSON.stringify(running.health.development)}\n`,
    );
    const shutdownEvent = shutdown.then(() => ({ kind: "shutdown" as const }));
    let childExitEvent = running.exited.then(() => ({ kind: "child-exited" as const }));
    while (!shutdownController.signal.aborted) {
      const currentChild = running;
      const event = await Promise.race([shutdownEvent, childExitEvent, nextPublication]);
      if (event.kind === "shutdown") break;
      if (event.kind === "child-exited") {
        throw new Error("Development Portal child exited while the supervisor was current.");
      }
      if (event.kind === "observer-failed") throw event.error;
      if (event.done) {
        if (shutdownController.signal.aborted) break;
        throw new Error(
          "Development Build publication observer stopped while the supervisor was current.",
        );
      }
      nextPublication = observeNextPublication();

      let resolution: DevelopmentPortalRuntimeResolution;
      try {
        resolution = await resolvePublishedRuntime();
      } catch (error) {
        process.stderr.write(
          `Bearing Development Portal pending: runtime resolution failed; the current child remains active. ${error instanceof Error ? error.message : String(error)}\n`,
        );
        continue;
      }
      if (shutdownController.signal.aborted) break;
      if (resolution.outcome !== "resolved") {
        process.stderr.write(
          `Bearing Development Portal pending: runtime resolution is ${resolution.outcome}; the current child remains active.\n`,
        );
        continue;
      }
      const nextContext = resolution.context;
      const nextBuildIdentity = nextContext.receipt.buildIdentity;
      if (!preservesDevelopmentSelection(nextContext) || nextBuildIdentity === undefined) {
        process.stderr.write(
          "Bearing Development Portal pending: the published runtime does not preserve the selected Development repository, State Root, and Project Read Model; the current child remains active.\n",
        );
        continue;
      }
      if (nextBuildIdentity === currentBuildIdentity) continue;

      await currentChild.close();
      running = undefined;
      if (shutdownController.signal.aborted) break;
      running = await startDevelopmentPortalChild(childOptions(nextContext));
      currentContext = nextContext;
      currentBuildIdentity = nextBuildIdentity;
      childExitEvent = running.exited.then(() => ({ kind: "child-exited" as const }));
      process.stdout.write(
        `Bearing Development Portal current: ${JSON.stringify(running.health.development)}\n`,
      );
    }
  } catch (error) {
    if (!shutdownController.signal.aborted) throw error;
  } finally {
    shutdownController.abort();
    await running?.close();
    await publicationIterator.return?.();
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
  }
  if (reportedCurrent) process.stdout.write("Bearing Development Portal stopped.\n");
};
