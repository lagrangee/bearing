import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const read = (path: string): Promise<string> => readFile(path, "utf8");

const expectInOrder = (source: string, values: readonly string[]): void => {
  let previous = -1;
  for (const value of values) {
    const current = source.indexOf(value);
    expect(current, `${value} is missing or out of order`).toBeGreaterThan(previous);
    previous = current;
  }
};

describe("reusable release Live Journey runbook", () => {
  test("is reached through one short repository pointer", async () => {
    const [instructions, runbook] = await Promise.all([
      read("docs/agents/codex-e2e.md"),
      read("docs/agents/release-live-journey.md"),
    ]);

    const pointer = instructions.slice(instructions.indexOf("## Release Live Journey"));
    expect(pointer).toContain("## Release Live Journey");
    expect(pointer).toContain("[Release Live Journey Runbook](release-live-journey.md)");
    expect(pointer).toContain("Before coordinating a Bearing release");
    expect(pointer).toMatch(
      /or defining, running, or reviewing a release Live Journey,[\s\S]*read and follow/u,
    );
    expect(pointer).not.toContain("gpt-5.6-luna");
    expect(runbook).toContain("# Release Live Journey Runbook");
  });

  test("owns the reusable orchestration order and defers the Codex contract", async () => {
    const [runbook, codexPolicy] = await Promise.all([
      read("docs/agents/release-live-journey.md"),
      read("docs/agents/codex-e2e.md"),
    ]);

    expectInOrder(runbook, [
      "## 1. Finalize the release source",
      "## 2. Inspect prerequisites",
      "## 3. Coordinate Candidate Freeze",
      "## 4. Enter the exact Candidate locally",
      "## 5. Run the Codex Matrix",
      "## 6. Collect Human compatibility",
      "## 7. Dispatch protected Publication",
      "## 8. Read back the public release",
      "## 9. Hand off final evidence",
    ]);
    expect(runbook).toContain("[Codex E2E Policy](codex-e2e.md)");
    expect(runbook).toContain("scripts/run-live-journey.ts --help");
    expect(runbook).not.toContain("gpt-5.6-luna");
    expect(runbook).not.toContain("model_reasoning_effort");
    expect(codexPolicy).toContain("gpt-5.6-luna");
    expect(codexPolicy).toContain('model_reasoning_effort="high"');
  });

  test("starts with one reusable source-finalization boundary", async () => {
    const runbook = await read("docs/agents/release-live-journey.md");
    const finalization = runbook.slice(
      runbook.indexOf("## 1. Finalize the release source"),
      runbook.indexOf("## 2. Inspect prerequisites"),
    );

    expect(finalization).toMatch(
      /exact source commit[\s\S]*package version[\s\S]*dated changelog[\s\S]*release notes/iu,
    );
    expect(finalization).toMatch(
      /README[\s\S]*Agent installation guidance[\s\S]*static demo[\s\S]*feedback[\s\S]*security/iu,
    );
    expect(finalization).toContain("Known Exceptions");
    expect(finalization).toMatch(/ordinary Pull Request[\s\S]*protected `main`/u);
    expect(finalization).toContain("six required CI contexts");
    expect(finalization).toContain("Release Content Complete");
    expect(finalization).toMatch(/does not dispatch Candidate Freeze or Publication/u);
    expect(finalization).toMatch(
      /Candidate-sensitive tracked\s+change[\s\S]*invalidates[\s\S]*finalization readback/u,
    );
    expect(finalization).toMatch(/private evidence[\s\S]*does not change[\s\S]*source identity/iu);
    expect(finalization).not.toMatch(/candidate:prepare|workflow_dispatch|npm publish/u);
  });

  test("keeps four Human checkpoints and complete attended lane boundaries", async () => {
    const runbook = await read("docs/agents/release-live-journey.md");

    expect(runbook).toContain("## Human checkpoints");
    expect(runbook).toContain("1. Natural-language release start");
    expect(runbook).toContain("2. Claude Code and WorkBuddy results");
    expect(runbook).toContain("3. Protected environment approval");
    expect(runbook).toContain("4. Final Gate decision");
    expect(runbook).toContain("Give Claude Code and WorkBuddy the same exact Candidate");
    expect(runbook).toMatch(
      /installation[\s\S]*activation boundary[\s\S]*Repository Configuration[\s\S]*feature-scope decision[\s\S]*complex owner-composed workflow[\s\S]*exact reconciliation[\s\S]*truthful outcome/iu,
    );
    expect(runbook).toContain("WorkBuddy Desktop");
    expect(runbook).toMatch(
      /CodeBuddy CLI[\s\S]*deep link[\s\S]*Codex[\s\S]*Claude[\s\S]*manual file manipulation[\s\S]*cannot substitute/u,
    );
    expect(runbook).toContain("`pass`, `fail`, or `anomaly`");
    expect(runbook).toMatch(
      /clean profile[\s\S]*screenshots[\s\S]*full transcript[\s\S]*separate report/u,
    );

    const compatibility = runbook.slice(
      runbook.indexOf("## 6. Collect Human compatibility"),
      runbook.indexOf("## 7. Dispatch protected Publication"),
    );
    expect(compatibility).toMatch(/missing Human result[\s\S]*missing evidence/u);
    expect(compatibility).toMatch(/`fail` or `anomaly`[\s\S]*exact Candidate identity/u);
    expect(compatibility).toMatch(
      /observed blocker[\s\S]*resumption point[\s\S]*Keep the lane incomplete/u,
    );
    expect(compatibility).toMatch(/Do not replace[\s\S]*another Agent[\s\S]*compatibility layer/u);
    expect(compatibility).toMatch(/new full generation[\s\S]*Candidate/u);
  });

  test("preserves Candidate identity, owner boundaries, and truthful resumption", async () => {
    const runbook = await read("docs/agents/release-live-journey.md");

    expect(runbook).toMatch(
      /Candidate identity[\s\S]*package version[\s\S]*source commit[\s\S]*workflow[\s\S]*run ID[\s\S]*tarball SHA-256/u,
    );
    expect(runbook).toMatch(/exact-Candidate binding[\s\S]*Matrix definition digest/u);
    expect(runbook).toContain("does not change the Release Candidate bytes");
    expect(runbook).toContain("The Matrix generation ID stays separate");
    expect(runbook).toMatch(/missing Human result[\s\S]*missing evidence/u);
    expect(runbook).toMatch(
      /exact Candidate identity[\s\S]*observed blocker[\s\S]*resumption point/u,
    );
    expect(runbook).toMatch(/protected publication environment[\s\S]*only Human `Go`/u);
    expect(runbook).toMatch(/Publication workflow[\s\S]*npm[\s\S]*tag[\s\S]*GitHub Release/u);
    expect(runbook).toMatch(/read-only public readback[\s\S]*Candidate\s+Receipt/u);
    expect(runbook).toMatch(
      /Publication[\s\S]*public readback[\s\S]*Gate Passage[\s\S]*separate outcomes/u,
    );
  });
});
