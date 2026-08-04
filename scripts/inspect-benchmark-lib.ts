import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { InspectBenchmarkMetrics } from "../src/inspect-benchmark";
import type { PlanningTarget } from "../src/planning-graph";
import { runSyncMeasured } from "../src/sync";
import {
  BENCHMARK_SCALES,
  type BenchmarkScale,
  createBenchmarkFixture,
  runtimeMetadata,
} from "./sync-benchmark-lib";

export const INSPECT_BENCHMARK_TARGETS = [
  { kind: "roadmap", id: "roadmap:r001" },
  { kind: "gate", id: "gate:g001" },
  { kind: "effort", id: "effort:e001" },
] as const satisfies readonly PlanningTarget[];

export const INSPECT_BENCHMARK_ITERATIONS = Object.freeze({
  warmup: 1,
  measured: 7,
});

export type InspectBenchmarkSample = Readonly<{
  scale: BenchmarkScale;
  target: (typeof INSPECT_BENCHMARK_TARGETS)[number];
  processId: number;
  runtime: InspectBenchmarkMetrics["runtime"];
  invocation: readonly string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  fingerprint: string;
  state: InspectBenchmarkMetrics["state"];
  e2eMs: number;
  phases: InspectBenchmarkMetrics["phases"];
  structural: InspectBenchmarkMetrics["structural"];
}>;

export type InspectBenchmarkWorkerResult = Readonly<{
  scale: BenchmarkScale;
  fixture: Readonly<{
    digest: string;
    inputCount: number;
    bearingRecordCount: number;
    totalBytes: number;
  }>;
  warmupIterations: number;
  measuredIterations: number;
  samples: readonly InspectBenchmarkSample[];
}>;

const nodeExecutable = (): string => (process.execPath.includes("bun") ? "node" : process.execPath);

const textFrom = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const finiteNonnegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

export const assertInspectBenchmarkStructure = (
  structural: InspectBenchmarkMetrics["structural"],
  scale: BenchmarkScale,
): void => {
  const specification = BENCHMARK_SCALES[scale];
  if (
    structural.inputReads !== specification.inputCount ||
    structural.capturedInputs !== specification.inputCount ||
    structural.inputReads !== structural.capturedInputs
  ) {
    throw new Error("Structural assertion failed: every captured input must be read once.");
  }
  if (
    structural.bearingRecords !== specification.bearingRecordCount ||
    structural.recordDecodes !== structural.bearingRecords
  ) {
    throw new Error("Structural assertion failed: every Bearing Record must be decoded once.");
  }
  if (structural.providerObservations !== 0) {
    throw new Error(
      "Structural assertion failed: ordinary Inspect must not acquire provider scopes.",
    );
  }
  if (structural.planningGraphBuilds !== 1) {
    throw new Error("Structural assertion failed: inspect must build one Planning Graph.");
  }
  if (structural.rootClosures !== 1) {
    throw new Error("Structural assertion failed: inspect must resolve one root closure.");
  }
  if (structural.repositoryRevalidations !== 0) {
    throw new Error("Structural assertion failed: repository revalidation must remain zero.");
  }
};

const assertSample = (
  sample: Omit<InspectBenchmarkSample, "scale" | "e2eMs" | "invocation">,
  scale: BenchmarkScale,
): void => {
  if (sample.exitCode !== 0) throw new Error(sample.stderr || "Packaged inspect CLI failed.");
  if (sample.stderr !== "") throw new Error("Packaged inspect CLI wrote unexpected stderr.");
  const output = JSON.parse(sample.stdout) as {
    fingerprint?: unknown;
    state?: unknown;
    target?: unknown;
  };
  if (
    output.fingerprint !== sample.fingerprint ||
    output.state !== sample.state ||
    JSON.stringify(output.target) !== JSON.stringify(sample.target)
  ) {
    throw new Error("Benchmark metrics do not match the stable inspect stdout contract.");
  }
  assertInspectBenchmarkStructure(sample.structural, scale);
  if (!Object.values(sample.phases).every(finiteNonnegative)) {
    throw new Error("Inspect benchmark phase timing must be finite and nonnegative.");
  }
};

