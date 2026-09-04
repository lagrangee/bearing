import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupGitHubMatrixFixture,
  GITHUB_MATRIX_FIXTURE_LABEL,
  GITHUB_MATRIX_MILESTONE_PREFIX,
  type GitHubMatrixLifecycleCommand,
  prepareGitHubMatrixFixture,
  recoverPreparedGitHubMatrixFixtureFailure,
  recoverStaleGitHubMatrixMilestones,
} from "../scripts/github-live-journey";

type Milestone = { number: number; title: string; state: "open" | "closed" };
type Issue = {
  id: number;
  node_id: string;
  number: number;
  state: "open" | "closed";
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  milestone: number;
};

class FakeGitHubLifecycle {
  readonly calls: string[][] = [];
  readonly milestones = new Map<number, Milestone>();
  readonly issues = new Map<number, Issue>();
  readonly relations: string[] = [];
  private nextMilestone = 10;
  private nextIssue = 100;

  addMilestone(milestone: Milestone) {
    this.milestones.set(milestone.number, milestone);
  }

  addIssue(issue: Issue) {
    this.issues.set(issue.number, issue);
  }

  command: GitHubMatrixLifecycleCommand = async (args) => {
    const values = [...args];
    this.calls.push(values);
    const paginated = (items: readonly unknown[]) =>
      JSON.stringify(
        values.includes("--slurp")
          ? Array.from({ length: Math.ceil(items.length / 100) }, (_, index) =>
              items.slice(index * 100, (index + 1) * 100),
            )
          : items.slice(0, 100),
      );
    if (values[0] === "label") return "";
    const method = values[values.indexOf("--method") + 1] ?? "GET";
    const endpoint = values.find((value) => value.startsWith("repos/example/validation"));
    if (endpoint === "repos/example/validation") {
      return JSON.stringify({ id: 9001, node_id: "R_validation" });
    }
    if (endpoint === "repos/example/validation/milestones?state=open&per_page=100") {
      return paginated([...this.milestones.values()].filter(({ state }) => state === "open"));
    }
    if (endpoint === "repos/example/validation/milestones?state=all&per_page=100") {
      return paginated([...this.milestones.values()]);
    }
    if (endpoint === "repos/example/validation/milestones" && method === "POST") {
      const title =
        values.find((value) => value.startsWith("title="))?.slice("title=".length) ?? "";
      const milestone = { number: this.nextMilestone++, title, state: "open" as const };
      this.milestones.set(milestone.number, milestone);
      return JSON.stringify(milestone);
    }
    const milestoneMatch = endpoint?.match(/milestones\/(\d+)$/u);
    if (milestoneMatch !== undefined && milestoneMatch !== null) {
      const number = Number(milestoneMatch[1]);
      const milestone = this.milestones.get(number);
      if (milestone === undefined) throw new Error("missing milestone");
      if (method === "PATCH") milestone.state = "closed";
      return JSON.stringify(milestone);
    }
    const milestoneIssues = endpoint?.match(/issues\?state=all&milestone=(\d+)&per_page=100$/u);
    if (milestoneIssues !== undefined && milestoneIssues !== null) {
      const milestone = Number(milestoneIssues[1]);
      return paginated([...this.issues.values()].filter((issue) => issue.milestone === milestone));
    }
    if (endpoint === "repos/example/validation/issues" && method === "POST") {
      const raw = values.filter((value) => !value.startsWith("--"));
      const title = raw.find((value) => value.startsWith("title="))?.slice("title=".length) ?? "";
      const body = raw.find((value) => value.startsWith("body="))?.slice("body=".length) ?? "";
      const labels = raw
        .filter((value) => value.startsWith("labels[]="))
        .map((value) => ({ name: value.slice("labels[]=".length) }));
      const milestone = Number(
        raw.find((value) => value.startsWith("milestone="))?.slice("milestone=".length),
      );
      const number = this.nextIssue++;
      const issue: Issue = {
        id: 10000 + number,
        node_id: `I_${number}`,
        number,
        state: "open",
        title,
        body,
        labels,
        milestone,
      };
      this.issues.set(number, issue);
      return JSON.stringify(issue);
    }
    const relation = endpoint?.match(/issues\/(\d+)\/(sub_issues|dependencies\/blocked_by)$/u);
    if (relation !== undefined && relation !== null) {
      if (method === "POST") {
        this.relations.push(endpoint as string);
        return "{}";
      }
      const child = this.issues.get(101);
      return JSON.stringify(child === undefined ? [] : [{ id: child.id, number: child.number }]);
    }
    const relationRead = endpoint?.match(
      /issues\/(\d+)\/(sub_issues|dependencies\/blocked_by)\?per_page=100$/u,
    );
    if (relationRead !== undefined && relationRead !== null) {
      const child = this.issues.get(101);
      return JSON.stringify(child === undefined ? [] : [{ id: child.id, number: child.number }]);
    }
    const issueMatch = endpoint?.match(/issues\/(\d+)$/u);
    if (issueMatch !== undefined && issueMatch !== null) {
      const issue = this.issues.get(Number(issueMatch[1]));
      if (issue === undefined) throw new Error("missing issue");
      if (method === "PATCH") {
        if (values.includes("state=closed")) issue.state = "closed";
        const body = values.find((value) => value.startsWith("body="));
        if (body !== undefined) issue.body = body.slice("body=".length);
      }
      return JSON.stringify({ ...issue, milestone: { number: issue.milestone } });
    }
    throw new Error(`unexpected command: ${values.join(" ")}`);
  };
}

