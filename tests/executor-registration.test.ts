import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertExecutorRegistrationsCurrent,
  type ExecutorNominationAssessment,
  readConfiguredExecutionProfiles,
  renderExecutionProfile,
  resolveExecutorNomination,
  resolveExecutorNominations,
} from "../src/executor-registration";
import { makeTemporaryDirectory } from "./helpers";

const writeSkill = async (
  homeDir: string,
  surface: "agent-skills" | "claude",
  name: string,
  body: string,
): Promise<string> => {
  const root = surface === "agent-skills" ? ".agents/skills" : ".claude/skills";
  const directory = join(homeDir, root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---
name: ${name}
description: "${name} contract"
---

${body}
`,
  );
  return directory;
};

const assessment = (
  capabilityLocator: string,
  executionOwnershipEvidence: string,
  finalWritebackEvidence: string,
  nativeArtifacts: readonly Readonly<{ description: string; evidence: string }>[],
  writebackDescription: string,
  requiredReferences: readonly string[] = [],
): ExecutorNominationAssessment => ({
  capabilityLocator,
  conclusion: "owns-end-to-end-execution-and-final-writeback",
  requiredReferences: [...requiredReferences],
  executionOwnershipEvidence,
  finalWritebackEvidence,
  nativeArtifacts: [...nativeArtifacts],
  writebackBehavior: {
    description: writebackDescription,
    evidence: finalWritebackEvidence,
  },
});

describe("user-nominated Executor Registration", () => {
  test("resolves only nominated end-to-end skills into surface-scoped portable identities", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-executor-registration-");
    await writeSkill(
      homeDir,
      "agent-skills",
      "implement",
      "Implement the work from its accepted spec. Run verification, then commit your work.",
    );
    await writeSkill(
      homeDir,
      "claude",
      "execute-plan",
      "Execute the plan end to end and publish the final completion report.",
    );

    const registrations = await resolveExecutorNominations(
      homeDir,
      ["agent-skills:implement", "claude:execute-plan"],
      [
        assessment(
          "agent-skills:implement",
          "Implement the work from its accepted spec.",
          "commit your work",
          [
            {
              description: "Implementation and source changes produced by the executor.",
              evidence: "Implement the work from its accepted spec.",
            },
            {
              description: "Verification outputs produced by the executor.",
              evidence: "Run verification",
            },
            {
              description: "Repository commits produced by the executor.",
              evidence: "commit your work",
            },
          ],
          "Complete writeback with the repository commit required by the skill.",
        ),
        assessment(
          "claude:execute-plan",
          "Execute the plan end to end",
          "publish the final completion report",
          [
            {
              description: "Final completion report produced by the executor.",
              evidence: "publish the final completion report",
            },
          ],
          "Complete writeback with the final completion report.",
        ),
      ],
    );

    expect(registrations).toHaveLength(2);
    expect(registrations[0]).toMatchObject({
      profileKey: "agent-skills-implement",
      displayName: "/implement",
      surface: "agent-skills",
      capabilityLocator: "agent-skills:implement",
      nativeArtifacts: expect.arrayContaining([
        expect.stringMatching(/Implementation/iu),
        expect.stringMatching(/verification/iu),
        expect.stringMatching(/commits/iu),
      ]),
      writebackBehavior: expect.stringMatching(/commit/iu),
    });
    expect(registrations[1]).toMatchObject({
      profileKey: "claude-execute-plan",
      displayName: "/execute-plan",
      surface: "claude",
      capabilityLocator: "claude:execute-plan",
      writebackBehavior: expect.stringMatching(/completion report/iu),
    });
  });

  test("rejects an unavailable or supporting-only nomination without scanning alternatives", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-executor-supporting-");
    await writeSkill(
      homeDir,
      "agent-skills",
      "tdd",
      "Use test-driven development. Write one failing test, then make it pass.",
    );

    await expect(resolveExecutorNomination(homeDir, "agent-skills:tdd")).rejects.toThrow(
      "explicit Agent Surface semantic assessment",
    );
    await expect(resolveExecutorNomination(homeDir, "agent-skills:missing")).rejects.toThrow(
      "unavailable",
    );
    await expect(
      resolveExecutorNomination(
        homeDir,
        "agent-skills:tdd",
        assessment(
          "agent-skills:tdd",
          "Implement the complete feature.",
          "Commit the completed feature.",
          [
            {
              description: "Implementation changes produced by the executor.",
              evidence: "Implement the complete feature.",
            },
          ],
          "Commit the completed feature.",
        ),
      ),
    ).rejects.toThrow("cites text outside");
  });

  test("never infers eligibility from ambiguous, negated, or delegated free prose", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-executor-negated-");
    await writeSkill(
      homeDir,
      "agent-skills",
      "review-only",
      [
        "Do not implement the work; review it and report findings.",
        "The final writeback belongs to the caller.",
      ].join("\n"),
    );

    await expect(resolveExecutorNomination(homeDir, "agent-skills:review-only")).rejects.toThrow(
      "explicit Agent Surface semantic assessment",
    );
    await writeSkill(
      homeDir,
      "agent-skills",
      "delegate-only",
      [
        "Review a plan before another agent can execute the plan.",
        "Ask the caller to commit your work.",
      ].join("\n"),
    );
    await expect(resolveExecutorNomination(homeDir, "agent-skills:delegate-only")).rejects.toThrow(
      "explicit Agent Surface semantic assessment",
    );
    await writeSkill(
      homeDir,
      "agent-skills",
      "review-check",
      "Review the proposal and report findings about whether agents implement the work and commit your work.",
    );
    await expect(resolveExecutorNomination(homeDir, "agent-skills:review-check")).rejects.toThrow(
      "explicit Agent Surface semantic assessment",
    );
  });

  test("accepts equivalent end-to-end ownership language without a skill-name whitelist", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-executor-equivalent-language-");
    await writeSkill(
      homeDir,
      "agent-skills",
      "ship-change",
      "Build the requested change end to end, create a repository commit, and report completion.",
    );

    await expect(
      resolveExecutorNomination(
        homeDir,
        "agent-skills:ship-change",
        assessment(
          "agent-skills:ship-change",
          "Build the requested change end to end",
          "report completion",
          [
            {
              description: "Repository commit produced by the executor.",
              evidence: "create a repository commit",
            },
            {
              description: "Completion outcome produced by the executor.",
              evidence: "report completion",
            },
          ],
          "Report completion after creating the repository commit.",
        ),
      ),
    ).resolves.toMatchObject({
      profileKey: "agent-skills-ship-change",
      nativeArtifacts: expect.arrayContaining([expect.stringMatching(/commit/iu)]),
    });
    await writeSkill(
      homeDir,
      "agent-skills",
      "never-skip",
      "Never skip tests; implement the work and commit your work.",
    );
    await expect(
      resolveExecutorNomination(
        homeDir,
        "agent-skills:never-skip",
        assessment(
          "agent-skills:never-skip",
          "implement the work",
          "commit your work",
          [
            {
              description: "Implementation changes produced by the executor.",
              evidence: "implement the work",
            },
            {
              description: "Repository commit produced by the executor.",
              evidence: "commit your work",
            },
          ],
          "Complete writeback with the repository commit.",
        ),
      ),
    ).resolves.toMatchObject({
      profileKey: "agent-skills-never-skip",
    });
  });

  test("uses a directly required local execution contract as qualification evidence", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-executor-reference-");
    const directory = await writeSkill(
      homeDir,
      "claude",
      "execute-work",
      "Read `references/execution-contract.md` completely before acting.",
    );
    await mkdir(join(directory, "references"), { recursive: true });
    await writeFile(
      join(directory, "references/execution-contract.md"),
      [
        "# Execution Contract",
        "",
        "Own end-to-end execution of the work.",
        "Run project-native tests and produce the final outcome.",
      ].join("\n"),
    );

    await expect(
      resolveExecutorNomination(
        homeDir,
        "claude:execute-work",
        assessment(
          "claude:execute-work",
          "Own end-to-end execution of the work.",
          "produce the final outcome",
          [
            {
              description: "Project-native test outputs produced by the executor.",
              evidence: "Run project-native tests",
            },
            {
              description: "Final execution outcome produced by the executor.",
              evidence: "produce the final outcome",
            },
          ],
          "Complete writeback with the final execution outcome.",
          ["references/execution-contract.md"],
        ),
      ),
    ).resolves.toMatchObject({
      profileKey: "claude-execute-work",
      nativeArtifacts: expect.arrayContaining([expect.stringMatching(/test/iu)]),
      writebackBehavior: expect.stringMatching(/final execution outcome/iu),
    });
  });

  test("reads normal relative, case-preserving, and adjacent required Markdown references", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-executor-relative-reference-");
    const directory = await writeSkill(
      homeDir,
      "agent-skills",
      "execute-adjacent",
      "The authoritative execution contract is [Execution](../shared/Execution.md).",
    );
    await mkdir(join(directory, "../shared"), { recursive: true });
    await writeFile(
      join(directory, "../shared/Execution.md"),
      "Build the requested work end to end. Write the final outcome.",
    );

    await expect(
      resolveExecutorNomination(
        homeDir,
        "agent-skills:execute-adjacent",
        assessment(
          "agent-skills:execute-adjacent",
          "Build the requested work end to end.",
          "Write the final outcome.",
          [
            {
              description: "Final execution outcome produced by the executor.",
              evidence: "Write the final outcome.",
            },
          ],
          "Complete writeback with the final outcome.",
          ["../shared/Execution.md"],
        ),
      ),
    ).resolves.toMatchObject({
      profileKey: "agent-skills-execute-adjacent",
      writebackBehavior: expect.stringMatching(/final/iu),
    });
  });

  test("binds the assessed full contract generation through the Apply transaction", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-executor-generation-");
    const directory = await writeSkill(
      homeDir,
      "agent-skills",
      "implement",
      "Implement the work. Commit your work.",
    );
    const registration = await resolveExecutorNomination(
      homeDir,
      "agent-skills:implement",
      assessment(
        "agent-skills:implement",
        "Implement the work.",
        "Commit your work.",
        [
          {
            description: "Repository commit produced by the executor.",
            evidence: "Commit your work.",
          },
        ],
        "Complete writeback with the repository commit.",
      ),
    );
    await writeFile(
      join(directory, "SKILL.md"),
      `---
name: implement
description: "implement contract"
---

The following legacy sentences are examples only and do not define this helper.
Implement the work. Commit your work.
`,
    );

    await expect(assertExecutorRegistrationsCurrent(homeDir, [registration])).rejects.toThrow(
      "changed after Repository Configuration review",
    );
  });

  test("renders one structured project-owned profile that its reader accepts", async () => {
    const profile = renderExecutionProfile({
      profileKey: "agent-skills-implement",
      displayName: "/implement",
      surface: "agent-skills",
      capabilityLocator: "agent-skills:implement",
      nativeArtifacts: [
        "Implementation and source changes actually produced by the executor.",
        "Repository commits actually produced by the executor.",
      ],
      writebackBehavior:
        "Complete execution with the skill-owned repository commit after verification.",
    }).toString("utf8");

    expect(profile).toContain("Type: execution-profile");
    expect(profile).toContain("Profile key: agent-skills-implement");
    expect(profile).toContain("Capability locator: agent-skills:implement");
    expect(profile).toContain("## Native Artifacts");
    expect(profile).toContain("Implementation and source changes");
    expect(profile).toContain("## Writeback Behavior");
    expect(profile).toContain("skill-owned repository commit");
    expect(profile).toContain("## Durable Evidence");
    expect(profile).toContain("## Fallback Receipt");
    expect(profile).toContain("## Asset Admission");
    expect(profile).toContain("Do not register execution output as an Asset automatically.");
    expect(profile).not.toContain("Kind: executor-profile");
    expect(profile).not.toMatch(/\b(?:preferred|default executor)\b/iu);

    const repoRoot = await makeTemporaryDirectory("bearing-execution-profile-roundtrip-");
    await mkdir(join(repoRoot, ".bearing/executor-profiles"), { recursive: true });
    await writeFile(
      join(repoRoot, ".bearing/executor-profiles/agent-skills-implement.md"),
      profile,
    );
    await expect(
      readConfiguredExecutionProfiles(repoRoot, ["agent-skills"], ["agent-skills-implement"]),
    ).resolves.toMatchObject([
      {
        profileKey: "agent-skills-implement",
        capabilityLocator: "agent-skills:implement",
      },
    ]);
  });
});
