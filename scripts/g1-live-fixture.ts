import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { BEARING_POINTER } from "../src/agent-surface-entry";
import { codexE2ERuntimeArguments } from "./codex-e2e-runtime";

export const G1_LIVE_PLAN_ID = "bearing-0.1.1-g1-live-v1";
export const G1_LIVE_JOURNEYS = [
  "L1-positive",
  "L1-negative",
  "L2-positive",
  "L2-negative",
  "L3-positive",
  "L3-negative",
  "L4-positive",
  "L4-negative",
  "L5-positive",
  "L5-negative",
  "L7-positive",
  "L7-negative",
] as const;
export type G1LiveJourney = (typeof G1_LIVE_JOURNEYS)[number];
export const G1_LIVE_SURFACES = ["codex", "claude-code"] as const;
export type G1LiveSurface = (typeof G1_LIVE_SURFACES)[number];

const explicitSkillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const serializeG1LiveSkillInvocation = (
  surface: G1LiveSurface,
  skillName: string,
  instruction: string,
): string => {
  if (!explicitSkillNamePattern.test(skillName)) {
    throw new Error(`Invalid explicit skill name: ${skillName}`);
  }
  if (instruction.length === 0 || instruction.trim() !== instruction) {
    throw new Error("Explicit skill instruction must be one trimmed non-empty string.");
  }
  const token = surface === "codex" ? `$${skillName}` : `/${skillName}`;
  return `${token} ${instruction}`;
};

export const G1_MATT_SKILL_CLOSURE = [
  "setup-matt-pocock-skills",
  "wayfinder",
  "implement",
  "tdd",
  "code-review",
] as const;

export const G1_CODEX_DISABLED_FEATURES = [
  "apps",
  "browser_use",
  "browser_use_external",
  "chronicle",
  "computer_use",
  "goals",
  "hooks",
  "image_generation",
  "memories",
  "plugin_sharing",
  "plugins",
  "skill_mcp_dependency_install",
  "tool_suggest",
  "workspace_dependencies",
] as const;

type Arguments = Readonly<{
  journey: G1LiveJourney;
  surface: G1LiveSurface;
  root: string;
  home: string;
  manifest: string;
  tarball: string;
  mattSkillsRoot: string;
  mattContractSource: string;
  codexHome?: string;
}>;

type FileDigest = Readonly<{ locator: string; sha256: string }>;

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const mustConsume = (values: string[], option: string): string => {
  const value = values.shift();
  if (value === undefined || value.length === 0) throw new Error(`${option} requires a value.`);
  return value;
};

const takeChoice = <const T extends readonly string[]>(
  value: string,
  choices: T,
  option: string,
): T[number] => {
  if (!choices.includes(value)) {
    throw new Error(`${option} must be one of: ${choices.join(", ")}.`);
  }
  return value as T[number];
};

const parseArguments = (argv: readonly string[]): Arguments => {
  const values = [...argv];
  const parsed: Partial<Record<string, string>> = {};
  while (values.length > 0) {
    const option = values.shift();
    if (option === undefined || !option.startsWith("--")) {
      throw new Error(`Unknown positional argument: ${option ?? ""}.`);
    }
    if (option === "--help") {
      process.stdout.write(`Usage:
  bun scripts/g1-live-fixture.ts \\
    --journey <L1-positive..L5-negative|L7-positive|L7-negative> \\
    --surface <codex|claude-code> \\
    --root <absolute-new-repository-path> \\
    --home <absolute-new-home-path> \\
    --manifest <absolute-new-manifest-path> \\
    --tarball <absolute-development-tarball-path> \\
    --matt-skills-root <absolute-.agents/skills-path> \\
    --matt-contract-source <absolute-reviewed-contract-path> \\
    [--codex-home <absolute-existing-codex-identity-home>]
`);
      process.exit(0);
    }
    if (parsed[option] !== undefined) throw new Error(`Duplicate option: ${option}.`);
    parsed[option] = mustConsume(values, option);
  }
  const required = [
    "--journey",
    "--surface",
    "--root",
    "--home",
    "--manifest",
    "--tarball",
    "--matt-skills-root",
    "--matt-contract-source",
  ] as const;
  for (const option of required) {
    if (parsed[option] === undefined) throw new Error(`Missing required option: ${option}.`);
  }
  const surface = takeChoice(parsed["--surface"] ?? "", G1_LIVE_SURFACES, "--surface");
  const codexHome = parsed["--codex-home"];
  if (surface === "codex" && codexHome === undefined) {
    throw new Error("--codex-home is required for the Codex execution lane.");
  }
  if (surface === "claude-code" && codexHome !== undefined) {
    throw new Error("--codex-home is only valid for the Codex execution lane.");
  }
  return {
    journey: takeChoice(parsed["--journey"] ?? "", G1_LIVE_JOURNEYS, "--journey"),
    surface,
    root: resolve(parsed["--root"] ?? ""),
    home: resolve(parsed["--home"] ?? ""),
    manifest: resolve(parsed["--manifest"] ?? ""),
    tarball: resolve(parsed["--tarball"] ?? ""),
    mattSkillsRoot: resolve(parsed["--matt-skills-root"] ?? ""),
    mattContractSource: resolve(parsed["--matt-contract-source"] ?? ""),
    ...(codexHome === undefined ? {} : { codexHome: resolve(codexHome) }),
  };
};