export const runPackagedInspectSample = async (options: {
  scale: BenchmarkScale;
  cliPath: string;
  repoRoot: string;
  target: (typeof INSPECT_BENCHMARK_TARGETS)[number];
  timeoutMs?: number;
}): Promise<InspectBenchmarkSample> => {
  const executable = nodeExecutable();
  const invocation = [
    executable,
    options.cliPath,
    "inspect",
    options.target.kind,
    options.target.id,
    "--repo",
    options.repoRoot,
    "--benchmark-metrics-file",
    join(options.repoRoot, ".bearing/cache", `inspect-benchmark-${randomUUID()}.json`),
  ] as const;
  const metricsPath = invocation.at(-1);
  if (metricsPath === undefined) throw new Error("Inspect benchmark metrics path is unavailable.");
  const started = performance.now();
  const child = spawn(executable, invocation.slice(1), {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.stdout === null || child.stderr === null) {
    throw new Error("Packaged inspect CLI benchmark pipes are unavailable.");
  }
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs ?? 60_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    textFrom(child.stdout),
    textFrom(child.stderr),
    new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    }),
  ]).finally(() => clearTimeout(timeout));
  const e2eMs = performance.now() - started;
  if (timedOut) throw new Error(`Packaged inspect CLI exceeded ${options.timeoutMs ?? 60_000}ms.`);
  if (exitCode !== 0) throw new Error(stderr || "Packaged inspect CLI failed.");
  let metrics: InspectBenchmarkMetrics;
  try {
    metrics = JSON.parse(await readFile(metricsPath, "utf8")) as InspectBenchmarkMetrics;
  } catch (error) {
    throw new Error("Packaged inspect CLI returned invalid benchmark metrics.", { cause: error });
  } finally {
    await rm(metricsPath, { force: true });
  }
  if (metrics.schemaVersion !== 1 || metrics.benchmark !== "inspect-sample") {
    throw new Error("Packaged inspect CLI returned an unsupported benchmark contract.");
  }
  const sample = {
    scale: options.scale,
    target: options.target,
    processId: metrics.processId,
    runtime: metrics.runtime,
    invocation,
    exitCode,
    stdout,
    stderr,
    fingerprint: metrics.fingerprint,
    state: metrics.state,
    e2eMs,
    phases: metrics.phases,
    structural: metrics.structural,
  } as const;
  assertSample(sample, options.scale);
  return sample;
};

export const runInspectBenchmarkWorker = async (options: {
  scale: BenchmarkScale;
  cliPath: string;
  warmupIterations?: number;
  measuredIterations?: number;
  onSample?: (
    event: Readonly<{
      stage: "warmup" | "measured";
      iteration: number;
      target: (typeof INSPECT_BENCHMARK_TARGETS)[number];
      state: "started" | "completed";
      e2eMs?: number;
    }>,
  ) => void;
}): Promise<InspectBenchmarkWorkerResult> => {
  const fixture = await createBenchmarkFixture(options.scale);
  const warmupIterations = options.warmupIterations ?? INSPECT_BENCHMARK_ITERATIONS.warmup;
  const measuredIterations = options.measuredIterations ?? INSPECT_BENCHMARK_ITERATIONS.measured;
  try {
    await runSyncMeasured(fixture.root, {
      packageVersion: "0.0.0-benchmark",
      completedAt: "2026-07-18T00:00:00.000Z",
      providerObservationIntent: "initial-baseline",
    });
    for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
      for (const target of INSPECT_BENCHMARK_TARGETS) {
        options.onSample?.({ stage: "warmup", iteration, target, state: "started" });
        const completed = await runPackagedInspectSample({
          scale: options.scale,
          cliPath: options.cliPath,
          repoRoot: fixture.root,
          target,
        });
        options.onSample?.({
          stage: "warmup",
          iteration,
          target,
          state: "completed",
          e2eMs: completed.e2eMs,
        });
      }
    }
    const samples: InspectBenchmarkSample[] = [];
    for (let iteration = 0; iteration < measuredIterations; iteration += 1) {
      for (const target of INSPECT_BENCHMARK_TARGETS) {
        options.onSample?.({ stage: "measured", iteration, target, state: "started" });
        const completed = await runPackagedInspectSample({
          scale: options.scale,
          cliPath: options.cliPath,
          repoRoot: fixture.root,
          target,
        });
        samples.push(completed);
        options.onSample?.({
          stage: "measured",
          iteration,
          target,
          state: "completed",
          e2eMs: completed.e2eMs,
        });
      }
    }
    const first = samples[0];
    if (first === undefined) throw new Error("Inspect benchmark requires measured samples.");
    return {
      scale: options.scale,
      fixture: {
        digest: fixture.digest,
        inputCount: first.structural.capturedInputs,
        bearingRecordCount: first.structural.bearingRecords,
        totalBytes: fixture.totalBytes,
      },
      warmupIterations,
      measuredIterations,
      samples,
    };
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
};

const percentile = (values: readonly number[], fraction: number): number => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
};

const timing = (values: readonly number[]) => ({
  medianMs: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
});

const summarize = (samples: readonly InspectBenchmarkSample[]) => {
  const phases = [
    "discovery",
    "capture",
    "decode",
    "graphBuild",
    "closure",
    "output",
    "cacheComparison",
  ] as const;
  return {
    sampleCount: samples.length,
    e2e: timing(samples.map((sample) => sample.e2eMs)),
    phases: Object.fromEntries(
      phases.map((phase) => [phase, timing(samples.map((sample) => sample.phases[phase]))]),
    ),
    structural: {
      inputReads: [...new Set(samples.map((sample) => sample.structural.inputReads))],
      capturedInputs: [...new Set(samples.map((sample) => sample.structural.capturedInputs))],
      bearingRecords: [...new Set(samples.map((sample) => sample.structural.bearingRecords))],
      recordDecodes: [...new Set(samples.map((sample) => sample.structural.recordDecodes))],
      providerObservations: [
        ...new Set(samples.map((sample) => sample.structural.providerObservations)),
      ],
      planningGraphBuilds: [
        ...new Set(samples.map((sample) => sample.structural.planningGraphBuilds)),
      ],
      rootClosures: [...new Set(samples.map((sample) => sample.structural.rootClosures))],
      repositoryRevalidations: [
        ...new Set(samples.map((sample) => sample.structural.repositoryRevalidations)),
      ],
    },
  };
};

