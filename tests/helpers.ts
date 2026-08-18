import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };
import type { ProjectCompilation } from "../src/project-compilation";
import { buildProjectGeneration } from "../src/project-generation/projection";
import { LOCAL_MATT_CONTRACT, LOCAL_MATT_TRIAGE_LABELS } from "./fixtures/local-matt-contract";

export { LOCAL_MATT_CONTRACT, LOCAL_MATT_TRIAGE_LABELS } from "./fixtures/local-matt-contract";

export const makeTemporaryDirectory = async (prefix: string): Promise<string> =>
  mkdtemp(join(tmpdir(), prefix));

export const buildSnapshotForProjectCompilation = (
  root: string,
  packageVersion: string,
  plan: ProjectCompilation,
) =>
  buildProjectGeneration({
    repoRoot: root,
    packageVersion,
    basisFingerprint: plan.fingerprint,
    diagnostics: plan.diagnostics,
    advisoryFreshness: plan.advisoryFreshness,
    decoded: plan.decoded,
    providerObservations: plan.providerObservations,
    providerObservationSelections: plan.providerObservationSelections,
    providerDetailEvidenceObservations: plan.providerDetailEvidenceObservations,
    providerDetailEvidenceSelections: plan.providerDetailEvidenceSelections,
    assetContentObservations: plan.assetContentObservations,
    projectProjections: plan.projectProjections,
  });

const CONSOLE_LOG_METHODS = ["debug", "error", "info", "log", "warn"] as const;

export const captureConsoleLogs = async <Result>(
  operation: () => Promise<Result>,
): Promise<Readonly<{ result: Result; logs: readonly string[] }>> => {
  type ConsoleLogMethod = (typeof CONSOLE_LOG_METHODS)[number];
  const writableConsole = console as unknown as Record<
    ConsoleLogMethod,
    (...values: unknown[]) => void
  >;
  const originals = new Map<ConsoleLogMethod, (...values: unknown[]) => void>();
  const logs: string[] = [];
  for (const method of CONSOLE_LOG_METHODS) {
    originals.set(method, writableConsole[method]);
    writableConsole[method] = (...values) => {
      logs.push(values.map(String).join(" "));
    };
  }
  try {
    return { result: await operation(), logs };
  } finally {
    for (const [method, original] of originals) writableConsole[method] = original;
  }
};

export const writeFixture = async (
  root: string,
  locator: string,
  content: string | Uint8Array,
): Promise<void> => {
  const target = join(root, locator);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
};

export const standardMattAgentSurface = (
  contractLocator = "docs/agents/issue-tracker.md",
): string => `## Agent skills

### Issue tracker

Issues and PRDs use the repository tracker. See \`${contractLocator}\`.
`;

export const writeStandardMattLocalRepository = async (root: string): Promise<void> => {
  await writeFixture(root, "CONTEXT.md", "# Local Matt repository\n");
  await writeFixture(root, "docs/agents/domain.md", "# Domain\n");
  await writeFixture(root, "docs/agents/issue-tracker.md", LOCAL_MATT_CONTRACT);
  await writeFixture(root, "docs/agents/triage-labels.md", LOCAL_MATT_TRIAGE_LABELS);
  await writeFixture(root, "AGENTS.md", standardMattAgentSurface());
  await writeFixture(
    root,
    ".scratch/work/map.md",
    `# Wayfinder Map: Test

Status: resolved

## Destination

Resolve the work.

## Decisions so far

- [Finish](issues/01-finish.md) — The fixture is complete.

## Fog
`,
  );
  await writeFixture(
    root,
    ".scratch/work/issues/01-finish.md",
    `# Finish

Type: task

Status: resolved

## Question

Can the fixture finish?

## Answer

Yes.
`,
  );
};

export const createValidBearingRepo = async (): Promise<string> => {
  const root = await makeTemporaryDirectory("bearing-repo-");
  await writeStandardMattLocalRepository(root);
  await writeFixture(
    root,
    ".bearing/manifest.json",
    `${JSON.stringify(
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
  );
  await writeValidBearingState(root);
  return root;
};

export const writeValidBearingState = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/provider.json",
    `${JSON.stringify(
      {
        schemaVersion: 1,
        provider: "matt-skills/v1",
        contractLocator: "docs/agents/issue-tracker.md",
      },
      null,
      2,
    )}\n`,
  );
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    `---
Type: project-summary
ID: project-summary:current
Title: Test Project
---

# Project Summary: Test Project

## Purpose

Exercise the fixture.

## Current Design

One local Markdown planning loop.

## Boundaries

- Keep native work native.

## Future Candidates

- Add another adapter after the MVP.

## Material Revisions

- None yet.
`,
  );

  await writeFixture(
    root,
    ".bearing/state/roadmap-index.md",
    `---
Type: roadmap-index
Roadmaps:
  - roadmap:test
---

# Roadmap Index
`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    `---
Type: roadmap
ID: roadmap:test
Title: Test Roadmap
Status: active
Focused gate: gate:test
Gate order:
  - gate:test
---

# Roadmap: Test

## Intent

Prove the fixture.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    `---
Type: milestone-gate
ID: gate:test
Title: Test Gate
Roadmap: roadmap:test
Status: active
Effort order:
  - effort:test
---

# Milestone Gate: Test

## Intent

Reach the fixture boundary.

## Exit Criteria

- All fixture work resolves.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets: []
---

# Asset Registry
`,
  );
  await writeFixture(
    root,
    ".bearing/state/efforts/test.md",
    `---
Type: effort
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
Lifecycle: active
Planned at: null
Activated at: null
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/work
---

# Effort: Test

## Intent

Exercise the Project Read Model contract.

## Work

- [Map](map.md)
`,
  );
};