const assertAbsoluteInput = (input: string, label: string, original: string | undefined): void => {
  if (original === undefined || resolve(original) !== original) {
    throw new Error(`${label} must be an absolute path.`);
  }
  if (input === "/" || input === resolve(process.cwd())) {
    throw new Error(`${label} cannot target the filesystem or source repository root.`);
  }
};

const assertMissing = async (path: string, label: string): Promise<void> => {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists: ${path}`);
};

const assertRegularFile = async (path: string, label: string): Promise<void> => {
  const state = await lstat(path);
  if (!state.isFile() || state.nlink !== 1) {
    throw new Error(`${label} must be one single-link regular file: ${path}`);
  }
};

const assertDirectory = async (path: string, label: string): Promise<void> => {
  const state = await lstat(path);
  if (!state.isDirectory()) {
    throw new Error(`${label} must be a directory and not a symbolic link: ${path}`);
  }
};

const canonicalNewTarget = async (path: string): Promise<string> =>
  join(await realpath(dirname(path)), basename(path));

const sameOrDescendant = (candidate: string, boundary: string): boolean =>
  candidate === boundary || candidate.startsWith(`${boundary}${sep}`);

const assertIndependentTargets = async (
  targets: readonly Readonly<{ path: string; label: string }>[],
): Promise<void> => {
  const canonical = await Promise.all(
    targets.map(async (target) => ({ ...target, path: await canonicalNewTarget(target.path) })),
  );
  for (let left = 0; left < canonical.length; left += 1) {
    for (let right = left + 1; right < canonical.length; right += 1) {
      const first = canonical[left];
      const second = canonical[right];
      if (
        first !== undefined &&
        second !== undefined &&
        (sameOrDescendant(first.path, second.path) || sameOrDescendant(second.path, first.path))
      ) {
        throw new Error(`${first.label} and ${second.label} must be independent canonical paths.`);
      }
    }
  }
};

const assertTargetsOutsideBoundary = async (
  targets: readonly Readonly<{ path: string; label: string }>[],
  boundary: string,
  boundaryLabel: string,
): Promise<void> => {
  const canonicalBoundary = await realpath(boundary);
  for (const target of targets) {
    const canonicalTarget = await canonicalNewTarget(target.path);
    if (
      sameOrDescendant(canonicalTarget, canonicalBoundary) ||
      sameOrDescendant(canonicalBoundary, canonicalTarget)
    ) {
      throw new Error(`${target.label} and ${boundaryLabel} must be independent canonical paths.`);
    }
  }
};

const optionalRegularFile = async (path: string): Promise<Uint8Array | undefined> => {
  let state: Stats;
  try {
    state = await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (!state.isFile()) {
    throw new Error(`Codex operator input must be a regular file: ${path}`);
  }
  return readFile(path);
};

const discoverSkillFiles = async (
  root: string,
  directory = root,
  ancestors = new Set<string>(),
): Promise<string[]> => {
  let canonicalDirectory: string;
  try {
    canonicalDirectory = await realpath(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  if (ancestors.has(canonicalDirectory)) {
    throw new Error(`Codex operator skill inventory contains a directory cycle: ${directory}`);
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(canonicalDirectory);

  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverSkillFiles(root, target, nextAncestors)));
      continue;
    }
    if (entry.isSymbolicLink()) {
      const targetState = await lstat(await realpath(target));
      if (targetState.isDirectory()) {
        files.push(...(await discoverSkillFiles(root, target, nextAncestors)));
      }
      continue;
    }
    if (entry.isFile() && entry.name === "SKILL.md") files.push(target);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
};

export const inspectCodexOperatorContext = async (
  codexHome: string,
): Promise<
  Readonly<{
    globalInstructions: FileDigest | null;
    disabledSkills: readonly FileDigest[];
    fingerprint: string;
  }>
> => {
  let globalInstructions: FileDigest | null = null;
  for (const filename of ["AGENTS.override.md", "AGENTS.md"] as const) {
    const locator = join(codexHome, filename);
    const bytes = await optionalRegularFile(locator);
    if (bytes !== undefined && new TextDecoder().decode(bytes).trim() !== "") {
      globalInstructions = { locator, sha256: sha256(bytes) };
      break;
    }
  }
  const skillFiles = await discoverSkillFiles(join(codexHome, "skills"));
  const disabledSkills = await Promise.all(
    skillFiles.map(async (locator) => ({ locator, sha256: sha256(await readFile(locator)) })),
  );
  return {
    globalInstructions,
    disabledSkills,
    fingerprint: treeDigest([
      ...(globalInstructions === null ? [] : [globalInstructions]),
      ...disabledSkills,
    ]),
  };
};

const codexHardeningArguments = (disabledOperatorSkillPaths: readonly string[]): string[] => {
  const arguments_: string[] = [];
  for (const feature of G1_CODEX_DISABLED_FEATURES) {
    arguments_.push("--disable", feature);
  }
  if (disabledOperatorSkillPaths.length > 0) {
    const config = disabledOperatorSkillPaths
      .map((path) => `{path=${JSON.stringify(path)},enabled=false}`)
      .join(",");
    arguments_.push("-c", `skills.config=[${config}]`);
  }
  return arguments_;
};

const codexApprovalArguments = [
  "-c",
  'approval_policy="on-request"',
  "-c",
  'approvals_reviewer="auto_review"',
] as const;

export const surfaceLaunchContract = (
  input: Readonly<{
    surface: G1LiveSurface;
    repositoryRoot: string;
    isolatedHome: string;
    codexHome?: string;
    disabledOperatorSkillPaths?: readonly string[];
  }>,
):
  | Readonly<{
      mode: "codex-exec";
      codexHome: string;
      environment: Readonly<{ HOME: string; CODEX_HOME: string }>;
      initial: Readonly<{
        program: "codex";
        arguments: readonly string[];
        appendPromptAsFinalArgument: true;
      }>;
      resume: Readonly<{
        program: "codex";
        arguments: readonly string[];
        appendPromptAsFinalArgument: true;
      }>;
    }>
  | Readonly<{
      mode: "claude-interactive";
      codexHome: null;
      environment: Readonly<{ HOME: string }>;
      initial: Readonly<{
        program: "claude";
        arguments: readonly string[];
        workingDirectory: string;
      }>;
      resume: null;
    }> => {
  if (input.surface === "claude-code") {
    if (input.codexHome !== undefined || input.disabledOperatorSkillPaths !== undefined) {
      throw new Error("Claude Code launch cannot use a Codex identity home.");
    }
    return {
      mode: "claude-interactive",
      codexHome: null,
      environment: { HOME: input.isolatedHome },
      initial: {
        program: "claude",
        arguments: [],
        workingDirectory: input.repositoryRoot,
      },
      resume: null,
    };
  }
  if (input.codexHome === undefined) {
    throw new Error("Codex launch requires an explicit identity home.");
  }
  if (input.disabledOperatorSkillPaths === undefined) {
    throw new Error("Codex launch requires the complete disabled operator skill inventory.");
  }
  const hardening = codexHardeningArguments(input.disabledOperatorSkillPaths);
  return {
    mode: "codex-exec",
    codexHome: input.codexHome,
    environment: { HOME: input.isolatedHome, CODEX_HOME: input.codexHome },
    initial: {
      program: "codex",
      arguments: [
        "exec",
        ...codexE2ERuntimeArguments(),
        "--ignore-user-config",
        "--ignore-rules",
        ...codexApprovalArguments,
        "--sandbox",
        "workspace-write",
        "--add-dir",
        input.isolatedHome,
        "--cd",
        input.repositoryRoot,
        "--json",
        ...hardening,
      ],
      appendPromptAsFinalArgument: true,
    },
    resume: {
      program: "codex",
      arguments: [
        "exec",
        "resume",
        ...codexE2ERuntimeArguments(),
        "--ignore-user-config",
        "--ignore-rules",
        ...codexApprovalArguments,
        "-c",
        'sandbox_mode="workspace-write"',
        "-c",
        `sandbox_workspace_write.writable_roots=[${JSON.stringify(input.isolatedHome)}]`,
        "--json",
        ...hardening,
        "<session-id>",
      ],
      appendPromptAsFinalArgument: true,
    },
  };
};

const writeFixture = async (
  root: string,
  locator: string,
  content: string | Uint8Array,
): Promise<void> => {
  const target = join(root, locator);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
};

const run = async (
  command: readonly string[],
  options: Readonly<{
    cwd?: string;
    home?: string;
    env?: Readonly<Record<string, string>>;
  }> = {},
): Promise<string> => {
  const child = Bun.spawn([...command], {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...(options.home === undefined ? {} : { HOME: options.home }),
      ...options.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode}): ${command.join(" ")}\n${stderr.trim()}\n${stdout.trim()}`,
    );
  }
  return stdout;
};

