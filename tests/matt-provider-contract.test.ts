import { describe, expect, test } from "bun:test";
import { validateMattSkillsV1Contract } from "../src/providers/matt-skills-v1";

describe("matt-skills/v1 provider contract validator", () => {
  test("accepts the two standard Matt tracker contracts without a provider marker", () => {
    expect(
      validateMattSkillsV1Contract(
        `# Issue tracker: Local Markdown

## Conventions

- One feature per directory.

## When a skill says "publish to the issue tracker"

Create a Markdown file.

## When a skill says "fetch the relevant ticket"

Read the referenced file.

## Wayfinding operations

Use one Map with child tickets.
`,
      ),
    ).toEqual({ state: "supported", driver: "local-markdown" });
    expect(
      validateMattSkillsV1Contract(
        `# Issue tracker: GitHub

## Conventions

- Use the \`gh\` CLI.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run \`gh issue view\`.

## Wayfinding operations

Use one issue with child issues.
`,
      ),
    ).toEqual({ state: "supported", driver: "github-issues" });
  });

  test("rejects title-only and marker decoys or an unrecognized driver", () => {
    expect(
      validateMattSkillsV1Contract("# Example\n\nProvider contract: `matt-skills/v1`\n"),
    ).toEqual({ state: "unsupported" });
    expect(validateMattSkillsV1Contract("# Issue tracker: GitHub\n")).toEqual({
      state: "unsupported",
    });
    expect(
      validateMattSkillsV1Contract(
        `# Issue tracker: Linear

## Conventions

- Use Linear.

## When a skill says "publish to the issue tracker"

Create an issue.

## When a skill says "fetch the relevant ticket"

Read the issue.

## Wayfinding operations

Use parent and child issues.
`,
      ),
    ).toEqual({ state: "unsupported" });
  });
});
