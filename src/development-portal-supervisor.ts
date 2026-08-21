import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
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

type ChildExit = Readonly<{ code: number | null; signal: NodeJS.Signals | null }>;

type RunningDevelopmentPortalChild = Readonly<{
  health: DevelopmentPortalHealth;
  exited: Promise<ChildExit>;
  close(): Promise<void>;
}>;

type HealthReader = (url: string, signal: AbortSignal) => Promise<Response>;

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
  const interrupted = new Promise<never>((_resolve, rejectInterrupted) => {
    const reject = (): void => rejectInterrupted(options.signal.reason);
    if (options.signal.aborted) reject();
    else options.signal.addEventListener("abort", reject, { once: true });
  });
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
  port?: number;
}): Promise<void> => {
  if (
    options.context.receipt.channel !== "development" ||
    options.context.repositoryRoot !== (await realpath(resolve(options.packageRoot)))
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
  try {
    running = await startDevelopmentPortalChild({
      context: options.context,
      cliLocator: options.cliLocator,
      childExecutable: options.childExecutable ?? process.execPath,
      signal: shutdownController.signal,
      readHealth:
        options.readHealth ??
        ((url, signal) =>
          fetch(url, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(START_TIMEOUT_MS)]),
          })),
      port: options.port ?? DEVELOPMENT_PORTAL_PORT,
    });
    if (shutdownController.signal.aborted) return;
    reportedCurrent = true;
    process.stdout.write(
      `Bearing Development Portal current: ${JSON.stringify(running.health.development)}\n`,
    );
    const outcome = await Promise.race([
      shutdown.then(() => "shutdown" as const),
      running.exited.then(() => "child-exited" as const),
    ]);
    if (outcome === "child-exited") {
      throw new Error("Development Portal child exited while the supervisor was current.");
    }
  } catch (error) {
    if (!shutdownController.signal.aborted) throw error;
  } finally {
    await running?.close();
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
  }
  if (reportedCurrent) process.stdout.write("Bearing Development Portal stopped.\n");
};
