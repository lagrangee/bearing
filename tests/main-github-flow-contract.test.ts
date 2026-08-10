import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

const repoRoot = join(import.meta.dirname, "..");

const readYaml = async (path: string): Promise<unknown> =>
  parse(await readFile(join(repoRoot, path), "utf8"));

test("repository automation targets main as the only integration branch", async () => {
  const ci = (await readYaml(".github/workflows/ci.yml")) as {
    readonly on: {
      readonly push: { readonly branches: readonly string[] };
      readonly pull_request: { readonly branches: readonly string[] };
    };
  };
  const candidate = (await readYaml(".github/workflows/package.yml")) as {
    readonly on: Readonly<Record<string, unknown>>;
  };
  const dependabot = (await readYaml(".github/dependabot.yml")) as {
    readonly updates: readonly { readonly "target-branch"?: string }[];
  };

  expect(ci.on.push.branches).toEqual(["main"]);
  expect(ci.on.pull_request.branches).toEqual(["main"]);
  expect(Object.hasOwn(candidate.on, "workflow_dispatch")).toBe(true);
  expect(Object.hasOwn(candidate.on, "pull_request")).toBe(false);
  expect(dependabot.updates).toHaveLength(1);
  expect(dependabot.updates[0]?.["target-branch"]).toBe("main");
});

test("contributor guidance sends short-lived topic branches to main", async () => {
  const contributing = await readFile(join(repoRoot, "CONTRIBUTING.md"), "utf8");
  const changelog = await readFile(join(repoRoot, "CHANGELOG.md"), "utf8");
  const pullRequestTemplate = await readFile(
    join(repoRoot, ".github/pull_request_template.md"),
    "utf8",
  );

  expect(contributing).toContain("`main` is the integration baseline");
  expect(contributing).toContain("Open pull requests from short-lived topic branches into `main`");
  expect(contributing).not.toContain("current development base is `0.1.1`");
  expect(pullRequestTemplate).toContain("This pull request targets `main`");
  expect(pullRequestTemplate).not.toContain("current `0.1.1` working branch");
  expect(changelog).toContain("`main` is the integration baseline, not a release identity");
  expect(changelog).toContain("immutable Git tag, npm version, and GitHub Release");
  expect(changelog).not.toContain("npm `next`");
});
