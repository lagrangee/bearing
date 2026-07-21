import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

export const createValidBearingRepo = async (): Promise<string> => {
  const root = await makeTemporaryDirectory("bearing-repo-");
  const interpretationFiles = [
    "CONTEXT.md",
    "docs/agents/issue-tracker.md",
    "docs/agents/triage-labels.md",
    "docs/agents/domain.md",
  ];
  for (const locator of interpretationFiles) {
    await writeFixture(root, locator, `# ${locator}\n`);
  }

  await writeFixture(
    root,
    ".bearing/manifest.json",
    `${JSON.stringify(
      {
        schemaVersion: 1,
        packageVersion: "0.0.0-g2",
        surfaces: ["agent-skills"],
        executorProfiles: ["generic-agent"],
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
    ".scratch/work/effort.md",
    `---
Type: effort
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
---

# Effort: Test

## Intent

Exercise the sync contract.

## Work

- [Map](map.md)
`,
  );
  await writeFixture(
    root,
    ".scratch/work/map.md",
    `# Wayfinder Map: Test

Type: wayfinder:map
Status: resolved

## Destination

Resolve the work.

## Not yet specified
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
  return root;
};
