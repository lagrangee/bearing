import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export { LOCAL_MATT_CONTRACT, LOCAL_MATT_TRIAGE_LABELS } from "./fixtures/local-matt-contract";

export const makeTemporaryDirectory = async (prefix: string): Promise<string> =>
  mkdtemp(join(tmpdir(), prefix));

export const writeFixture = async (
  root: string,
  locator: string,
  content: string | Uint8Array,
): Promise<void> => {
  const target = join(root, locator);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
};

export const writeStandardMattLocalRepository = async (root: string): Promise<void> => {
  const standardContract = await readFile(join(process.cwd(), "docs/agents/issue-tracker.md"));
  const standardTriageVocabulary = await readFile(
    join(process.cwd(), "docs/agents/triage-labels.md"),
  );
  await writeFixture(root, "CONTEXT.md", "# Local Matt repository\n");
  await writeFixture(root, "docs/agents/domain.md", "# Domain\n");
  await writeFixture(root, "docs/agents/issue-tracker.md", standardContract);
  await writeFixture(root, "docs/agents/triage-labels.md", standardTriageVocabulary);
  await writeFixture(
    root,
    "AGENTS.md",
    "Work-management contract: `docs/agents/issue-tracker.md`\n",
  );
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
        packageVersion: "0.0.0-g2",
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
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/work
---

# Effort: Test

## Intent

Exercise the sync contract.

## Work

- [Map](map.md)
`,
  );
};