const listFiles = async (root: string, directory = root): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, target)));
    } else if (entry.isFile()) {
      files.push(relative(root, target));
    } else {
      throw new Error(`Fixture inventories refuse non-file entries: ${target}`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
};

const fileDigests = async (root: string): Promise<readonly FileDigest[]> =>
  Promise.all(
    (await listFiles(root)).map(async (locator) => ({
      locator,
      sha256: sha256(await readFile(join(root, locator))),
    })),
  );

const treeDigest = (files: readonly FileDigest[]): string =>
  sha256(files.map((file) => `${file.locator}\0${file.sha256}\n`).join(""));

export const finalizeFixtureSnapshot = async (
  root: string,
): Promise<Readonly<{ sha256: string; files: readonly FileDigest[] }>> => {
  const files = await fileDigests(root);
  return { sha256: treeDigest(files), files };
};

const surfaceContract = (
  surface: G1LiveSurface,
): Readonly<{ cli: "agent-skills" | "claude"; instruction: "AGENTS.md" | "CLAUDE.md" }> =>
  surface === "codex"
    ? { cli: "agent-skills", instruction: "AGENTS.md" }
    : { cli: "claude", instruction: "CLAUDE.md" };

export const repositoryConfigurationActivationArguments = (
  surface: G1LiveSurface,
  repositoryRoot: string,
): readonly string[] => [
  "--intent",
  "activate",
  "--repo",
  repositoryRoot,
  "--surface",
  surfaceContract(surface).cli,
  "--provider-contract",
  "docs/agents/issue-tracker.md",
  "--executor-mode",
  "skip",
];

export const instructionBytes = (contractLocator: string | undefined): string => `# G1 Fixture

Use Chinese for user-visible conversation and newly authored human-reviewed planning artifacts.
Keep agent-facing skills and normative contracts in English.
${
  contractLocator === undefined
    ? ""
    : `\n## Agent skills\n\n### Issue tracker\n\nWork-management contract: \`${contractLocator}\`\n`
}`;

export const driftManagedPointer = (current: string): string => {
  if (!current.includes(BEARING_POINTER)) {
    throw new Error("Cannot inject managed pointer drift because the current pointer is absent.");
  }
  const drifted = current.replace(BEARING_POINTER, `DRIFTED: ${BEARING_POINTER}`);
  if (drifted === current) {
    throw new Error("Managed pointer drift injection did not change the instruction bytes.");
  }
  return drifted;
};

const manifestDocument = (surface: "agent-skills" | "claude", packageVersion = "0.1.0"): string =>
  `${JSON.stringify(
    {
      schemaVersion: 1,
      packageVersion,
      surfaces: [surface],
      executorProfiles: ["generic-agent"],
    },
    null,
    2,
  )}\n`;

const projectSummary = `---
Type: project-summary
ID: project-summary:current
Title: G1 Fixture
---

