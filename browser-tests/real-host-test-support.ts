import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Route } from "@playwright/test";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export const fulfillOnePixelPng = (route: Route): Promise<void> =>
  route.fulfill({ status: 200, contentType: "image/png", body: onePixelPng });

export const writeCatalogFixture = async (
  homeDir: string,
  entries: readonly Readonly<{ entryId: string; repoRoot: string; displayName: string }>[],
): Promise<void> => {
  const directory = join(homeDir, ".bearing");
  await mkdir(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "catalog.sqlite"));
  try {
    database.exec(`
      CREATE TABLE catalog_entries (
        entry_id TEXT PRIMARY KEY NOT NULL,
        repo_root TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0)
      ) STRICT;
      PRAGMA user_version = 1;
    `);
    const insert = database.prepare(
      "INSERT INTO catalog_entries(entry_id, repo_root, display_name) VALUES (?, ?, ?)",
    );
    for (const entry of entries) insert.run(entry.entryId, entry.repoRoot, entry.displayName);
  } finally {
    database.close();
  }
};

const projectReadModelOutputs = ["project-read-model.sqlite"] as const;

const defaultCommandTimeoutMs = 30_000;
const defaultTermGraceMs = 5_000;
const defaultKillGraceMs = 2_000;
const maximumCapturedCharacters = 1_048_576;

type StoppableProcess = Pick<
  ChildProcessWithoutNullStreams,
  "exitCode" | "signalCode" | "pid" | "kill" | "once" | "removeListener"
>;

type ProcessStopOptions = Readonly<{
  label: string;
  termGraceMs?: number;
  killGraceMs?: number;
}>;

type HarnessCommandOptions = Readonly<{
  environment: NodeJS.ProcessEnv;
  timeoutMs?: number;
  cwd?: string;
  label?: string;
}>;

export type HarnessCommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

const hasClosed = (child: StoppableProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

const processGroupExists = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    if (error instanceof Error && "code" in error && error.code === "EPERM") return true;
    throw error;
  }
};

const isFullyStopped = (child: StoppableProcess): boolean =>
  hasClosed(child) && (child.pid === undefined || !processGroupExists(child.pid));

const waitForStopped = async (child: StoppableProcess, timeoutMs: number): Promise<boolean> => {
  if (isFullyStopped(child)) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
    if (isFullyStopped(child)) return true;
  }
  return isFullyStopped(child);
};

const sendSignal = (child: StoppableProcess, signal: NodeJS.Signals): boolean => {
  try {
    if (child.pid === undefined) return child.kill(signal);
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    if (!hasClosed(child)) return child.kill(signal);
    return false;
  }
};

export const stopHarnessProcess = async (
  child: StoppableProcess,
  options: ProcessStopOptions,
): Promise<void> => {
  if (isFullyStopped(child)) return;
  const termGraceMs = options.termGraceMs ?? defaultTermGraceMs;
  const killGraceMs = options.killGraceMs ?? defaultKillGraceMs;
  if (!sendSignal(child, "SIGTERM") && isFullyStopped(child)) return;
  if (await waitForStopped(child, termGraceMs)) return;
  if (!sendSignal(child, "SIGKILL") && isFullyStopped(child)) return;
  if (await waitForStopped(child, killGraceMs)) return;
  throw new Error(
    `${options.label} did not close within ${termGraceMs + killGraceMs}ms after TERM then KILL.`,
  );
};

export const spawnHarnessProcess = (
  command: string,
  args: readonly string[],
  options: Pick<HarnessCommandOptions, "environment" | "cwd">,
): ChildProcessWithoutNullStreams =>
  spawn(command, [...args], {
    cwd: options.cwd ?? process.cwd(),
    detached: true,
    env: options.environment,
    stdio: ["pipe", "pipe", "pipe"],
  });

