import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpus, freemem, homedir, hostname, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { sha256Hex } from "../src/sha256";
import { runSyncMeasured } from "../src/sync";
import type { SyncPerformanceMetrics } from "../src/sync-plan";
import {
  LOCAL_MATT_CONTRACT,
  LOCAL_MATT_TRIAGE_LABELS,
} from "../tests/fixtures/local-matt-contract";

export type BenchmarkScale = "representative" | "stress";
export type BenchmarkScenario =
  | "no-op"
  | "changed-bearing-record"
  | "changed-native-work"
  | "invalid-bearing-record";

export const BENCHMARK_SCALES = {
  representative: {
    inputCount: 36,
    bearingRecordCount: 30,
    scopeCount: 9,
    ticketCounts: [10, 10, 10, 9, 9, 9, 9, 9, 9],
    warmupIterations: 20,
    measuredIterations: 100,
    scenarios: [
      "no-op",
      "changed-bearing-record",
      "changed-native-work",
      "invalid-bearing-record",
    ] as const,
  },
  stress: {
    inputCount: 126,
    bearingRecordCount: 120,
    scopeCount: 39,
    ticketCounts: [...Array.from({ length: 3 }, () => 8), ...Array.from({ length: 36 }, () => 9)],
    warmupIterations: 10,
    measuredIterations: 50,
    scenarios: ["no-op", "changed-bearing-record"] as const,
  },
} as const;

type FixtureFile = Readonly<{ locator: string; content: string }>;
export type BenchmarkFixture = Readonly<{
  root: string;
  digest: string;
  totalBytes: number;
  files: readonly FixtureFile[];
  summaryLocator: string;
  nativeLocator: string;
}>;

const number = (value: number): string => value.toString().padStart(3, "0");
const summary = (variant: "a" | "b" | "invalid-a" | "invalid-b"): string => `---
Type: project-summary
ID: project-summary:current
Title: Benchmark Project
---

# Project Summary: Benchmark Project

${
  variant.startsWith("invalid-")
    ? ""
    : `## Purpose

Exercise deterministic Sync benchmark variant ${variant.toUpperCase()}.

`
}## Current Design

One generated repository with stable schema-owned records and native work (${variant}).

## Boundaries

- Keep benchmark content deterministic.

## Future Candidates

- None.

## Material Revisions

- None.
`;

