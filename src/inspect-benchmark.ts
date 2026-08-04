import { writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { PlanningTarget } from "./planning-graph";

export type InspectBenchmarkMetrics = Readonly<{
  schemaVersion: 1;
  benchmark: "inspect-sample";
  processId: number;
  runtime: Readonly<{ nodeVersion: string }>;
  target: PlanningTarget;
  fingerprint: string;
  state: "complete" | "partial" | "invalid";
  phases: Readonly<{
    discovery: number;
    capture: number;
    decode: number;
    graphBuild: number;
    closure: number;
    output: number;
    cacheComparison: number;
  }>;
  structural: Readonly<{
    inputReads: number;
    capturedInputs: number;
    bearingRecords: number;
    recordDecodes: number;
    providerObservations: number;
    planningGraphBuilds: number;
    rootClosures: number;
    repositoryRevalidations: number;
  }>;
}>;

export const writeInspectBenchmarkMetrics = (
  repoRoot: string,
  outputPath: string | undefined,
  metrics: InspectBenchmarkMetrics,
): void => {
  if (outputPath === undefined) return;
  const target = resolve(outputPath);
  const cacheRoot = resolve(join(repoRoot, ".bearing/cache"));
  if (
    dirname(target) !== cacheRoot ||
    !/^inspect-benchmark-[0-9a-f-]+\.json$/u.test(basename(target))
  ) {
    throw new Error("Inspect benchmark metrics require a disposable cache target.");
  }
  writeFileSync(target, `${JSON.stringify(metrics)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
};
