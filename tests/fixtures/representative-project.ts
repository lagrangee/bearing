import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { cpus, freemem, homedir, hostname, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import packageMetadata from "../../package.json";
import { LOCAL_MATT_CONTRACT, LOCAL_MATT_TRIAGE_LABELS } from "./local-matt-contract";

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

Exercise deterministic representative project variant ${variant.toUpperCase()}.

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
          packageVersion: packageMetadata.version,
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
        content: `---\nType: milestone-gate\nID: ${gateId}\nTitle: Gate ${ordinal}\nRoadmap: ${roadmapId}\nStatus: active\nEffort order:\n  - ${effortId}\n---\n\n# Gate ${ordinal}\n\n## Intent\n\nComplete deterministic scope ${ordinal}.\n\n## Exit Criteria\n\n- All generated tickets resolve.\n`,
      },
      {
        locator: `.bearing/state/efforts/e${ordinal}.md`,
        content: `---\nType: effort\nLifecycle: active\nPlanned at: null\nActivated at: null\nID: ${effortId}\nTitle: Effort ${ordinal}\nRoadmap: ${roadmapId}\nTarget gate: ${gateId}\nAuthorities: []\nCitations: []\nWork binding:\n  Provider: matt-skills/v1\n  Native scope: ${scope}\n---\n\n# Effort ${ordinal}\n\n## Intent\n\nExercise deterministic native scope ${ordinal}.\n\n## Work\n\n- [Map](map.md)\n`,
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
  `sha256:${bytesToHex(
    sha256(
      utf8ToBytes(
        files
          .map(
            (file) =>
              `${file.locator.length}:${file.locator}:${file.content.length}:${file.content}`,
          )
          .join(""),
      ),
    ),
  )}`;

export const createRepresentativeProject = async (
  scale: BenchmarkScale,
  parent = tmpdir(),
): Promise<BenchmarkFixture> => {
  const root = await mkdtemp(join(parent, `bearing-representative-project-${scale}-`));
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
