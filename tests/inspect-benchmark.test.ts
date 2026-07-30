import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, hostname, platform, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import {
  assertInspectBenchmarkStructure,
  createInspectBenchmarkReport,
  INSPECT_BENCHMARK_TARGETS,
  runInspectBenchmarkWorker,
  runPackagedInspectSample,
} from "../scripts/inspect-benchmark-lib";
import { BENCHMARK_SCALES, createBenchmarkFixture } from "../scripts/sync-benchmark-lib";
import {
  type InspectBenchmarkMetrics,
  writeInspectBenchmarkMetrics,
} from "../src/inspect-benchmark";
import { createPlanningGraphInstrumentation } from "../src/planning-graph-instrumentation";
import { runSyncMeasured } from "../src/sync";
import { prepareSync } from "../src/sync-plan";
import { createValidBearingRepo } from "./helpers";

let buildRoot = "";
let cliPath = "";

beforeAll(async () => {
  buildRoot = await mkdtemp(join(tmpdir(), "bearing-inspect-benchmark-test-"));
  const result = await Bun.build({
    entrypoints: [join(process.cwd(), "src/cli.ts")],
    outdir: buildRoot,
    naming: "cli.js",
    target: "node",
    format: "esm",
  });
  if (!result.success) throw new AggregateError(result.logs, "Benchmark CLI fixture failed.");
  cliPath = join(buildRoot, "cli.js");
});

afterAll(async () => {
  if (buildRoot.length > 0) await rm(buildRoot, { recursive: true, force: true });
});

test("declares one after-only packaged CLI benchmark across both scales and all inspect roots", async () => {
  const packageMetadata = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
  expect(packageMetadata.scripts["benchmark:inspect"]).toBe(
    "bun run build && bun scripts/benchmark-inspect.ts",
  );
  expect(INSPECT_BENCHMARK_TARGETS).toEqual([
    { kind: "roadmap", id: "roadmap:r001" },
    { kind: "gate", id: "gate:g001" },
    { kind: "effort", id: "effort:e001" },
  ]);
  expect(BENCHMARK_SCALES.representative).toMatchObject({
    inputCount: 36,
    bearingRecordCount: 30,
  });
  expect(BENCHMARK_SCALES.stress).toMatchObject({
    inputCount: 126,
    bearingRecordCount: 120,
  });
});

test("worker invokes the packaged-equivalent CLI in one independent process per inspect sample", async () => {
  const worker = await runInspectBenchmarkWorker({
    scale: "representative",
    cliPath,
    warmupIterations: 0,
    measuredIterations: 1,
  });

  expect(worker.fixture).toMatchObject({
    digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    inputCount: 36,
    bearingRecordCount: 30,
  });
  expect(worker.samples.map((sample) => sample.target)).toEqual([...INSPECT_BENCHMARK_TARGETS]);
  expect(new Set(worker.samples.map((sample) => sample.processId))).toHaveLength(3);
  for (const sample of worker.samples) {
    expect(sample.invocation).toEqual([
      process.execPath.includes("bun") ? "node" : process.execPath,
      cliPath,
      "inspect",
      sample.target.kind,
      sample.target.id,
      "--repo",
      expect.any(String),
      "--benchmark-metrics-file",
      expect.stringMatching(/\.bearing\/cache\/inspect-benchmark-[0-9a-f-]+\.json$/u),
    ]);
    expect(sample.exitCode).toBe(0);
    expect(sample.stderr).toBe("");
    expect(JSON.parse(sample.stdout)).toMatchObject({
      state: "complete",
      target: sample.target,
      fingerprint: sample.fingerprint,
    });
    expect(sample.e2eMs).toBeGreaterThan(0);
    expect(Object.keys(sample.phases).sort()).toEqual(
      [
        "cacheComparison",
        "capture",
        "closure",
        "decode",
        "discovery",
        "graphBuild",
        "output",
      ].sort(),
    );
    expect(sample.structural).toEqual({
      inputReads: 36,
      capturedInputs: 36,
      bearingRecords: 30,
      recordDecodes: 30,
      providerObservations: 0,
      planningGraphBuilds: 1,
      rootClosures: 1,
      repositoryRevalidations: 0,
    });
  }
  const report = createInspectBenchmarkReport([worker]);
  const serialized = JSON.stringify(report);
  expect(report.workers[0]?.samples[0]?.invocation).toEqual([
    "<node-runtime>",
    "<packaged-cli>",
    "inspect",
    "roadmap",
    "roadmap:r001",
    "--repo",
    "<fixture-root>",
    "--benchmark-metrics-file",
    "<metrics-file>",
  ]);
  for (const leak of [
    "/Users/",
    process.cwd(),
    buildRoot,
    cliPath,
    homedir(),
    hostname(),
    userInfo().username,
  ]) {
    expect(serialized).not.toContain(leak);
  }
  expect(report.runtime).not.toHaveProperty("hostname");
});