const generationId = "11111111-1111-4111-8111-111111111111";
const scopeKey = `bearing-live-test-${"a".repeat(64)}`;

describe("GitHub Matrix fixture lifecycle", () => {
  test("creates one milestone, stable label, parent, ready child, and both native relations", async () => {
    const fake = new FakeGitHubLifecycle();
    const lifecycle = await prepareGitHubMatrixFixture({
      sourceRoot: process.cwd(),
      repositorySlug: "example/validation",
      scopeKey,
      generationId,
      command: fake.command,
    });

    expect(lifecycle).toMatchObject({
      repository: { databaseId: 9001, nodeId: "R_validation" },
      milestone: { title: `${GITHUB_MATRIX_MILESTONE_PREFIX}${generationId}` },
      parent: { number: 100 },
      child: { number: 101 },
    });
    expect(fake.issues.get(100)?.labels).toEqual([
      { name: GITHUB_MATRIX_FIXTURE_LABEL },
      { name: "ready-for-agent" },
    ]);
    expect(fake.issues.get(101)?.labels).toEqual([
      { name: GITHUB_MATRIX_FIXTURE_LABEL },
      { name: "ready-for-agent" },
    ]);
    for (const number of [100, 101]) {
      expect(fake.issues.get(number)?.body).toContain("## What to build");
      expect(fake.issues.get(number)?.body).toContain("## Acceptance criteria");
      expect(fake.issues.get(number)?.body).toContain("## Blocked by");
      expect(fake.issues.get(number)?.body).toContain("## Completion evidence");
    }
    expect(fake.issues.get(100)?.body).toContain("- #101");
    expect(fake.issues.get(101)?.body).toContain("## Parent\n\n#100");
    expect(fake.issues.get(101)?.body).toContain("None — can start immediately");
    expect(fake.issues.get(101)?.body).toContain("formatSecondaryLabel");
    expect(fake.relations).toEqual([
      "repos/example/validation/issues/100/sub_issues",
      "repos/example/validation/issues/100/dependencies/blocked_by",
    ]);
  });

  test("cleans only the fixture pair and milestone idempotently after evidence capture", async () => {
    const fake = new FakeGitHubLifecycle();
    const lifecycle = await prepareGitHubMatrixFixture({
      sourceRoot: process.cwd(),
      repositorySlug: "example/validation",
      scopeKey,
      generationId,
      command: fake.command,
    });
    await cleanupGitHubMatrixFixture({ lifecycle, command: fake.command });
    const writesAfterFirstCleanup = fake.calls.filter((args) =>
      args.includes("state=closed"),
    ).length;
    await cleanupGitHubMatrixFixture({ lifecycle, command: fake.command });

    expect(fake.issues.get(100)?.state).toBe("closed");
    expect(fake.issues.get(101)?.state).toBe("closed");
    expect(fake.milestones.get(10)?.state).toBe("closed");
    expect(fake.calls.filter((args) => args.includes("state=closed"))).toHaveLength(
      writesAfterFirstCleanup,
    );
  });

  test("rejects a fixture whose native relation cannot be read back", async () => {
    const fake = new FakeGitHubLifecycle();
    const command: GitHubMatrixLifecycleCommand = async (args) =>
      args.some((value) => value.endsWith("/sub_issues?per_page=100")) ? "[]" : fake.command(args);

    await expect(
      prepareGitHubMatrixFixture({
        sourceRoot: process.cwd(),
        repositorySlug: "example/validation",
        scopeKey,
        generationId,
        command,
      }),
    ).rejects.toThrow("failed readback");
  });

  test("preserves partial external-effect recovery when fixture cleanup is unverified", async () => {
    const fake = new FakeGitHubLifecycle();
    const command: GitHubMatrixLifecycleCommand = async (args) => {
      const values = [...args];
      if (values.some((value) => value.endsWith("/sub_issues?per_page=100"))) {
        return "[]";
      }
      if (
        values.some((value) => value.endsWith("/issues/101")) &&
        values.includes("state=closed")
      ) {
        throw new Error("fixture cleanup timed out");
      }
      return fake.command(args);
    };

    const error = await prepareGitHubMatrixFixture({
      sourceRoot: process.cwd(),
      repositorySlug: "example/validation",
      scopeKey,
      generationId,
      command,
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      name: "GitHubMatrixFixturePreparationError",
      message: "GitHub Matrix fixture native identity, ready state, or relations failed readback.",
      externalEffect: {
        kind: "github-matrix-fixture",
        repositorySlug: "example/validation",
        generationId,
        milestoneNumber: 10,
        issueNumbers: [100, 101],
        cleanupOutcome: "unverified",
        unverifiedTargets: ["issue #101"],
      },
    });
    expect(fake.issues.get(100)?.state).toBe("closed");
    expect(fake.milestones.get(10)?.state).toBe("closed");
  });

  test("recovers a milestone whose create response was lost and preserves the original failure", async () => {
    const fake = new FakeGitHubLifecycle();
    for (let number = 1_000; number < 1_101; number += 1) {
      fake.addMilestone({ number, title: `Historical ${number}`, state: "closed" });
    }
    const command: GitHubMatrixLifecycleCommand = async (args) => {
      const values = [...args];
      if (values.includes("POST") && values.includes("repos/example/validation/milestones")) {
        await fake.command(args);
        throw new Error("milestone response lost");
      }
      return fake.command(args);
    };

    const error = await prepareGitHubMatrixFixture({
      sourceRoot: process.cwd(),
      repositorySlug: "example/validation",
      scopeKey,
      generationId,
      command,
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      name: "GitHubMatrixFixturePreparationError",
      message: "milestone response lost",
      externalEffect: {
        milestoneNumber: 10,
        milestoneTitle: `${GITHUB_MATRIX_MILESTONE_PREFIX}${generationId}`,
        issueNumbers: [],
        cleanupOutcome: "complete",
      },
    });
    expect(fake.milestones.get(10)?.state).toBe("closed");
  });

  test("recovers a fixture Issue whose create response was lost", async () => {
    const fake = new FakeGitHubLifecycle();
    let issueResponseLost = false;
    const command: GitHubMatrixLifecycleCommand = async (args) => {
      const values = [...args];
      if (
        !issueResponseLost &&
        values.includes("POST") &&
        values.includes("repos/example/validation/issues")
      ) {
        issueResponseLost = true;
        await fake.command(args);
        throw new Error("issue response lost");
      }
      return fake.command(args);
    };

    const error = await prepareGitHubMatrixFixture({
      sourceRoot: process.cwd(),
      repositorySlug: "example/validation",
      scopeKey,
      generationId,
      command,
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      name: "GitHubMatrixFixturePreparationError",
      message: "issue response lost",
      externalEffect: {
        milestoneNumber: 10,
        issueNumbers: [100],
        cleanupOutcome: "complete",
      },
    });
    expect(fake.issues.get(100)?.state).toBe("closed");
    expect(fake.milestones.get(10)?.state).toBe("closed");
  });

  test("preserves a post-create failure while cleaning its exact remote fixture", async () => {
    const fake = new FakeGitHubLifecycle();
    const lifecycle = await prepareGitHubMatrixFixture({
      sourceRoot: process.cwd(),
      repositorySlug: "example/validation",
      scopeKey,
      generationId,
      command: fake.command,
    });

    const error = await recoverPreparedGitHubMatrixFixtureFailure({
      cause: new Error("local materialization failed"),
      lifecycle,
      command: fake.command,
    });

    expect(error).toMatchObject({
      name: "GitHubMatrixFixturePreparationError",
      message: "local materialization failed",
      externalEffect: {
        milestoneNumber: 10,
        issueNumbers: [100, 101],
        cleanupOutcome: "complete",
      },
    });
    expect(fake.issues.get(100)?.state).toBe("closed");
    expect(fake.issues.get(101)?.state).toBe("closed");
    expect(fake.milestones.get(10)?.state).toBe("closed");
  });

  test("rejects Matt Kit output that differs from its versioned materialization receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-github-fixture-contract-"));
    try {
      const source = join(
        process.cwd(),
        "validation/live-journey/fixtures/github-provider/matt-kit-output",
      );
      const output = join(root, "validation/live-journey/fixtures/github-provider/matt-kit-output");
      await cp(source, output, { recursive: true });
      const child = join(output, "child-delivery.md");
      await writeFile(
        child,
        `${await readFile(child, "utf8")}\nChanged outside Matt Kit output.\n`,
      );

      await expect(
        prepareGitHubMatrixFixture({
          sourceRoot: root,
          repositorySlug: "example/validation",
          scopeKey,
          generationId,
          command: new FakeGitHubLifecycle().command,
        }),
      ).rejects.toThrow("versioned materialization receipt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("recovers only an exact stale Matrix milestone pair and leaves unrelated work untouched", async () => {
    const fake = new FakeGitHubLifecycle();
    const staleGenerationId = "22222222-2222-4222-8222-222222222222";
    fake.addMilestone({
      number: 7,
      title: `${GITHUB_MATRIX_MILESTONE_PREFIX}${staleGenerationId}`,
      state: "open",
    });
    fake.addMilestone({ number: 8, title: "Product milestone", state: "open" });
    const marker = `<!-- bearing-live-scope:${scopeKey} -->`;
    fake.addIssue({
      id: 10070,
      node_id: "I_70",
      number: 70,
      state: "open",
      title: "Complete secondary label delivery",
      body: `${marker}\n\n## What to build\n\nComplete the delivery.\n\n## Acceptance criteria\n\n- [ ] Delivery complete\n\n## Blocked by\n\n- #71\n\n## Completion evidence\n`,
      labels: [{ name: GITHUB_MATRIX_FIXTURE_LABEL }],
      milestone: 7,
    });
    fake.addIssue({
      id: 10071,
      node_id: "I_71",
      number: 71,
      state: "open",
      title: "Complete secondary label formatting",
      body: `${marker}\n\n## Parent\n\n#70\n\n## What to build\n\nComplete the child.\n\n## Acceptance criteria\n\n- [ ] Child complete\n\n## Blocked by\n\nNone — can start immediately\n\n## Completion evidence\n`,
      labels: [{ name: GITHUB_MATRIX_FIXTURE_LABEL }],
      milestone: 7,
    });
    const recovered = await recoverStaleGitHubMatrixMilestones({
      repositorySlug: "example/validation",
      currentGenerationId: generationId,
      command: fake.command,
    });
    expect(recovered).toEqual([7]);
    expect(fake.milestones.get(7)?.state).toBe("closed");
    expect(fake.milestones.get(8)?.state).toBe("open");
  });

  test("refuses a stale milestone whose labelled Issues lack exact fixture identity", async () => {
    const fake = new FakeGitHubLifecycle();
    fake.addMilestone({
      number: 7,
      title: `${GITHUB_MATRIX_MILESTONE_PREFIX}22222222-2222-4222-8222-222222222222`,
      state: "open",
    });
    for (const number of [70, 71]) {
      fake.addIssue({
        id: 10000 + number,
        node_id: `I_${number}`,
        number,
        state: "open",
        title:
          number === 70
            ? "Complete secondary label delivery"
            : "Complete secondary label formatting",
        body: "## What to build\n\nUnrelated labelled work.\n",
        labels: [{ name: GITHUB_MATRIX_FIXTURE_LABEL }],
        milestone: 7,
      });
    }

    await expect(
      recoverStaleGitHubMatrixMilestones({
        repositorySlug: "example/validation",
        currentGenerationId: generationId,
        command: fake.command,
      }),
    ).rejects.toThrow("canonical open Delivery");
    expect(fake.issues.get(70)?.state).toBe("open");
    expect(fake.issues.get(71)?.state).toBe("open");
    expect(fake.milestones.get(7)?.state).toBe("open");
  });
});