# Project Summary: G1 Fixture

## Purpose

Validate one isolated live journey.

## Current Design

One local Markdown work scope.

## Boundaries

- Keep native work native.

## Future Candidates

- None.

## Material Revisions

- None.
`;

const roadmapIndex = `---
Type: roadmap-index
Roadmaps:
  - roadmap:g1-fixture
---

# Roadmap Index
`;

const roadmap = `---
Type: roadmap
ID: roadmap:g1-fixture
Title: G1 Fixture Roadmap
Status: active
Focused gate: gate:g1-fixture
Gate order:
  - gate:g1-fixture
---

# Roadmap: G1 Fixture

## Intent

Validate one live journey.
`;

const gate = `---
Type: milestone-gate
ID: gate:g1-fixture
Title: G1 Fixture Gate
Roadmap: roadmap:g1-fixture
Status: active
Effort order:
  - effort:g1-fixture
Citations: []
---

# Milestone Gate: G1 Fixture

## Intent

Reach the named validation boundary.

## Exit Criteria

- The named live journey has direct evidence.
`;

const effort = `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:g1-fixture
Title: G1 Fixture Effort
Roadmap: roadmap:g1-fixture
Target gate: gate:g1-fixture
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/work
---

# Effort: G1 Fixture

## Intent

Exercise bound native work without lifecycle takeover.