export const runHarnessCommand = async (
  command: string,
  args: readonly string[],
  options: HarnessCommandOptions,
): Promise<HarnessCommandResult> => {
  const label = options.label ?? command;
  const timeoutMs = options.timeoutMs ?? defaultCommandTimeoutMs;
  const child = spawnHarnessProcess(command, args, options);
  child.stdin.end();
  let stdout = "";
  let stderr = "";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let commandFailure: unknown;
  let exitCode: number | undefined;
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout = `${stdout}${chunk}`.slice(-maximumCapturedCharacters);
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-maximumCapturedCharacters);
  });
  try {
    exitCode = await Promise.race([
      new Promise<number>((resolveExit, rejectExit) => {
        child.once("error", (error) =>
          rejectExit(new Error(`${label} failed to start: ${error.message}`, { cause: error })),
        );
        child.once("close", (code) => resolveExit(code ?? 1));
      }),
      new Promise<never>((_resolve, rejectTimeout) => {
        timeout = setTimeout(
          () =>
            rejectTimeout(new Error(`${label} timed out after ${timeoutMs}ms: ${stderr.trim()}`)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    commandFailure = error;
  }
  if (timeout !== undefined) clearTimeout(timeout);
  let stopFailure: unknown;
  try {
    await stopHarnessProcess(child, { label });
  } catch (error) {
    stopFailure = error;
  }
  if (commandFailure !== undefined && stopFailure !== undefined) {
    throw new AggregateError(
      [commandFailure, stopFailure],
      `${label} failed and its process could not be stopped cleanly.`,
    );
  }
  if (commandFailure !== undefined) throw commandFailure;
  if (stopFailure !== undefined) throw stopFailure;
  if (exitCode === undefined) throw new Error(`${label} produced no exit status.`);
  return { exitCode, stdout, stderr };
};

export const waitForHarnessLine = async (
  child: ChildProcessWithoutNullStreams,
  expected: string,
  options: Readonly<{ label: string; timeoutMs: number }>,
): Promise<void> =>
  new Promise<void>((resolveReady, rejectReady) => {
    let stdout = "";
    let stderr = "";
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.removeListener("data", onStdout);
      child.stderr.removeListener("data", onStderr);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
    };
    const succeed = (): void => {
      cleanup();
      child.stdout.resume();
      child.stderr.resume();
      resolveReady();
    };
    const fail = (error: Error): void => {
      cleanup();
      rejectReady(error);
    };
    const onStdout = (chunk: string): void => {
      stdout = `${stdout}${chunk}`.slice(-maximumCapturedCharacters);
      if (stdout.split(/\r?\n/u).includes(expected)) succeed();
    };
    const onStderr = (chunk: string): void => {
      stderr = `${stderr}${chunk}`.slice(-maximumCapturedCharacters);
    };
    const onError = (error: Error): void => fail(error);
    const onClose = (code: number | null): void =>
      fail(
        new Error(
          `${options.label} exited before readiness with ${code ?? "no code"}: ${stderr.trim()}`,
        ),
      );
    const timeout = setTimeout(
      () =>
        fail(
          new Error(
            `${options.label} readiness timed out after ${options.timeoutMs}ms: ${stderr.trim()}`,
          ),
        ),
      options.timeoutMs,
    );
    child.stdout.setEncoding("utf8").on("data", onStdout);
    child.stderr.setEncoding("utf8").on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
  });

const reservePort = async (): Promise<number> => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (address === null || typeof address === "string") throw new Error("No test port available.");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
};

export const runBuiltBearing = async (
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const result = await runHarnessCommand("node", ["dist/cli.js", ...args], {
    environment,
    label: "built Bearing command",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Built Bearing exited ${result.exitCode}: ${result.stderr.trim()}`);
  }
};

export type RunningTestPortal = Readonly<{
  child: ChildProcessWithoutNullStreams;
  url: string;
}>;

export const startBuiltPortal = async (homeDir: string): Promise<RunningTestPortal> => {
  const port = await reservePort();
  const child = spawnHarnessProcess("node", ["dist/cli.js", "portal", "--port", String(port)], {
    environment: { ...process.env, HOME: homeDir },
  });
  child.stdin.end();
  const expected = `Bearing Portal ready: http://127.0.0.1:${port}`;
  try {
    await waitForHarnessLine(child, expected, { label: "built Portal", timeoutMs: 15_000 });
  } catch (error) {
    try {
      await stopHarnessProcess(child, { label: "built Portal" });
    } catch (stopError) {
      throw new AggregateError(
        [error, stopError],
        "The built Portal failed readiness and could not be stopped cleanly.",
      );
    }
    throw error;
  }
  return { child, url: `http://127.0.0.1:${port}` };
};

export const stopBuiltPortal = async (portal: RunningTestPortal | undefined): Promise<void> => {
  if (portal !== undefined) await stopHarnessProcess(portal.child, { label: "built Portal" });
};

export const projectReadModelHashes = async (
  root: string,
): Promise<Readonly<Record<string, string>>> =>
  Object.fromEntries(
    await Promise.all(
      projectReadModelOutputs.map(async (locator) => {
        try {
          return [
            locator,
            createHash("sha256")
              .update(await readFile(join(root, ".bearing/cache", locator)))
              .digest("hex"),
          ];
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return [locator, "missing"];
          }
          throw error;
        }
      }),
    ),
  );

export const preserveProjectReadModel = async (root: string, target: string): Promise<void> => {
  await mkdir(target, { recursive: true });
  await Promise.all(
    projectReadModelOutputs.map((locator) =>
      copyFile(join(root, ".bearing/cache", locator), join(target, locator)),
    ),
  );
};