test("counts actual Planning Graph builds and root closures and rejects duplicate sample work", async () => {
  const root = await createValidBearingRepo();
  const instrumentation = createPlanningGraphInstrumentation();
  try {
    const first = await prepareSync(root, { planningGraphInstrumentation: instrumentation });
    first.planningGraph.contextFor({ kind: "gate", id: "gate:test" });
    const second = await prepareSync(root, { planningGraphInstrumentation: instrumentation });
    second.planningGraph.contextFor({ kind: "effort", id: "effort:test" });

    expect(instrumentation.snapshot()).toEqual({
      planningGraphBuilds: 2,
      rootClosures: 2,
    });
    const valid = {
      inputReads: 36,
      capturedInputs: 36,
      bearingRecords: 30,
      recordDecodes: 30,
      providerObservations: 0,
      planningGraphBuilds: 1,
      rootClosures: 1,
      repositoryRevalidations: 0,
    };
    expect(() =>
      assertInspectBenchmarkStructure({ ...valid, planningGraphBuilds: 2 }, "representative"),
    ).toThrow("one Planning Graph");
    expect(() =>
      assertInspectBenchmarkStructure({ ...valid, rootClosures: 2 }, "representative"),
    ).toThrow("one root closure");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const metrics = (): InspectBenchmarkMetrics => ({
  schemaVersion: 1,
  benchmark: "inspect-sample",
  processId: 1,
  runtime: { nodeVersion: "v25.0.0" },
  target: { kind: "gate", id: "gate:test" },
  fingerprint: `sha256:${"a".repeat(64)}`,
  state: "complete",
  phases: {
    discovery: 1,
    capture: 1,
    decode: 1,
    graphBuild: 1,
    closure: 1,
    output: 1,
    cacheComparison: 1,
  },
  structural: {
    inputReads: 1,
    capturedInputs: 1,
    bearingRecords: 1,
    recordDecodes: 1,
    providerObservations: 0,
    planningGraphBuilds: 1,
    rootClosures: 1,
    repositoryRevalidations: 0,
  },
});

test("metrics writer stays inside disposable cache, refuses overwrite and symlinks, and writes private counters only", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-inspect-writer-"));
  const cache = join(root, ".bearing/cache");
  await mkdir(cache, { recursive: true });
  const target = join(cache, "inspect-benchmark-a1.json");
  const external = join(root, "external.json");
  try {
    expect(() => writeInspectBenchmarkMetrics(root, join(root, "outside.json"), metrics())).toThrow(
      "disposable cache target",
    );
    expect(() =>
      writeInspectBenchmarkMetrics(root, join(cache, "invalid.json"), metrics()),
    ).toThrow("disposable cache target");

    writeInspectBenchmarkMetrics(root, target, metrics());
    const first = await readFile(target, "utf8");
    expect(() => writeInspectBenchmarkMetrics(root, target, metrics())).toThrow();
    expect(await readFile(target, "utf8")).toBe(first);
    if (platform() !== "win32") expect((await stat(target)).mode & 0o777).toBe(0o600);
    expect(first).not.toContain('"planningGraph":');
    expect(first).not.toContain('"context":');

    await writeFile(external, "external bytes\n");
    const linked = join(cache, "inspect-benchmark-b2.json");
    await symlink(external, linked);
    expect(() => writeInspectBenchmarkMetrics(root, linked, metrics())).toThrow();
    expect(await readFile(external, "utf8")).toBe("external bytes\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful packaged sample deletes its disposable metrics file", async () => {
  const fixture = await createBenchmarkFixture("representative");
  try {
    await runSyncMeasured(fixture.root, {
      packageVersion: "0.0.0-benchmark",
      completedAt: "2026-07-18T00:00:00.000Z",
    });
    await runPackagedInspectSample({
      scale: "representative",
      cliPath,
      repoRoot: fixture.root,
      target: INSPECT_BENCHMARK_TARGETS[0],
    });
    expect(
      (await readdir(join(fixture.root, ".bearing/cache"))).filter((name) =>
        name.startsWith("inspect-benchmark-"),
      ),
    ).toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("report records metadata, medians, p95s, and the explainable scale rule without portable timing gates", () => {
  const sample = (scale: "representative" | "stress", e2eMs: number) => ({
    scale,
    target: INSPECT_BENCHMARK_TARGETS[0],
    processId: scale === "representative" ? 101 : 202,
    runtime: { nodeVersion: "v24.0.0" },
    invocation: ["node", "/package/dist/cli.js"] as const,
    exitCode: 0,
    stdout: "{}\n",
    stderr: "",
    fingerprint: `sha256:${(scale === "representative" ? "a" : "b").repeat(64)}`,
    state: "complete" as const,
    e2eMs,
    phases: {
      discovery: 1,
      capture: 1,
      decode: 1,
      graphBuild: 1,
      closure: 1,
      output: 1,
      cacheComparison: 1,
    },
    structural: {
      inputReads: scale === "representative" ? 36 : 126,
      capturedInputs: scale === "representative" ? 36 : 126,
      bearingRecords: scale === "representative" ? 30 : 120,
      recordDecodes: scale === "representative" ? 30 : 120,
      providerObservations: 0,
      planningGraphBuilds: 1,
      rootClosures: 1,
      repositoryRevalidations: 0,
    },
  });
  const fixture = (scale: "representative" | "stress") => ({
    digest: `sha256:${(scale === "representative" ? "c" : "d").repeat(64)}`,
    inputCount: scale === "representative" ? 36 : 126,
    bearingRecordCount: scale === "representative" ? 30 : 120,
    totalBytes: 1,
  });
  const report = createInspectBenchmarkReport([
    {
      scale: "representative",
      fixture: fixture("representative"),
      warmupIterations: 0,
      measuredIterations: 2,
      samples: [sample("representative", 10), sample("representative", 20)],
    },
    {
      scale: "stress",
      fixture: fixture("stress"),
      warmupIterations: 0,
      measuredIterations: 2,
      samples: [sample("stress", 60), sample("stress", 120)],
    },
  ]);

  expect(report).toMatchObject({
    schemaVersion: 1,
    benchmark: "after-only-inspect",
    definition: {
      historicalBaseline: false,
      portableMillisecondGate: false,
      realCliProcessStartupIncluded: true,
    },
    runtime: {
      generatedAt: expect.any(String),
      platform: expect.any(String),
      architecture: expect.any(String),
      cpuModel: expect.any(String),
      logicalCpuCount: expect.any(Number),
      totalMemoryBytes: expect.any(Number),
      nodeVersion: expect.any(String),
    },
    scaleAssessment: {
      inputRatio: 3.5,
      medianLatencyRatio: 6,
      concern: true,
      explanation: expect.stringMatching(/exceed/iu),
    },
  });
  expect(report.summaries["representative:roadmap"]).toMatchObject({
    e2e: { medianMs: 10, p95Ms: 20 },
    sampleCount: 2,
  });
  expect(JSON.stringify(report)).not.toContain('"stdout"');
});
