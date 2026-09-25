import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { providerObservationIdentityFor } from "../src/native-work-provider";
import { validateMattSkillsV1Contract } from "../src/providers/matt-skills-v1";
import { externalPullRequestsEnabled } from "../src/providers/matt-skills-v1/github";
import { mattSkillsV1ProviderObservationSchema } from "../src/providers/matt-skills-v1/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

describe("matt-skills/v1 provider contract validator", () => {
  test("rejects completed observations that contain unavailable native lifecycle evidence", () => {
    const capture = createProjectOverviewFixture().providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/portal",
    );
    if (capture === undefined || (capture.state !== "available" && capture.state !== "partial")) {
      throw new Error("Expected readable Provider evidence.");
    }
    for (const role of ["map", "spec"] as const) {
      const { id: _id, ...content } = {
        ...capture,
        completion: "complete" as const,
        projection: {
          ...capture.projection,
          [role]: {
            ...capture.projection[role],
            lifecycle: { state: "unavailable", reason: "not-declared" },
          },
        },
      };
      const result = mattSkillsV1ProviderObservationSchema.safeParse({
        ...content,
        id: providerObservationIdentityFor(content),
      });
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Unavailable lifecycle must not prove completion.");
      expect(result.error.issues.map(({ path }) => path)).toContainEqual(["completion"]);
    }
  });

  test("accepts the upstream GitHub flag annotation without allowing contradictory suffixes", async () => {
    const upstream = await readFile(
      join(import.meta.dir, "fixtures/matt-upstream-contract/issue-tracker-github.md"),
      "utf8",
    );
    for (const flag of ["no", "yes"]) {
      const source = upstream.replace("surface: no.", `surface: ${flag}.`);
      expect(validateMattSkillsV1Contract(source)).toEqual({
        state: "supported",
        driver: "github-issues",
      });
      expect(externalPullRequestsEnabled(source)).toBe(flag === "yes");
    }
    for (const suffix of [" yes.", " _(Actually yes.)_", "\n\nPRs as a request surface: yes."]) {
      const source = upstream.replace("surface: no.**", `surface: no.**${suffix}`);
      expect(validateMattSkillsV1Contract(source)).toEqual({ state: "unsupported" });
      expect(externalPullRequestsEnabled(source)).toBe(false);
    }
  });

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