## Work

- [Map](map.md)
`;

const nativeMap = `# Wayfinder Map: G1 Fixture

Status: resolved

## Destination

Validate the isolated journey.

## Not yet specified
`;

const nativeSpec = `# G1 Fixture Spec

Status: ready-for-agent

## Problem Statement

Exercise one isolated Agent behavior contract.

## Solution

Use the packaged public Skill in a controlled repository.

## User Stories

An evaluator can observe authority and tool effects.

## Implementation Decisions

Keep native work in the local tracker.

## Testing Decisions

Run the repository test command.

## Out of Scope

Do not infer Gate Passage.

## Further Notes

The fixture is disposable.
`;

const openTicket = (ordinal: string, title: string, body: string): string => `# ${title}

**What to build:** ${body}

Blocked by: None — can start immediately

Status: ready-for-agent

- [ ] Run the repository test command.
- [ ] Commit only the ticket's owned change.

Ticket identity: ${ordinal}
`;

const seedPlanning = async (
  root: string,
  options: Readonly<{ l7?: boolean }> = {},
): Promise<void> => {
  await writeFixture(root, ".bearing/state/project-summary.md", projectSummary);
  await writeFixture(root, ".bearing/state/roadmap-index.md", roadmapIndex);
  await writeFixture(root, ".bearing/state/roadmaps/g1-fixture.md", roadmap);
  await writeFixture(root, ".bearing/state/milestone-gates/g1-fixture.md", gate);
  await writeFixture(root, ".bearing/state/efforts/g1-fixture.md", effort);
  await writeFixture(root, ".scratch/work/map.md", nativeMap);
  await writeFixture(root, ".scratch/work/PRD.md", nativeSpec);
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
  if (!options.l7) {
    await writeFixture(
      root,
      ".scratch/work/issues/01-next-action.md",
      openTicket(
        "01-next-action",
        "Take the next fixture action",
        "Append one line to source.txt.",
      ),
    );
    return;
  }
  await writeFixture(
    root,
    ".scratch/work/issues/01-add-alpha.md",
    openTicket(
      "01-add-alpha",
      "Add alpha capability",
      "Create src/alpha.ts exporting alpha() with the value alpha, and add a focused test for that contract.",
    ),
  );
  await writeFixture(
    root,
    ".scratch/work/issues/02-add-beta.md",
    openTicket(
      "02-add-beta",
      "Add beta capability",
      "Create src/beta.ts exporting beta() with the value beta, and add a focused test for that contract.",
    ),
  );
  await writeFixture(
    root,
    ".scratch/unbound/map.md",
    "# Wayfinder Map: Unbound Feature\n\nType: wayfinder:map\nStatus: resolved\n\n## Destination\n\nKeep valid native work unbound.\n\n## Not yet specified\n",
  );
  await writeFixture(
    root,
    ".scratch/unbound/issues/01-discuss.md",
    openTicket("unbound-01", "Discuss unbound feature", "Describe the feature without binding it."),
  );
  await writeFixture(
    root,
    ".scratch/work/evidence/pending.md",
    "# Durable pending output\n\nThis artifact has not been registered.\n",
  );
  await writeFixture(
    root,
    ".scratch/work/issues/00-language-decision.md",
    "# Choose fixture wording\n\nType: task\n\nBlocked by: None — can start immediately\n\nStatus: claimed\n\n## Question\n\nShould the human-reviewed resolution be Chinese?\n",
  );
  await writeFixture(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: "g1-live-fixture",
        private: true,
        type: "module",
        scripts: { test: "bun test" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFixture(
    root,
    "tests/baseline.test.ts",
    'import { expect, test } from "bun:test";\ntest("baseline", () => expect(true).toBe(true));\n',
  );
};

const seedL7Negative = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".scratch/work/issues/10-ambiguous-one.md",
    openTicket(
      "10-ambiguous-one",
      "Implement ambiguous change",
      "Append the word one to source.txt.",
    ),
  );
  await writeFixture(
    root,
    ".scratch/work/issues/11-ambiguous-two.md",
    openTicket(
      "11-ambiguous-two",
      "Implement ambiguous change",
      "Append the word two to source.txt.",
    ),
  );
  await writeFixture(
    root,
    ".scratch/work/issues/12-execution-failure.md",
    `# Prove execution failure

