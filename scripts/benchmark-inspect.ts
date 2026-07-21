#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  createInspectBenchmarkReport,
  INSPECT_BENCHMARK_ITERATIONS,
  runInspectBenchmarkWorker,
} from "./inspect-benchmark-lib";

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: { type: "string" },
    warmup: { type: "string" },
    iterations: { type: "string" },
  },
  allowPositionals: false,
  strict: true,
});

const iterationCount = (value: string | undefined, fallback: number, label: string): number => {
  if (value === undefined) return fallback;
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return parsedValue;
};

try {
  const cliPath = join(process.cwd(), "dist/cli.js");
  const warmupIterations = iterationCount(
    parsed.values.warmup,
    INSPECT_BENCHMARK_ITERATIONS.warmup,
    "Warmup iterations",
  );
  const measuredIterations = iterationCount(
    parsed.values.iterations,
    INSPECT_BENCHMARK_ITERATIONS.measured,
    "Measured iterations",
  );
  if (measuredIterations === 0) throw new Error("Measured iterations must be greater than zero.");
  const workers = [];
  for (const scale of ["representative", "stress"] as const) {
    workers.push(
      await runInspectBenchmarkWorker({
        scale,
        cliPath,
        warmupIterations,
        measuredIterations,
        onSample: (event) => {
          const timing = event.e2eMs === undefined ? "" : ` ${event.e2eMs.toFixed(2)}ms`;
          process.stderr.write(
            `[benchmark:inspect] ${scale} ${event.stage} ${event.iteration + 1}/${
              event.stage === "warmup" ? warmupIterations : measuredIterations
            } ${event.target.kind} ${event.state}${timing}\n`,
          );
        },
      }),
    );
  }
  const serialized = `${JSON.stringify(createInspectBenchmarkReport(workers), null, 2)}\n`;
  if (parsed.values.output === undefined) process.stdout.write(serialized);
  else {
    await mkdir(dirname(parsed.values.output), { recursive: true });
    await writeFile(parsed.values.output, serialized);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