const fixtureFiles = (scale: BenchmarkScale): FixtureFile[] => {
  const specification = BENCHMARK_SCALES[scale];
  const files: FixtureFile[] = [
    {
      locator: ".bearing/manifest.json",
      content: `${JSON.stringify(
        {
          schemaVersion: 1,
          packageVersion: "0.0.0-benchmark",
          status: "active",
          surfaces: ["agent-skills"],
          executorProfiles: [],
        },
        null,
        2,
      )}\n`,
    },
    {
      locator: ".bearing/provider.json",
      content: `${JSON.stringify(
        {
          schemaVersion: 1,
          provider: "matt-skills/v1",
          contractLocator: "docs/agents/issue-tracker.md",
        },
        null,
        2,
      )}\n`,
    },
    { locator: ".bearing/state/project-summary.md", content: summary("a") },
    {
      locator: ".bearing/state/assets.md",
      content: "---\nType: asset-registry\nAssets: []\n---\n\n# Asset Registry\n",
    },
    { locator: "CONTEXT.md", content: "# Benchmark Context\n\nDeterministic fixture.\n" },
    { locator: "docs/agents/domain.md", content: "# Domain\n\nBenchmark fixture.\n" },
    { locator: "docs/agents/issue-tracker.md", content: LOCAL_MATT_CONTRACT },
    { locator: "docs/agents/triage-labels.md", content: LOCAL_MATT_TRIAGE_LABELS },
  ];
  const roadmapIds = Array.from(
    { length: specification.scopeCount },
    (_, index) => `roadmap:r${number(index + 1)}`,
  );
  files.push({
    locator: ".bearing/state/roadmap-index.md",
    content: `---\nType: roadmap-index\nRoadmaps:\n${roadmapIds.map((id) => `  - ${id}`).join("\n")}\n---\n\n# Roadmap Index\n`,
  });
  for (let index = 0; index < specification.scopeCount; index += 1) {
    const ordinal = number(index + 1);
    const roadmapId = `roadmap:r${ordinal}`;
    const gateId = `gate:g${ordinal}`;
    const effortId = `effort:e${ordinal}`;
    const scope = `.scratch/scope-${ordinal}`;
    const ticketCount = specification.ticketCounts[index] ?? 0;
    const decisions = Array.from({ length: ticketCount }, (_, ticket) => {
      const ticketNumber = number(ticket + 1);
      return `- [Generated ${ordinal}-${ticketNumber}](issues/${ticketNumber}-generated.md) — Resolved.`;
    }).join("\n");
    files.push(
      {
        locator: `.bearing/state/roadmaps/r${ordinal}.md`,
        content: `---\nType: roadmap\nID: ${roadmapId}\nTitle: Roadmap ${ordinal}\nStatus: active\nFocused gate: ${gateId}\nGate order:\n  - ${gateId}\n---\n\n# Roadmap ${ordinal}\n\n## Intent\n\nExercise deterministic relationship ${ordinal}.\n`,
      },
      {
        locator: `.bearing/state/milestone-gates/g${ordinal}.md`,
        content: `---\nType: milestone-gate\nID: ${gateId}\nTitle: Gate ${ordinal}\nRoadmap: ${roadmapId}\nStatus: active\n---\n\n# Gate ${ordinal}\n\n## Intent\n\nComplete deterministic scope ${ordinal}.\n\n## Exit Criteria\n\n- All generated tickets resolve.\n`,
      },
      {
        locator: `.bearing/state/efforts/e${ordinal}.md`,
        content: `---\nType: effort\nID: ${effortId}\nTitle: Effort ${ordinal}\nRoadmap: ${roadmapId}\nTarget gate: ${gateId}\nAuthorities: []\nCitations: []\nWork binding:\n  Provider: matt-skills/v1\n  Native scope: ${scope}\n---\n\n# Effort ${ordinal}\n\n## Intent\n\nExercise deterministic native scope ${ordinal}.\n\n## Work\n\n- [Map](map.md)\n`,
      },
      {
        locator: `${scope}/map.md`,
        content: `# Map ${ordinal}\n\nStatus: resolved\n\n## Destination\n\nResolve the generated tickets.\n\n## Decisions so far\n\n${decisions}\n\n## Fog\n`,
      },
    );
    for (let ticket = 1; ticket <= ticketCount; ticket += 1) {
      const ticketNumber = number(ticket);
      files.push({
        locator: `${scope}/issues/${ticketNumber}-generated.md`,
        content: `# Generated ${ordinal}-${ticketNumber}\n\nType: task\n\nStatus: resolved\n\n## Question\n\nCan generated work ${ordinal}-${ticketNumber} finish?\n\n## Answer\n\nYes.\n`,
      });
    }
  }
  return files.sort((left, right) =>
    Buffer.compare(Buffer.from(left.locator), Buffer.from(right.locator)),
  );
};

const fixtureDigest = (files: readonly FixtureFile[]): string =>
  `sha256:${sha256Hex(
    files
      .map(
        (file) => `${file.locator.length}:${file.locator}:${file.content.length}:${file.content}`,
      )
      .join(""),
  )}`;

