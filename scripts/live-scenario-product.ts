import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { BEARING_POINTER, withoutBearingManagedPointer } from "../src/agent-surface-entry";
import { type LiveScenario, liveScenarioSkillIsInstalled } from "./live-scenario-registry";

const fail = (message: string): never => {
  throw new Error(message);
};

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const staysInside = (root: string, path: string): boolean => {
  const relation = relative(root, path);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
};

export const materializeDeclaredPrerequisiteSkills = async (input: {
  scenario: LiveScenario;
  trustedSkillRoot: string;
  targetSkillRoot: string;
}): Promise<readonly string[]> => {
  if (!isAbsolute(input.trustedSkillRoot) || !isAbsolute(input.targetSkillRoot)) {
    fail("Live Scenario Skill roots must be explicit absolute paths.");
  }
  const trustedSkillRoot = await realpath(input.trustedSkillRoot);
  const targetSkillRoot = await realpath(input.targetSkillRoot);
  const materialized: string[] = [];

  for (const { skill, role } of input.scenario.fixedValidationFixture.skills) {
    if (skill === "bearing" || !liveScenarioSkillIsInstalled(role)) continue;
    const declaredSource = join(trustedSkillRoot, skill);
    let source: string;
    try {
      source = await realpath(declaredSource);
    } catch (error) {
      if (isMissing(error)) fail(`Declared prerequisite Skill is unavailable: ${skill}.`);
      throw error;
    }
    if (!staysInside(trustedSkillRoot, source)) {
      fail(`Declared prerequisite Skill escapes the trusted root: ${skill}.`);
    }
    const entrypoint = await lstat(join(source, "SKILL.md")).catch((error: unknown) => {
      if (isMissing(error)) fail(`Declared prerequisite Skill has no SKILL.md: ${skill}.`);
      throw error;
    });
    if (!entrypoint.isFile()) {
      fail(`Declared prerequisite Skill entrypoint must be a regular file: ${skill}.`);
    }
    const target = join(targetSkillRoot, skill);
    try {
      await lstat(target);
      fail(`Declared prerequisite Skill target already exists: ${skill}.`);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
    materialized.push(skill);
  }

  return Object.freeze(materialized);
};

const execute = async (
  command: readonly string[],
  options: Readonly<{
    cwd: string;
    home: string;
    environment?: Readonly<Record<string, string>>;
  }>,
) => {
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.environment,
      HOME: options.home,
      BEARING_PORT: "1",
      npm_config_cache: join(options.home, "npm-cache"),
      npm_config_loglevel: "error",
      npm_config_update_notifier: "false",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const developmentRuntimeManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    runtimeContractVersion: z.literal(2),
    channel: z.literal("development"),
    packageVersion: z.string().min(1),
    builtFrom: z.object({
      gitHead: z.string().regex(/^[0-9a-f]{40}$/u),
      dirty: z.boolean(),
    }),
    buildIdentity: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .strict();

const run = async (
  command: readonly string[],
  options: Readonly<{ cwd: string; home: string; environment?: Readonly<Record<string, string>> }>,
) => {
  const { environment, ...executionOptions } = options;
  const { exitCode, stdout, stderr } = await execute(command, {
    ...executionOptions,
    ...(environment === undefined ? {} : { environment }),
  });
  if (exitCode !== 0) fail(stderr.trim() || stdout.trim() || `${command[0]} failed.`);
  return stdout;
};

const git = (root: string, args: readonly string[]): string => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    fail(result.stderr.toString().trim() || `git ${args.join(" ")} failed.`);
  }
  return result.stdout.toString().trim();
};

const commitBaseline = (root: string, message: string): void => {
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.name=Bearing Live Matrix",
    "-c",
    "user.email=live-matrix@example.invalid",
    "commit",
    "-qm",
    message,
  ]);
};

export const installLiveScenarioProduct = async (input: {
  tarball: string;
  installRoot: string;
  agentHome: string;
  installGlobalKit?: boolean;
}): Promise<string> => {
  await mkdir(input.installRoot, { recursive: true });
  await run(
    [
      "npm",
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      input.installRoot,
      input.tarball,
    ],
    { cwd: input.installRoot, home: input.agentHome },
  );
  const program = join(input.installRoot, "node_modules/.bin/bearing");
  if (input.installGlobalKit === false) return program;
  await run([program, "install"], { cwd: input.installRoot, home: input.agentHome });
  const skillTarget = join(input.agentHome, ".bearing/kit/current/skills/bearing");
  const skillEntry = join(input.agentHome, "skill-directory/bearing");
  await symlink(relative(join(input.agentHome, "skill-directory"), skillTarget), skillEntry);
  return program;
};

