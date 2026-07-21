#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  BENCHMARK_SCALES,
  type BenchmarkScale,
  type BenchmarkScenario,
  type BenchmarkWorkerResult,
  runBenchmarkWorker,
  runtimeMetadata,
  summarizeWorkers,
} from "./sync-benchmark-lib";

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    worker: { type: "boolean" },
    scale: { type: "string" },
    scenario: { type: "string" },
    "process-index": { type: "string" },
    output: { type: "string" },
  },
  strict: true,
  allowPositionals: false,
});

const isScale = (value: string | undefined): value is BenchmarkScale =>
  value === "representative" || value === "stress";
const isScenario = (value: string | undefined): value is BenchmarkScenario =>
  value === "no-op" ||
  value === "changed-bearing-record" ||
  value === "changed-native-work" ||
  value === "invalid-bearing-record";

const runWorker = async (): Promise<void> => {
  const scale = parsed.values.scale;
  const scenario = parsed.values.scenario;
  const processIndex = Number.parseInt(parsed.values["process-index"] ?? "", 10);
  if (!isScale(scale) || !isScenario(scenario) || !Number.isInteger(processIndex)) {
    throw new Error("Worker requires a valid scale, scenario, and process index.");
  }
  const result = await runBenchmarkWorker({ scale, scenario, processIndex });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

const child = async (
  scale: BenchmarkScale,
  scenario: BenchmarkScenario,
  processIndex: number,
): Promise<BenchmarkWorkerResult> =>
  new Promise((resolve, reject) => {
    const workerProcess = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        "--worker",
        "--scale",
        scale,
        "--scenario",
        scenario,
        "--process-index",
        processIndex.toString(),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    workerProcess.stdout.setEncoding("utf8");
    workerProcess.stderr.setEncoding("utf8");
    workerProcess.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    workerProcess.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    workerProcess.once("error", reject);
    workerProcess.once("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Benchmark worker exited with code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as BenchmarkWorkerResult);
      } catch (error) {
        reject(new Error("Benchmark worker returned invalid JSON.", { cause: error }));
      }
    });
  });

const runCoordinator = async (): Promise<void> => {
  const workers: BenchmarkWorkerResult[] = [];
  for (const scale of ["representative", "stress"] as const) {
    for (const scenario of BENCHMARK_SCALES[scale].scenarios) {
      for (let processIndex = 1; processIndex <= 3; processIndex += 1) {
        workers.push(await child(scale, scenario, processIndex));
      }
    }
  }
  const summaries = Object.fromEntries(
    (["representative", "stress"] as const).flatMap((scale) =>
      BENCHMARK_SCALES[scale].scenarios.map((scenario) => {
        const selected = workers.filter(
          (worker) => worker.scale === scale && worker.scenario === scenario,
        );
        return [`${scale}:${scenario}`, summarizeWorkers(selected)];
      }),
    ),
  );
  const representative = summaries["representative:no-op"];
  const stress = summaries["stress:no-op"];
  if (representative === undefined || stress === undefined) {
    throw new Error("No-op scale summaries are unavailable.");
  }
  const scaleRatio = stress.total.medianMs / representative.total.medianMs;
  const output = {
    schemaVersion: 1,
    benchmark: "after-only-sync",
    definition: {
      processCountPerScenario: 3,
      scales: BENCHMARK_SCALES,
      historicalBaseline: false,
      structuralAssertions: {
        oneReadPerCapturedInput: true,
        oneDecodePerBearingRecord: true,
        zeroRepositoryRevalidation: true,
      },
    },
    runtime: runtimeMetadata(),
    summaries,
    scaleAssessment: {
      inputRatio: BENCHMARK_SCALES.stress.inputCount / BENCHMARK_SCALES.representative.inputCount,
      noOpMedianLatencyRatio: scaleRatio,
      concern: scaleRatio > 5,
      rule: "A roughly fourfold input increase exceeding fivefold median latency requires explanation.",
    },
    workers,
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (parsed.values.output === undefined) process.stdout.write(serialized);
  else await writeFile(parsed.values.output, serialized);
};

try {
  if (parsed.values.worker === true) await runWorker();
  else await runCoordinator();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
