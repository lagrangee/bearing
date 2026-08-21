import { readFile, watch, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runDevelopmentPortalCommand } from "../../src/development-portal-supervisor";
import { resolveRepositoryRuntime } from "../../src/development-runtime";
import type { RuntimeExecutionContext, RuntimeReceipt } from "../../src/runtime-context";

type ControlledRuntimeResolution =
  | Readonly<{ outcome: "unfulfilled"; diagnostics: unknown[] }>
  | Readonly<{
      outcome: "resolved";
      receipt: RuntimeReceipt;
      commandReceipt?: RuntimeReceipt;
      context?: Pick<RuntimeExecutionContext, "homeDir" | "projectReadModelPath">;
    }>;

const [repositoryRoot, encodedPort, encodedHealthDelay = "0", controlRoot] = process.argv.slice(2);
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
    const controlledInitial =
      controlRoot === undefined
        ? undefined
        : (JSON.parse(
            await readFile(join(controlRoot, "runtime.json"), "utf8"),
          ) as ControlledRuntimeResolution);
    const initialContext =
      controlledInitial?.outcome === "resolved"
        ? {
            ...runtime.context,
            ...controlledInitial.context,
            receipt: controlledInitial.commandReceipt ?? controlledInitial.receipt,
          }
        : runtime.context;
    const childExecutable = Bun.which("node");
    if (childExecutable === null) throw new Error("Node.js test runtime is unavailable.");
    await runDevelopmentPortalCommand({
      context: initialContext,
      packageRoot,
      cliLocator:
        controlRoot === undefined
          ? cliLocator
          : (process.env["BEARING_TEST_DEVELOPMENT_CHILD_LOCATOR"] ??
            join(packageRoot, "tests/fixtures/development-portal-child-harness.ts")),
      childExecutable:
        controlRoot === undefined
          ? childExecutable
          : (process.env["BEARING_TEST_DEVELOPMENT_CHILD_EXECUTABLE"] ?? Bun.which("bun") ?? "bun"),
      ...(controlRoot === undefined
        ? {}
        : {
            resolveCurrentRuntime: async () => {
              const transientFailuresPath = join(controlRoot, "transient-failures.txt");
              const transientFailures = await readFile(transientFailuresPath, "utf8").then(
                (value) => Number(value.trim()),
                () => 0,
              );
              if (transientFailures > 0) {
                await writeFile(transientFailuresPath, `${transientFailures - 1}\n`);
                const transient = {
                  outcome: "unfulfilled" as const,
                  diagnostics: [
                    {
                      code: "development-build-publication-in-progress",
                      impact: "blocking",
                      target: "dist",
                    },
                  ],
                };
                await writeFile(
                  join(controlRoot, "resolution-readback.json"),
                  `${JSON.stringify(transient)}\n`,
                );
                return transient;
              }
              const value = JSON.parse(
                await readFile(join(controlRoot, "runtime.json"), "utf8"),
              ) as ControlledRuntimeResolution;
              await writeFile(
                join(controlRoot, "resolution-readback.json"),
                `${JSON.stringify(value)}\n`,
              );
              return value.outcome === "resolved"
                ? {
                    outcome: "resolved" as const,
                    context: { ...runtime.context, ...value.context, receipt: value.receipt },
                  }
                : value;
            },
            observeBuildPublications: async function* (signal: AbortSignal) {
              for await (const event of watch(controlRoot, { signal })) {
                if (event.filename === "publication") yield;
              }
            },
          }),
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
