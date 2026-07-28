import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  applyBenchmarkScenario,
  BENCHMARK_SCALES,
  createBenchmarkFixture,
  summarizeWorkers,
} from "../scripts/sync-benchmark-lib";
import { runSyncMeasured } from "../src/sync";
import { prepareSync } from "../src/sync-plan";

test("builds deterministic representative and stress fixtures at the declared scale", async () => {
  for (const scale of ["representative", "stress"] as const) {
    const first = await createBenchmarkFixture(scale);
    const second = await createBenchmarkFixture(scale);
    try {
      expect(first.digest).toBe(second.digest);
      expect(first.totalBytes).toBe(second.totalBytes);
      const measured = await runSyncMeasured(first.root, {
        packageVersion: "0.0.0-benchmark",
        completedAt: "2026-07-18T00:00:00.000Z",
      });
      expect(measured.result.inputs).toHaveLength(BENCHMARK_SCALES[scale].inputCount);
      expect(measured.metrics.bearingRecordCount).toBe(BENCHMARK_SCALES[scale].bearingRecordCount);
      expect(measured.metrics.inputReadCount).toBe(measured.metrics.capturedInputCount);
      expect(measured.metrics.recordDecodeCount).toBe(measured.metrics.bearingRecordCount);
      expect(measured.metrics.repositoryRevalidationCount).toBe(0);
      expect(measured.metrics.providerCaptureCount).toBe(BENCHMARK_SCALES[scale].scopeCount);
      expect(Object.keys(measured.metrics.phaseMs)).toEqual([
        "discovery",
        "capture",
        "decode",
        "assetResolution",
        "derivation",
        "outputComparison",
      ]);
    } finally {
      await rm(first.root, { recursive: true, force: true });
      await rm(second.root, { recursive: true, force: true });
    }
  }
});

test("keeps the schema v1 Sync benchmark phase summary unchanged", () => {
  const phaseMs = {
    discovery: 1,
    capture: 2,
    decode: 3,
    assetResolution: 4,
    derivation: 5,
    outputComparison: 6,
  };
  const summary = summarizeWorkers([
    {
      scale: "representative",
      scenario: "no-op",
      processIndex: 1,
      fixture: {
        digest: `sha256:${"a".repeat(64)}`,
        inputCount: 36,
        bearingRecordCount: 30,
        totalBytes: 1,
      },
      warmupIterations: 0,
      measuredIterations: 1,
      samples: [
        {
          totalMs: 10,
          phaseMs,
          inputReads: 36,
          capturedInputs: 36,
          bearingRecords: 30,
          recordDecodes: 30,
          repositoryRevalidations: 0,
          fingerprint: `sha256:${"b".repeat(64)}`,
          changed: false,
          blockingDiagnostics: 0,
        },
      ],
    },
  ]);

  expect(Object.keys(summary.phases)).toEqual(Object.keys(phaseMs));
});

test("declares the accepted after-only scenario and iteration matrix", () => {
  expect(BENCHMARK_SCALES.representative).toMatchObject({
    inputCount: 36,
    bearingRecordCount: 30,
    warmupIterations: 20,
    measuredIterations: 100,
    scenarios: ["no-op", "changed-bearing-record", "changed-native-work", "invalid-bearing-record"],
  });
  expect(BENCHMARK_SCALES.stress).toMatchObject({
    inputCount: 126,
    bearingRecordCount: 120,
    warmupIterations: 10,
    measuredIterations: 50,
    scenarios: ["no-op", "changed-bearing-record"],
  });
});

test("keeps every invalid-Record benchmark variant invalid", async () => {
  const fixture = await createBenchmarkFixture("representative");
  try {
    for (const iteration of [0, 1]) {
      await applyBenchmarkScenario(fixture, "invalid-bearing-record", iteration);
      const plan = await prepareSync(fixture.root);
      expect(plan.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "missing-required-section",
          impact: "blocking",
          target: fixture.summaryLocator,
        }),
      );
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
