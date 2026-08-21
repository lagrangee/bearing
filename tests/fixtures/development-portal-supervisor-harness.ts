import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runDevelopmentPortalCommand } from "../../src/development-portal-supervisor";
import { resolveRepositoryRuntime } from "../../src/development-runtime";

const [repositoryRoot, encodedPort, encodedHealthDelay = "0"] = process.argv.slice(2);
if (repositoryRoot === undefined || encodedPort === undefined) {
  throw new Error("Development Portal test harness requires a repository and port.");
}
const port = Number(encodedPort);
const healthDelay = Number(encodedHealthDelay);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("Development Portal test harness port is invalid.");
}
if (!Number.isInteger(healthDelay) || healthDelay < 0) {
  throw new Error("Development Portal test harness health delay is invalid.");
}
const packageRoot = process.cwd();
const cliLocator = join(packageRoot, "dist/cli.js");
const runtime = await resolveRepositoryRuntime({
  repoRoot: repositoryRoot,
  packageRoot,
  publicHomeDir: process.env["HOME"] ?? packageRoot,
  invokedCliPath: cliLocator,
});
if (runtime.outcome !== "resolved") {
  process.stderr.write(`${JSON.stringify(runtime)}\n`);
  process.exitCode = 1;
} else {
  try {
    const childExecutable = Bun.which("node");
    if (childExecutable === null) throw new Error("Node.js test runtime is unavailable.");
    await runDevelopmentPortalCommand({
      context: runtime.context,
      packageRoot,
      cliLocator,
      childExecutable,
      ...(healthDelay === 0
        ? {}
        : {
            readHealth: async (url: string, signal: AbortSignal): Promise<Response> => {
              await delay(healthDelay, undefined, { signal });
              return fetch(url, { signal });
            },
          }),
      port,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