export const createInspectBenchmarkReport = (workers: readonly InspectBenchmarkWorkerResult[]) => {
  const samples = workers.flatMap((worker) => worker.samples);
  const runtime = runtimeMetadata();
  const evidenceWorkers = workers.map((worker) => ({
    scale: worker.scale,
    fixture: worker.fixture,
    warmupIterations: worker.warmupIterations,
    measuredIterations: worker.measuredIterations,
    samples: worker.samples.map((sample) => ({
      target: sample.target,
      processId: sample.processId,
      runtime: sample.runtime,
      invocation: [
        "<node-runtime>",
        "<packaged-cli>",
        "inspect",
        sample.target.kind,
        sample.target.id,
        "--repo",
        "<fixture-root>",
        "--benchmark-metrics-file",
        "<metrics-file>",
      ],
      exitCode: sample.exitCode,
      stdoutBytes: Buffer.byteLength(sample.stdout),
      stderrBytes: Buffer.byteLength(sample.stderr),
      fingerprint: sample.fingerprint,
      state: sample.state,
      e2eMs: sample.e2eMs,
      phases: sample.phases,
      structural: sample.structural,
    })),
  }));
  const summaries = Object.fromEntries(
    (["representative", "stress"] as const).flatMap((scale) =>
      INSPECT_BENCHMARK_TARGETS.flatMap((target) => {
        const selected = samples.filter(
          (sample) => sample.scale === scale && sample.target.kind === target.kind,
        );
        return selected.length === 0 ? [] : [[`${scale}:${target.kind}`, summarize(selected)]];
      }),
    ),
  );
  const representative = samples.filter((sample) => sample.scale === "representative");
  const stress = samples.filter((sample) => sample.scale === "stress");
  const representativeMedian = timing(representative.map((sample) => sample.e2eMs)).medianMs;
  const stressMedian = timing(stress.map((sample) => sample.e2eMs)).medianMs;
  const medianLatencyRatio = stressMedian / representativeMedian;
  const concern = medianLatencyRatio > 5;
  return {
    schemaVersion: 1,
    benchmark: "after-only-inspect",
    definition: {
      historicalBaseline: false,
      portableMillisecondGate: false,
      realCliProcessStartupIncluded: true,
      targets: INSPECT_BENCHMARK_TARGETS,
      scales: {
        representative: {
          inputCount: BENCHMARK_SCALES.representative.inputCount,
          bearingRecordCount: BENCHMARK_SCALES.representative.bearingRecordCount,
        },
        stress: {
          inputCount: BENCHMARK_SCALES.stress.inputCount,
          bearingRecordCount: BENCHMARK_SCALES.stress.bearingRecordCount,
        },
      },
      structuralAssertions: {
        oneReadPerCapturedInput: true,
        oneDecodePerBearingRecord: true,
        oneCapturePerProviderScope: true,
        onePlanningGraphBuild: true,
        oneRootClosure: true,
        zeroRepositoryRevalidations: true,
      },
    },
    runtime: {
      generatedAt: runtime.generatedAt,
      platform: runtime.platform,
      release: runtime.release,
      architecture: runtime.architecture,
      cpuModel: runtime.cpuModel,
      logicalCpuCount: runtime.logicalCpuCount,
      totalMemoryBytes: runtime.totalMemoryBytes,
      freeMemoryBytesAtStart: runtime.freeMemoryBytesAtStart,
      bunVersion: runtime.bunVersion,
      nodeVersion: runtime.nodeVersion,
      homeDirectoryRecorded: runtime.homeDirectoryRecorded,
      cliNodeVersions: [...new Set(samples.map((sample) => sample.runtime.nodeVersion))].sort(),
    },
    fixtures: Object.fromEntries(workers.map((worker) => [worker.scale, worker.fixture])),
    summaries,
    scaleAssessment: {
      inputRatio: BENCHMARK_SCALES.stress.inputCount / BENCHMARK_SCALES.representative.inputCount,
      medianLatencyRatio,
      concern,
      explanation: concern
        ? "Stress median latency exceeds the fivefold review threshold; inspect phase summaries before acceptance."
        : "Stress median latency does not exceed the fivefold review threshold.",
      rule: "A roughly fourfold input increase exceeding fivefold median latency requires explanation.",
    },
    workers: evidenceWorkers,
  };
};