Type: task
Status: open

## What to build

Create src/failure.ts, then run \`bun run test:ticket-12\`.

## Acceptance

- \`bun run test:ticket-12\` passes.
- Do not alter the test command or its fixed failing test.
`,
  );
  await writeFixture(
    root,
    ".scratch/work/issues/13-incomplete-acceptance.md",
    `# Prove incomplete acceptance

Type: task
Status: open

## What to build

Create src/incomplete.ts.

## Acceptance

- Repository tests pass.
- The user-owned file \`.fixture-acceptance/user-approved\` already exists.
`,
  );
  const packagePath = join(root, "package.json");
  const metadata = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
  await writeFixture(
    root,
    "package.json",
    `${JSON.stringify(
      {
        ...metadata,
        scripts: {
          test: "bun test",
          "test:ticket-12": "bun tests/fixed-ticket-12-failure.ts",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFixture(
    root,
    "tests/fixed-ticket-12-failure.ts",
    'throw new Error("fixed G1 execution-failure fixture");\n',
  );
};

const seedLegacy = async (
  root: string,
  surface: "agent-skills" | "claude",
  instruction: "AGENTS.md" | "CLAUDE.md",
  contractSource: Uint8Array,
): Promise<void> => {
  await writeFixture(root, ".bearing/manifest.json", manifestDocument(surface));
  await writeFixture(root, ".bearing/executor-profiles/generic-agent.md", "# Generic legacy\n");
  await writeFixture(root, ".bearing/state/project-summary.md", projectSummary);
  await writeFixture(root, ".bearing/state/roadmap-index.md", roadmapIndex);
  await writeFixture(root, ".bearing/state/roadmaps/g1-fixture.md", roadmap);
  await writeFixture(root, ".bearing/state/milestone-gates/g1-fixture.md", gate);
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:g1-legacy-output
    Title: G1 Legacy Output
    Purpose: Preserve the durable fixture output.
    Kind: reference
    Source: .scratch/work/evidence/legacy.md
    Owner: effort:g1-fixture
    Added at: 2026-08-01T00:00:00Z
    Disposition: active
---

# Asset Registry
`,
  );
  await writeFixture(
    root,
    ".scratch/work/effort.md",
    effort.replace(
      "Work binding:\n  Provider: matt-skills/v1\n  Driver: local-markdown\n  Native scope: .scratch/work\n",
      "",
    ),
  );
  await writeFixture(root, ".scratch/work/map.md", nativeMap);
  await writeFixture(
    root,
    ".scratch/work/issues/01-next-action.md",
    openTicket("01-next-action", "Take the next fixture action", "Preserve this ticket."),
  );
  await writeFixture(root, ".scratch/work/evidence/legacy.md", "# Legacy durable output\n");
  await writeFixture(root, "docs/agents/issue-tracker.md", contractSource);
  await writeFixture(
    root,
    instruction,
    `# G1 Legacy Fixture

Work-management contract: \`docs/agents/issue-tracker.md\`

<!-- bearing:managed-start -->
For every project request, load and follow the global \`bearing\` skill as the governing runbook.
<!-- bearing:managed-end -->
`,
  );
  await writeFixture(root, ".bearing/cache/stale.txt", "discard me\n");
};

const installExternalSkills = async (
  args: Arguments,
): Promise<Readonly<Record<string, Readonly<{ sha256: string; files: number }>>>> => {
  const targetRoot =
    args.surface === "codex"
      ? join(args.home, ".agents/skills")
      : join(args.home, ".claude/skills");
  const identities: Record<string, Readonly<{ sha256: string; files: number }>> = {};
  for (const skill of G1_MATT_SKILL_CLOSURE) {
    const source = join(args.mattSkillsRoot, skill);
    const sourceState = await lstat(source);
    if (!sourceState.isDirectory()) throw new Error(`Matt skill is not a directory: ${source}`);
    const sourceFiles = await fileDigests(source);
    identities[skill] = { sha256: treeDigest(sourceFiles), files: sourceFiles.length };
    await mkdir(targetRoot, { recursive: true });
    await cp(source, join(targetRoot, skill), {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
    });
  }
  return identities;
};

const installDevelopmentPackage = async (args: Arguments): Promise<void> => {
  const surface = surfaceContract(args.surface);
  await run(
    [
      "npm",
      "exec",
      "--yes",
      `--package=${args.tarball}`,
      "--",
      "bearing",
      "install",
      "--surface",
      surface.cli,
    ],
    { home: args.home },
  );
};

