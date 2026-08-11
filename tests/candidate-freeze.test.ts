import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { assertCandidateEligibility, requiredCandidateContexts } from "../scripts/candidate-freeze";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const git = (root: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

const candidateRepository = async (): Promise<{
  root: string;
  sourceCommit: string;
  mainCommit: string;
  outsideMainCommit: string;
}> => {
  const root = await mkdtemp(join(tmpdir(), "bearing-candidate-freeze-"));
  temporaryRoots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Candidate Fixture");
  git(root, "config", "user.email", "candidate@example.invalid");
  await writeFile(join(root, "source.txt"), "candidate source\n");
  git(root, "add", "source.txt");
  git(root, "commit", "-qm", "fixture: candidate source");
  const sourceCommit = git(root, "rev-parse", "HEAD");
  await writeFile(join(root, "main.txt"), "main descendant\n");
  git(root, "add", "main.txt");
  git(root, "commit", "-qm", "fixture: main descendant");
  const mainCommit = git(root, "rev-parse", "HEAD");
  git(root, "switch", "-q", "-c", "outside-main", sourceCommit);
  await writeFile(join(root, "outside.txt"), "outside main\n");
  git(root, "add", "outside.txt");
  git(root, "commit", "-qm", "fixture: outside main");
  const outsideMainCommit = git(root, "rev-parse", "HEAD");
  return { root, sourceCommit, mainCommit, outsideMainCommit };
};

const successfulChecks = () => ({
  check_runs: requiredCandidateContexts.map((name) => ({
    name,
    status: "completed",
    conclusion: "success",
    app: { id: 15368 },
  })),
});

test("accepts only one exact source commit contained in main with all required contexts successful", async () => {
  const repository = await candidateRepository();

  expect(
    assertCandidateEligibility({
      repositoryRoot: repository.root,
      sourceCommit: repository.sourceCommit,
      mainCommit: repository.mainCommit,
      checks: successfulChecks(),
    }),
  ).toEqual({
    sourceCommit: repository.sourceCommit,
    mainCommit: repository.mainCommit,
    contexts: requiredCandidateContexts,
  });

  expect(() =>
    assertCandidateEligibility({
      repositoryRoot: repository.root,
      sourceCommit: repository.outsideMainCommit,
      mainCommit: repository.mainCommit,
      checks: successfulChecks(),
    }),
  ).toThrow("candidate source commit is not contained in main");
  expect(() =>
    assertCandidateEligibility({
      repositoryRoot: repository.root,
      sourceCommit: "main",
      mainCommit: repository.mainCommit,
      checks: successfulChecks(),
    }),
  ).toThrow("source commit must be an exact 40-character lowercase commit");
});

test("fails closed for missing, pending, skipped, cancelled, or failing required contexts", async () => {
  const repository = await candidateRepository();
  for (const state of [
    { status: "missing", conclusion: undefined },
    { status: "queued", conclusion: undefined },
    { status: "completed", conclusion: "skipped" },
    { status: "completed", conclusion: "cancelled" },
    { status: "completed", conclusion: "failure" },
  ] as const) {
    const checks = successfulChecks();
    checks.check_runs =
      state.status === "missing"
        ? checks.check_runs.slice(1)
        : checks.check_runs.map((check, index) =>
            index === 0
              ? {
                  ...check,
                  status: state.status,
                  ...(state.conclusion === undefined ? {} : { conclusion: state.conclusion }),
                }
              : check,
          );
    expect(() =>
      assertCandidateEligibility({
        repositoryRoot: repository.root,
        sourceCommit: repository.sourceCommit,
        mainCommit: repository.mainCommit,
        checks,
      }),
    ).toThrow("required Candidate context is not successful");
  }
});

test("fails closed when a successful required context is not owned by GitHub Actions", async () => {
  const repository = await candidateRepository();
  const checks = successfulChecks();
  checks.check_runs = checks.check_runs.map((check, index) =>
    index === 0 ? { ...check, app: { id: 1 } } : check,
  );
  expect(() =>
    assertCandidateEligibility({
      repositoryRoot: repository.root,
      sourceCommit: repository.sourceCommit,
      mainCommit: repository.mainCommit,
      checks,
    }),
  ).toThrow("required Candidate context is not successful");
});

test("Candidate Freeze workflow is manual, exact, isolated, bounded, and non-overwriting", async () => {
  const workflow = parseYaml(await readFile(".github/workflows/package.yml", "utf8")) as {
    readonly name: string;
    readonly on: Readonly<{
      workflow_dispatch: Readonly<{
        inputs: Readonly<Record<string, Readonly<{ required: boolean; type: string }>>>;
      }>;
    }>;
    readonly permissions: Readonly<Record<string, string>>;
    readonly concurrency: Readonly<{ group: string; "cancel-in-progress": boolean }>;
    readonly jobs: Readonly<
      Record<
        string,
        Readonly<{
          "runs-on": string;
          "timeout-minutes": number;
          needs?: string;
          steps: readonly Readonly<{
            name?: string;
            uses?: string;
            run?: string;
            with?: Readonly<Record<string, string | number | boolean>>;
          }>[];
        }>
      >
    >;
  };
  const sourceCommit = ["$", "{{ inputs.source_commit }}"].join("");

  expect(workflow.name).toBe("Prepare candidate artifact");
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.on.workflow_dispatch.inputs).toMatchObject({
    source_commit: { required: true, type: "string" },
    version: { required: true, type: "string" },
  });
  expect(workflow.permissions).toEqual({ actions: "read", checks: "read", contents: "read" });
  expect(workflow.concurrency).toEqual({
    group: `candidate-freeze-${sourceCommit}`,
    "cancel-in-progress": false,
  });

  const eligibilityJob = workflow.jobs["eligibility"];
  expect(eligibilityJob?.["runs-on"]).toBe("ubuntu-latest");
  expect(eligibilityJob?.["timeout-minutes"]).toBeGreaterThan(0);
  expect(eligibilityJob?.["timeout-minutes"]).toBeLessThanOrEqual(5);
  const eligibilitySteps = eligibilityJob?.steps ?? [];
  expect(eligibilitySteps.every((step) => step.uses === undefined)).toBe(true);
  const eligibility = eligibilitySteps[0]?.run ?? "";
  expect(eligibility.indexOf("^[0-9a-f]{40}$")).toBeLessThan(eligibility.indexOf("gh api"));
  expect(eligibility).not.toMatch(/checkout|npm|bun|node /u);
  expect(eligibility).toContain('test "$GITHUB_REF" = "refs/heads/main"');
  expect(eligibility).toContain("repos/$GITHUB_REPOSITORY/compare/$SOURCE_COMMIT...$MAIN_COMMIT");
  expect(eligibility).toContain("repos/$GITHUB_REPOSITORY/commits/$SOURCE_COMMIT/check-runs");
  expect(eligibility).toContain(".app.id == 15368");
  expect(eligibility).toContain(
    "repos/$GITHUB_REPOSITORY/actions/artifacts?name=bearing-candidate-$SOURCE_COMMIT",
  );
  expect(eligibility).toContain('test "$EXISTING_COUNT" = "0"');

  const job = workflow.jobs["candidate"];
  expect(job?.needs).toBe("eligibility");
  expect(job?.["timeout-minutes"]).toBeGreaterThan(0);
  expect(job?.["timeout-minutes"]).toBeLessThanOrEqual(30);
  const steps = job?.steps ?? [];
  const checkoutIndex = steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
  const eligibilityIndex = steps.findIndex(
    (step) => step.name === "Revalidate exact Candidate eligibility",
  );
  const prepareIndex = steps.findIndex((step) => step.name === "Prepare frozen Candidate bundle");
  const uploadIndex = steps.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@"));
  expect(steps[checkoutIndex]?.with).toMatchObject({ ref: sourceCommit, "fetch-depth": 0 });
  expect(eligibilityIndex).toBeGreaterThan(checkoutIndex);
  expect(prepareIndex).toBeGreaterThan(eligibilityIndex);
  expect(uploadIndex).toBeGreaterThan(prepareIndex);
  const revalidation = steps[eligibilityIndex]?.run ?? "";
  expect(revalidation).toContain("scripts/candidate-freeze.ts");
  expect(revalidation).toContain('--main-commit "$MAIN_COMMIT"');
  const prepare = steps[prepareIndex]?.run ?? "";
  expect(prepare).toContain('--source-commit "$SOURCE_COMMIT"');
  expect(prepare).toContain('--version "$EXPECTED_VERSION"');
  expect(steps[uploadIndex]?.with).toMatchObject({
    name: `bearing-candidate-${sourceCommit}`,
    path: "release-candidate/",
    "if-no-files-found": "error",
    "retention-days": 14,
  });
  expect(steps[uploadIndex]?.with?.["overwrite"]).not.toBe(true);
  for (const action of steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]))) {
    expect(action).toMatch(/@[0-9a-f]{40}$/u);
  }
});

