import { spawn } from "node:child_process";

export type SqliteProcessEvidence = Readonly<{
  processId: number;
  nodeVersion: string;
  peakRssBytes: number;
  publicationCount: number;
  [key: string]: unknown;
}>;

export type SqliteProcessResult<Value extends SqliteProcessEvidence = SqliteProcessEvidence> =
  Readonly<{
    invocation: readonly string[];
    exitCode: 0;
    stdout: string;
    stderr: string;
    value: Value;
  }>;

export const processEvidence = (
  publicationCount: number,
): Pick<
  SqliteProcessEvidence,
  "processId" | "nodeVersion" | "peakRssBytes" | "publicationCount"
> => ({
  processId: process.pid,
  nodeVersion: process.version,
  peakRssBytes: process.resourceUsage().maxRSS * ("bun" in process.versions ? 1 : 1024),
  publicationCount,
});

const runNodeProcess = async <Value extends SqliteProcessEvidence>(
  args: readonly string[],
): Promise<SqliteProcessResult<Value>> => {
  const invocation = [process.execPath, ...args] as const;
  const child = spawn(process.execPath, [...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(
      `SQLite product process exited ${exitCode}: ${stderr.trim() || stdout.trim() || "no output"}`,
    );
  }
  let value: Value;
  try {
    value = JSON.parse(stdout) as Value;
  } catch (error) {
    throw new Error("SQLite product process returned invalid JSON evidence.", { cause: error });
  }
  if (
    value.processId !== child.pid ||
    value.nodeVersion !== process.version ||
    !Number.isFinite(value.peakRssBytes) ||
    value.peakRssBytes <= 0 ||
    !Number.isInteger(value.publicationCount) ||
    value.publicationCount < 0
  ) {
    throw new Error("SQLite product process returned invalid process evidence.");
  }
  return { invocation, exitCode: 0, stdout, stderr, value };
};

export const runNodeProcessGroup = async <
  Value extends SqliteProcessEvidence = SqliteProcessEvidence,
>(
  commands: readonly (readonly string[])[],
): Promise<readonly SqliteProcessResult<Value>[]> =>
  Promise.all(commands.map((command) => runNodeProcess<Value>(command)));