export const createBenchmarkFixture = async (
  scale: BenchmarkScale,
  parent = tmpdir(),
): Promise<BenchmarkFixture> => {
  const root = await mkdtemp(join(parent, `bearing-sync-benchmark-${scale}-`));
  const files = fixtureFiles(scale);
  for (const file of files) {
    const target = join(root, file.locator);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  return {
    root,
    files,
    digest: fixtureDigest(files),
    totalBytes: files.reduce((total, file) => total + Buffer.byteLength(file.content), 0),
    summaryLocator: ".bearing/state/project-summary.md",
    nativeLocator: ".scratch/scope-001/issues/001-generated.md",
  };
};

const nativeVariant = (variant: "a" | "b"): string =>
  `# Generated 001-001\n\nType: task\n\nStatus: ${variant === "a" ? "resolved" : "claimed"}\n\n## Question\n\nCan generated work 001-001 finish?\n\n## Answer\n\nYes.\n`;

export const applyBenchmarkScenario = async (
  fixture: BenchmarkFixture,
  scenario: BenchmarkScenario,
  iteration: number,
): Promise<void> => {
  const variant = iteration % 2 === 0 ? "b" : "a";
  if (scenario === "changed-bearing-record") {
    await writeFile(join(fixture.root, fixture.summaryLocator), summary(variant));
  } else if (scenario === "changed-native-work") {
    await writeFile(join(fixture.root, fixture.nativeLocator), nativeVariant(variant));
  } else if (scenario === "invalid-bearing-record") {
    await writeFile(
      join(fixture.root, fixture.summaryLocator),
      summary(variant === "a" ? "invalid-a" : "invalid-b"),
    );
  }
};

export type BenchmarkSample = Readonly<{
  totalMs: number;
  phaseMs: SyncPerformanceMetrics["phaseMs"];
  inputReads: number;
  capturedInputs: number;
  bearingRecords: number;
  recordDecodes: number;
  repositoryRevalidations: number;
  providerCaptures: number;
  fingerprint: string;
  changed: boolean;
  blockingDiagnostics: number;
}>;

const sample = async (
  fixture: BenchmarkFixture,
  scenario: BenchmarkScenario,
  iteration: number,
  expectedProviderCaptures: number,
): Promise<BenchmarkSample> => {
  await applyBenchmarkScenario(fixture, scenario, iteration);
  const started = performance.now();
  const measured = await runSyncMeasured(fixture.root, {
    packageVersion: "0.0.0-benchmark",
    completedAt: "2026-07-18T00:00:00.000Z",
  });
  const totalMs = performance.now() - started;
  const metrics = measured.metrics;
  if (metrics.inputReadCount !== metrics.capturedInputCount) {
    throw new Error("Structural assertion failed: every captured input must be read once.");
  }
  if (metrics.recordDecodeCount !== metrics.bearingRecordCount) {
    throw new Error("Structural assertion failed: every Bearing Record must be decoded once.");
  }
  if (metrics.repositoryRevalidationCount !== 0) {
    throw new Error("Structural assertion failed: repository revalidation must remain zero.");
  }
  if (metrics.providerCaptureCount !== expectedProviderCaptures) {
    throw new Error(
      "Structural assertion failed: every bound provider scope must be captured once.",
    );
  }
  const blockingDiagnostics = measured.result.diagnostics.filter(
    (diagnostic) => diagnostic.impact === "blocking",
  ).length;
  if (scenario === "invalid-bearing-record" && blockingDiagnostics === 0) {
    throw new Error("Scenario assertion failed: invalid Record sample must remain invalid.");
  }
  return {
    totalMs,
    phaseMs: metrics.phaseMs,
    inputReads: metrics.inputReadCount,
    capturedInputs: metrics.capturedInputCount,
    bearingRecords: metrics.bearingRecordCount,
    recordDecodes: metrics.recordDecodeCount,
    repositoryRevalidations: metrics.repositoryRevalidationCount,
    providerCaptures: metrics.providerCaptureCount,
    fingerprint: measured.result.fingerprint,
    changed: measured.result.changed,
    blockingDiagnostics,
  };
};

export type BenchmarkWorkerResult = Readonly<{
  scale: BenchmarkScale;
  scenario: BenchmarkScenario;
  processIndex: number;
  fixture: Readonly<{
    digest: string;
    inputCount: number;
    bearingRecordCount: number;
    totalBytes: number;
  }>;
  warmupIterations: number;
  measuredIterations: number;
  samples: readonly BenchmarkSample[];
}>;

export const runBenchmarkWorker = async (options: {
  scale: BenchmarkScale;
  scenario: BenchmarkScenario;
  processIndex: number;
}): Promise<BenchmarkWorkerResult> => {
  const specification = BENCHMARK_SCALES[options.scale];
  const fixture = await createBenchmarkFixture(options.scale);
  try {
    await runSyncMeasured(fixture.root, {
      packageVersion: "0.0.0-benchmark",
      completedAt: "2026-07-18T00:00:00.000Z",
    });
    for (let index = 0; index < specification.warmupIterations; index += 1) {
      await sample(fixture, options.scenario, index, specification.scopeCount);
    }
    const samples: BenchmarkSample[] = [];
    for (let index = 0; index < specification.measuredIterations; index += 1) {
      samples.push(await sample(fixture, options.scenario, index, specification.scopeCount));
    }
    const first = samples[0];
    if (
      first === undefined ||
      first.capturedInputs !== specification.inputCount ||
      first.bearingRecords !== specification.bearingRecordCount
    ) {
      throw new Error("Generated benchmark fixture does not match its declared scale.");
    }
    return {
      scale: options.scale,
      scenario: options.scenario,
      processIndex: options.processIndex,
      fixture: {
        digest: fixture.digest,
        inputCount: first.capturedInputs,
        bearingRecordCount: first.bearingRecords,
        totalBytes: fixture.totalBytes,
      },
      warmupIterations: specification.warmupIterations,
      measuredIterations: specification.measuredIterations,
      samples,
    };
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
};

const percentile = (values: readonly number[], fraction: number): number => {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
  return ordered[index] ?? 0;
};

const timing = (values: readonly number[]) => ({
  medianMs: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
});

export const summarizeWorkers = (workers: readonly BenchmarkWorkerResult[]) => {
  const samples = workers.flatMap((worker) => worker.samples);
  const phaseNames = [
    "discovery",
    "capture",
    "decode",
    "assetResolution",
    "derivation",
    "outputComparison",
  ] as const;
  return {
    processCount: new Set(workers.map((worker) => worker.processIndex)).size,
    sampleCount: samples.length,
    total: timing(samples.map((entry) => entry.totalMs)),
    phases: Object.fromEntries(
      phaseNames.map((phase) => [phase, timing(samples.map((entry) => entry.phaseMs[phase]))]),
    ),
    structural: {
      inputReads: [...new Set(samples.map((entry) => entry.inputReads))],
      capturedInputs: [...new Set(samples.map((entry) => entry.capturedInputs))],
      bearingRecords: [...new Set(samples.map((entry) => entry.bearingRecords))],
      recordDecodes: [...new Set(samples.map((entry) => entry.recordDecodes))],
      repositoryRevalidations: [...new Set(samples.map((entry) => entry.repositoryRevalidations))],
      providerCaptures: [...new Set(samples.map((entry) => entry.providerCaptures))],
    },
    outputFingerprints: [...new Set(samples.map((entry) => entry.fingerprint))].sort(),
  };
};

export const runtimeMetadata = () => ({
  generatedAt: new Date().toISOString(),
  hostname: hostname(),
  platform: platform(),
  release: release(),
  architecture: process.arch,
  cpuModel: cpus()[0]?.model ?? "unknown",
  logicalCpuCount: cpus().length,
  totalMemoryBytes: totalmem(),
  freeMemoryBytesAtStart: freemem(),
  bunVersion: typeof Bun === "undefined" ? undefined : Bun.version,
  nodeVersion: process.version,
  homeDirectoryRecorded: homedir().length > 0,
});
