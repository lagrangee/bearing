import { describe, expect, test } from "bun:test";
import {
  cleanupGitHubMatrixFixture,
  GITHUB_MATRIX_FIXTURE_LABEL,
  GITHUB_MATRIX_MILESTONE_PREFIX,
  type GitHubMatrixLifecycleCommand,
  prepareGitHubMatrixFixture,
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
    if (values[0] === "label") return "";
    const method = values[values.indexOf("--method") + 1] ?? "GET";
    const endpoint = values.find((value) => value.startsWith("repos/example/validation"));
    if (endpoint === "repos/example/validation") {
      return JSON.stringify({ id: 9001, node_id: "R_validation" });
    }
    if (endpoint === "repos/example/validation/milestones?state=open&per_page=100") {
      return JSON.stringify([...this.milestones.values()].filter(({ state }) => state === "open"));
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
      return JSON.stringify(
        [...this.issues.values()].filter((issue) => issue.milestone === milestone),
      );
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
    if (relation !== undefined && relation !== null && method === "POST") {
      this.relations.push(endpoint as string);
      return "{}";
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
      return JSON.stringify(issue);
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
    expect(fake.issues.get(100)?.labels).toContainEqual({ name: GITHUB_MATRIX_FIXTURE_LABEL });
    expect(fake.issues.get(101)?.labels).toEqual([
      { name: GITHUB_MATRIX_FIXTURE_LABEL },
      { name: "ready-for-agent" },
    ]);
    expect(fake.issues.get(100)?.body).toContain("Blocked by: #101");
    expect(fake.issues.get(101)?.body).toContain("Part of: #100");
    expect(fake.relations).toEqual([
      "repos/example/validation/issues/100/sub_issues",
      "repos/example/validation/issues/100/dependencies/blocked_by",
    ]);
  });

  test("cleans only the fixture pair and milestone idempotently after evidence capture", async () => {
    const fake = new FakeGitHubLifecycle();
    const lifecycle = await prepareGitHubMatrixFixture({
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

  test("recovers only an exact stale Matrix milestone pair and leaves unrelated work untouched", async () => {
    const fake = new FakeGitHubLifecycle();
    fake.addMilestone({ number: 7, title: `${GITHUB_MATRIX_MILESTONE_PREFIX}old`, state: "open" });
    fake.addMilestone({ number: 8, title: "Product milestone", state: "open" });
    for (const number of [70, 71]) {
      fake.addIssue({
        id: 10000 + number,
        node_id: `I_${number}`,
        number,
        state: "open",
        title: `Fixture ${number}`,
        body: "",
        labels: [{ name: GITHUB_MATRIX_FIXTURE_LABEL }],
        milestone: 7,
      });
    }
    const recovered = await recoverStaleGitHubMatrixMilestones({
      repositorySlug: "example/validation",
      currentGenerationId: generationId,
      command: fake.command,
    });
    expect(recovered).toEqual([7]);
    expect(fake.milestones.get(7)?.state).toBe("closed");
    expect(fake.milestones.get(8)?.state).toBe("open");
  });
});