const activate = async (input: {
  repositoryRoot: string;
  productProgram: string;
  agentHome: string;
  runtime?: "development";
}): Promise<void> => {
  const args = [
    "--intent",
    "activate",
    "--repo",
    input.repositoryRoot,
    "--surface",
    "agent-skills",
    "--provider-contract",
    "docs/agents/issue-tracker.md",
    "--executor-mode",
    "skip",
    ...(input.runtime === undefined ? [] : ["--runtime", input.runtime]),
  ];
  const planned = z.object({ canApply: z.literal(true), sealedPlanToken: z.string().min(1) }).parse(
    JSON.parse(
      await run([input.productProgram, "configure", "plan", ...args], {
        cwd: input.repositoryRoot,
        home: input.agentHome,
      }),
    ),
  );
  await run(
    [input.productProgram, "configure", "apply", ...args, "--plan-token", planned.sealedPlanToken],
    { cwd: input.repositoryRoot, home: input.agentHome },
  );
};

const materializeDevelopmentRepositoryUpdateSource = async (input: {
  sourceRoot: string;
  fixtureRoot: string;
  repositoryRoot: string;
  productProgram: string;
  agentHome: string;
}): Promise<void> => {
  for (const entry of await readdir(input.repositoryRoot, { withFileTypes: true })) {
    if (entry.name !== ".git") {
      await rm(join(input.repositoryRoot, entry.name), { recursive: true, force: true });
    }
  }
  for (const locator of [
    ".gitignore",
    "index.html",
    "package-lock.json",
    "package.json",
    "scripts/build.ts",
    "scripts/bundle-dependency-boundary.ts",
    "scripts/dependency-license-overrides.ts",
    "skills/bearing",
    "skills/bearing-dev",
    "src",
    "tsconfig.json",
    "vite.config.ts",
  ]) {
    const target = join(input.repositoryRoot, locator);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(input.sourceRoot, locator), target, {
      recursive: true,
      force: true,
    });
  }
  for (const locator of [".scratch", "AGENTS.md", "CONTEXT.md", "docs/agents"]) {
    const target = join(input.repositoryRoot, locator);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(input.fixtureRoot, locator), target, { recursive: true, force: true });
  }
  await mkdir(join(input.repositoryRoot, ".agents/skills"), { recursive: true });
  await symlink(
    "../../skills/bearing-dev",
    join(input.repositoryRoot, ".agents/skills/bearing-dev"),
  );
  commitBaseline(input.repositoryRoot, "Prepare current Development source baseline");

  await cp(join(input.sourceRoot, "dist"), join(input.repositoryRoot, "dist"), {
    recursive: true,
    force: true,
  });
  const runtimeManifestPath = join(input.repositoryRoot, "dist/development-runtime.json");
  const runtimeManifest = developmentRuntimeManifestSchema.parse(
    JSON.parse(await readFile(runtimeManifestPath, "utf8")),
  );

  await activate({ ...input, runtime: "development" });
  if (git(input.repositoryRoot, ["status", "--porcelain=v1"]).length > 0) {
    commitBaseline(input.repositoryRoot, "Apply Development configuration baseline");
  }
  const sourceProvenance = {
    gitHead: git(input.repositoryRoot, ["rev-parse", "HEAD"]),
    dirty: git(input.repositoryRoot, ["status", "--porcelain=v1"]).length > 0,
  };
  await writeFile(
    runtimeManifestPath,
    `${JSON.stringify(
      {
        ...runtimeManifest,
        builtFrom: sourceProvenance,
      },
      null,
      2,
    )}\n`,
  );
  const bootstrap = JSON.parse(
    await run(
      [
        join(input.repositoryRoot, "dist/cli.js"),
        "runtime",
        "bootstrap",
        "--repo",
        input.repositoryRoot,
      ],
      { cwd: input.repositoryRoot, home: input.agentHome },
    ),
  ) as Readonly<{ outcome?: unknown }>;
  if (bootstrap.outcome !== "applied" && bootstrap.outcome !== "no-op") {
    fail("Active configuration repair did not complete Development Runtime bootstrap.");
  }

  const manifestPath = join(input.repositoryRoot, ".bearing/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  if (manifest["packageVersion"] !== "0.1.2-dev" || manifest["runtime"] !== "development") {
    fail("Active configuration repair did not establish the target Development Configuration.");
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, schemaVersion: 1, packageVersion: "0.1.1" }, null, 2)}\n`,
  );
  const inspected = JSON.parse(
    await run(
      [
        join(input.repositoryRoot, "dist/cli.js"),
        "runtime",
        "inspect",
        "--repo",
        input.repositoryRoot,
      ],
      { cwd: input.repositoryRoot, home: input.agentHome },
    ),
  ) as Readonly<{
    outcome?: unknown;
    context?: Readonly<{ receipt?: Readonly<{ channel?: unknown }> }>;
  }>;
  if (inspected.outcome !== "resolved" || inspected.context?.receipt?.channel !== "development") {
    fail("Active configuration repair returned an incoherent Development Runtime receipt.");
  }
};

const installPlanningState = async (input: {
  sourceRoot: string;
  repositoryRoot: string;
  effortMode: "bound" | "absent" | "planned-unbound";
  productProgram: string;
  agentHome: string;
  nativeScope?: string;
  githubToken?: string;
}): Promise<void> => {
  const baseline = join(input.sourceRoot, "validation/live-journey/fixtures/planning-state");
  await rm(join(input.repositoryRoot, ".bearing/state"), { recursive: true, force: true });
  await cp(baseline, join(input.repositoryRoot, ".bearing/state"), {
    recursive: true,
    force: true,
  });
  const effortPath = join(input.repositoryRoot, ".bearing/state/efforts/label-delivery.md");
  if (input.effortMode === "absent") {
    await rm(effortPath, { force: true });
    const gatePath = join(
      input.repositoryRoot,
      ".bearing/state/milestone-gates/stable-label-output.md",
    );
    const gate = await readFile(gatePath, "utf8");
    await writeFile(
      gatePath,
      gate.replace("Effort order:\n  - effort:label-delivery", "Effort order: []"),
    );
  } else if (input.effortMode === "planned-unbound") {
    const effort = await readFile(effortPath, "utf8");
    await writeFile(
      effortPath,
      effort
        .replace("Lifecycle: active", "Lifecycle: planned")
        .replace(/^Activated at: .*\n/mu, "")
        .replace(
          /Work binding:\n {2}Provider: matt-skills\/v1\n {2}Native scope: \.scratch\/label-delivery\n/u,
          "",
        ),
    );
  } else if (input.nativeScope !== undefined) {
    const effort = await readFile(effortPath, "utf8");
    await writeFile(
      effortPath,
      effort.replace("Native scope: .scratch/label-delivery", `Native scope: ${input.nativeScope}`),
    );
  }
  await run([input.productProgram, "cache", "rebuild", "--repo", input.repositoryRoot], {
    cwd: input.repositoryRoot,
    home: input.agentHome,
  });
  if (input.effortMode === "bound") {
    const capture = z
      .object({
        command: z.literal("provider-capture"),
        outcome: z.literal("complete"),
        result: z.object({
          scopes: z.array(
            z.object({
              scope: z.string().min(1),
              disposition: z.literal("captured"),
            }),
          ),
        }),
      })
      .parse(
        JSON.parse(
          await run(
            [
              input.productProgram,
              "provider",
              "capture",
              "--scope",
              input.nativeScope ?? ".scratch/label-delivery",
              "--repo",
              input.repositoryRoot,
            ],
            {
              cwd: input.repositoryRoot,
              home: input.agentHome,
              ...(input.githubToken === undefined
                ? {}
                : { environment: { GH_TOKEN: input.githubToken } }),
            },
          ),
        ),
      );
    const expectedScope = input.nativeScope ?? ".scratch/label-delivery";
    if (capture.result.scopes.length !== 1 || capture.result.scopes[0]?.scope !== expectedScope) {
      fail("Live Scenario provider baseline did not capture the exact Work Binding scope.");
    }
  }
};

export const materializeGitHubLiveScenarioPlanningState = async (input: {
  sourceRoot: string;
  repositoryRoot: string;
  productProgram: string;
  agentHome: string;
  nativeScope: string;
  nativeReferences: readonly [string, string];
  githubToken: string;
}): Promise<void> => {
  const agentSurfacePath = join(input.repositoryRoot, "AGENTS.md");
  await writeFile(
    agentSurfacePath,
    withoutBearingManagedPointer(await readFile(agentSurfacePath, "utf8")),
  );
  await rm(join(input.repositoryRoot, ".bearing"), { recursive: true, force: true });
  await activate(input);
  await installPlanningState({ ...input, effortMode: "bound" });
  for (const reference of input.nativeReferences) {
    const inspected = z
      .object({
        command: z.literal("inspect"),
        outcome: z.literal("complete"),
        result: z.object({
          reference: z.literal(reference),
          binding: z.object({
            state: z.literal("bound"),
            nativeScope: z.literal(input.nativeScope),
            targetedReconciliationBasis: z.object({ state: z.literal("ready") }),
          }),
          coverage: z.object({
            state: z.literal("available"),
            completion: z.literal("incomplete"),
          }),
        }),
      })
      .parse(
        JSON.parse(
          await run(
            [
              input.productProgram,
              "inspect",
              "--native",
              reference,
              "--repo",
              input.repositoryRoot,
            ],
            {
              cwd: input.repositoryRoot,
              home: input.agentHome,
            },
          ),
        ),
      );
    if (inspected.result.reference !== reference) {
      fail("GitHub Live Scenario provider projection failed canonical native readback.");
    }
  }
  commitBaseline(input.repositoryRoot, "Prepare GitHub Live Scenario planning baseline");
};

const retainNativeTickets = async (
  repositoryRoot: string,
  retained: readonly string[],
): Promise<void> => {
  const issueRoot = join(repositoryRoot, ".scratch/label-delivery/issues");
  for (const name of [
    "01-update-output.md",
    "02-update-output.md",
    "03-run-failing-delivery.md",
    "04-complete-secondary-format.md",
    "05-decide-secondary-label-casing.md",
  ]) {
    if (!retained.includes(name)) await rm(join(issueRoot, name), { force: true });
  }
};

export const materializeLiveScenarioProductState = async (input: {
  scenario: LiveScenario;
  sourceRoot: string;
  repositoryRoot: string;
  productProgram: string;
  agentHome: string;
}): Promise<void> => {
  const materializer = input.scenario.fixedValidationFixture.profile;
  if (["fresh-repository", "fresh-installation-repository"].includes(materializer)) {
    return;
  }
  if (materializer === "repository-update-required-repository") {
    await materializeDevelopmentRepositoryUpdateSource({
      ...input,
      fixtureRoot: join(input.sourceRoot, input.scenario.fixedValidationFixture.source),
    });
    return;
  }
  await activate(input);
  if (
    [
      "active-planning-repository",
      "active-unbound-native-repository",
      "active-planned-unbound-native-repository",
      "active-bound-local-repository",
      "active-bound-wayfinder-repository",
    ].includes(materializer)
  ) {
    if (materializer === "active-bound-local-repository") {
      await retainNativeTickets(input.repositoryRoot, ["04-complete-secondary-format.md"]);
    }
    if (materializer === "active-bound-wayfinder-repository") {
      await cp(
        join(
          input.sourceRoot,
          "validation/live-journey/fixtures/local-provider/matt-kit-output/wayfinder-ticket.md",
        ),
        join(
          input.repositoryRoot,
          ".scratch/label-delivery/issues/05-decide-secondary-label-casing.md",
        ),
        { force: false },
      );
      await retainNativeTickets(input.repositoryRoot, ["05-decide-secondary-label-casing.md"]);
    }
    await installPlanningState({
      ...input,
      effortMode:
        materializer === "active-unbound-native-repository"
          ? "absent"
          : materializer === "active-planned-unbound-native-repository"
            ? "planned-unbound"
            : "bound",
    });
  }
  if (materializer === "active-repository-with-drift") {
    const path = join(input.repositoryRoot, "AGENTS.md");
    const current = await readFile(path, "utf8");
    if (!current.includes(BEARING_POINTER)) fail("Managed Agent Surface cannot be drifted.");
    const drifted = current.replace(
      BEARING_POINTER,
      `${BEARING_POINTER} Changed outside the managed pointer.`,
    );
    if (drifted === current) fail("Managed Agent Surface cannot be drifted.");
    await writeFile(path, drifted);
  }
  commitBaseline(input.repositoryRoot, `Prepare ${input.scenario.id} Live Scenario baseline`);
};