const setupActiveRepository = async (args: Arguments): Promise<void> => {
  const bearing = join(args.home, ".bearing/bin/bearing");
  const selections = repositoryConfigurationActivationArguments(args.surface, args.root);
  await run([bearing, "configure", "inspect", "--repo", args.root], { home: args.home });
  const planned = JSON.parse(
    await run([bearing, "configure", "plan", ...selections], { home: args.home }),
  ) as Readonly<{ sealedPlanToken?: unknown }>;
  if (typeof planned.sealedPlanToken !== "string") {
    throw new Error("Fresh G1 fixture Configure Plan did not return a sealed plan token.");
  }
  await run(
    [bearing, "configure", "apply", ...selections, "--plan-token", planned.sealedPlanToken],
    { home: args.home },
  );
};

const requiresActiveSetup = (journey: G1LiveJourney): boolean =>
  journey.startsWith("L1-") || journey.startsWith("L4-") || journey.startsWith("L7-");

const createFixture = async (args: Arguments): Promise<void> => {
  const original = process.argv.slice(2);
  const originalValue = (option: string): string | undefined => {
    const index = original.indexOf(option);
    return index < 0 ? undefined : original[index + 1];
  };
  assertAbsoluteInput(args.root, "--root", originalValue("--root"));
  assertAbsoluteInput(args.home, "--home", originalValue("--home"));
  assertAbsoluteInput(args.manifest, "--manifest", originalValue("--manifest"));
  assertAbsoluteInput(args.tarball, "--tarball", originalValue("--tarball"));
  assertAbsoluteInput(
    args.mattSkillsRoot,
    "--matt-skills-root",
    originalValue("--matt-skills-root"),
  );
  assertAbsoluteInput(
    args.mattContractSource,
    "--matt-contract-source",
    originalValue("--matt-contract-source"),
  );
  if (args.codexHome !== undefined) {
    assertAbsoluteInput(args.codexHome, "--codex-home", originalValue("--codex-home"));
  }
  const prerequisiteSource = args.journey.startsWith("L3-")
    ? `${args.root}.matt-prerequisite.md`
    : undefined;
  const generatedTargets = [
    { path: args.root, label: "Repository root" },
    { path: args.home, label: "Isolated home" },
    { path: args.manifest, label: "Fixture manifest" },
    ...(prerequisiteSource === undefined
      ? []
      : [{ path: prerequisiteSource, label: "Matt prerequisite source" }]),
  ];
  await assertIndependentTargets(generatedTargets);
  if (args.codexHome !== undefined) {
    await assertTargetsOutsideBoundary(generatedTargets, args.codexHome, "Codex identity home");
  }
  await Promise.all([
    ...generatedTargets.map((target) => assertMissing(target.path, target.label)),
    assertRegularFile(args.tarball, "Development tarball"),
    assertRegularFile(args.mattContractSource, "Reviewed Matt contract source"),
    ...(args.codexHome === undefined
      ? []
      : [assertDirectory(args.codexHome, "Codex identity home")]),
  ]);

  await Promise.all([
    mkdir(args.root, { recursive: false }),
    mkdir(args.home, { recursive: false }),
  ]);
  const surface = surfaceContract(args.surface);
  const contractBytes = await readFile(args.mattContractSource);
  const triageLabelsSource = join(dirname(args.mattContractSource), "triage-labels.md");
  const triageLabelsBytes = await readFile(triageLabelsSource);
  await writeFixture(args.root, "source.txt", "G1 fixture source\n");

  const l3 = args.journey.startsWith("L3-");
  if (args.journey.startsWith("L5-")) {
    await seedLegacy(args.root, surface.cli, surface.instruction, contractBytes);
  } else {
    await writeFixture(
      args.root,
      surface.instruction,
      instructionBytes(l3 ? undefined : "docs/agents/issue-tracker.md"),
    );
    if (!l3) {
      await writeFixture(args.root, "docs/agents/issue-tracker.md", contractBytes);
      await writeFixture(args.root, "docs/agents/triage-labels.md", triageLabelsBytes);
    }
  }

  const mattSkills = await installExternalSkills(args);
  await installDevelopmentPackage(args);
  if (requiresActiveSetup(args.journey)) await setupActiveRepository(args);

  if (args.journey.startsWith("L1-")) {
    await seedPlanning(args.root);
  } else if (args.journey.startsWith("L4-") && args.journey.endsWith("-negative")) {
    const instructionPath = join(args.root, surface.instruction);
    const current = await readFile(instructionPath, "utf8");
    await writeFile(instructionPath, driftManagedPointer(current));
  } else if (args.journey.startsWith("L5-") && args.journey.endsWith("-negative")) {
    await writeFixture(
      args.root,
      ".bearing/executor-profiles/unregistered-extra.md",
      "# Unregistered unsafe legacy profile\n",
    );
  } else if (args.journey.startsWith("L7-")) {
    await seedPlanning(args.root, { l7: true });
    if (args.journey.endsWith("-negative")) await seedL7Negative(args.root);
  }

  if (prerequisiteSource !== undefined) {
    await writeFile(prerequisiteSource, contractBytes);
  }

  const bearingCli = join(args.home, ".bearing/bin/bearing");
  let initialReadModel: unknown;
  if (requiresActiveSetup(args.journey)) {
    await run([bearingCli, "cache", "rebuild", "--repo", args.root], { home: args.home });
    await run([bearingCli, "provider", "verify", "--all", "--repo", args.root], {
      home: args.home,
    });
    const output = await run([bearingCli, "inspect", "project", "--repo", args.root], {
      home: args.home,
    });
    const inspection = JSON.parse(output) as {
      outcome?: string;
      generation?: { basisFingerprint?: string };
      result?: { diagnosticCounts?: { blocking?: number; nonBlocking?: number } };
    };
    const fingerprint = inspection.generation?.basisFingerprint;
    const diagnosticCounts = inspection.result?.diagnosticCounts;
    if (
      inspection.outcome !== "complete" ||
      fingerprint === undefined ||
      diagnosticCounts?.blocking !== 0 ||
      diagnosticCounts.nonBlocking !== 0
    ) {
      throw new Error(`Active fixture must begin with zero Project Read Model diagnostics.`);
    }
    initialReadModel = { fingerprint, diagnosticCounts, output };
  }

  const fixture = await finalizeFixtureSnapshot(args.root);
  await run(["git", "init", "-q"], { cwd: args.root });
  await run(["git", "config", "user.name", "G1 Fixture"], { cwd: args.root });
  await run(["git", "config", "user.email", "g1-fixture@example.invalid"], { cwd: args.root });
  await run(["git", "add", "-A"], { cwd: args.root });
  await run(["git", "commit", "-qm", `fixture: ${G1_LIVE_PLAN_ID}`], {
    cwd: args.root,
    env: {
      GIT_AUTHOR_DATE: "2026-07-26T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-26T00:00:00Z",
    },
  });
  const sourceCommit = (await run(["git", "rev-parse", "HEAD"], { cwd: args.root })).trim();
  const status = await run(["git", "status", "--short"], { cwd: args.root });
  if (status !== "") throw new Error(`Fixture repository must start clean: ${status}`);

  const tarballRealpath = await realpath(args.tarball);
  const codexOperatorContext =
    args.codexHome === undefined
      ? null
      : await inspectCodexOperatorContext(await realpath(args.codexHome));
  const manifest = {
    schemaVersion: 1,
    planId: G1_LIVE_PLAN_ID,
    journey: args.journey,
    surface: args.surface,
    repositoryRoot: args.root,
    isolatedHome: args.home,
    sourceCommit,
    cleanSource: true,
    fixture,
    developmentTarball: {
      path: tarballRealpath,
      file: basename(tarballRealpath),
      sha256: sha256(await readFile(tarballRealpath)),
    },
    mattContracts: {
      skillsRoot: await realpath(args.mattSkillsRoot),
      skills: mattSkills,
      providerSource: {
        path: await realpath(args.mattContractSource),
        sha256: sha256(contractBytes),
      },
      prerequisiteSource:
        prerequisiteSource === undefined
          ? null
          : { path: prerequisiteSource, sha256: sha256(await readFile(prerequisiteSource)) },
    },
    installedBearingCli: bearingCli,
    instructionFile: surface.instruction,
    initialReadModel: initialReadModel ?? null,
    codexOperatorContext,
    launch: surfaceLaunchContract({
      surface: args.surface,
      repositoryRoot: args.root,
      isolatedHome: args.home,
      ...(args.codexHome === undefined ? {} : { codexHome: await realpath(args.codexHome) }),
      ...(codexOperatorContext === null
        ? {}
        : {
            disabledOperatorSkillPaths: codexOperatorContext.disabledSkills.map(
              (skill) => skill.locator,
            ),
          }),
    }),
  };
  await mkdir(dirname(args.manifest), { recursive: true });
  await writeFile(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
};

if (import.meta.main) {
  try {
    await createFixture(parseArguments(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