test("ordinary required CI has no Candidate artifact surface in any job", async () => {
  const workflow = parseYaml(await readFile(".github/workflows/ci.yml", "utf8")) as {
    readonly jobs: Readonly<
      Record<
        string,
        Readonly<{
          steps?: readonly Readonly<{
            name?: string;
            if?: string;
            uses?: string;
            run?: string;
            with?: Readonly<Record<string, string | number | boolean>>;
          }>[];
        }>
      >
    >;
  };
  const requiredCiSurface = Object.values(workflow.jobs).flatMap((job) =>
    (job.steps ?? []).flatMap((step) => [
      step.name ?? "",
      step.run ?? "",
      JSON.stringify(step.with ?? {}),
    ]),
  );
  expect(requiredCiSurface.join("\n")).not.toMatch(
    /bearing-candidate|candidate-receipt|prepare-release-candidate|candidate:prepare/u,
  );
  const artifactUploads = Object.entries(workflow.jobs).flatMap(([job, definition]) =>
    (definition.steps ?? [])
      .filter((step) => step.uses?.startsWith("actions/upload-artifact@"))
      .map((step) => ({ job, ...step })),
  );
  expect(artifactUploads).toEqual([
    {
      job: "browser-behavior",
      name: "Upload browser failure diagnostics",
      if: ["$", "{{ failure() }}"].join(""),
      uses: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      with: {
        name: ["browser-failure-$", "{{ github.run_id }}-$", "{{ github.run_attempt }}"].join(""),
        path: [
          "test-results/playwright/",
          "test-results/playwright-packed-portal/",
          "test-results/playwright-portal-isolation/",
        ].join("\n"),
        "if-no-files-found": "warn",
        "retention-days": 7,
      },
    },
  ]);
});
