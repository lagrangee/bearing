import { access, cp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import type { LiveScenario } from "./live-scenario-registry";

const fail = (message: string): never => {
  throw new Error(message);
};

const execute = async (
  command: readonly string[],
  options: Readonly<{ cwd: string; home: string }>,
) => {
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env: {
      ...process.env,
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
  options: Readonly<{ cwd: string; home: string }>,
) => {
  const { exitCode, stdout, stderr } = await execute(command, options);
  if (exitCode !== 0) fail(stderr.trim() || stdout.trim() || `${command[0]} failed.`);
  return stdout;
};

const runExpectedProductOutcome = async (
  command: readonly string[],
  options: Readonly<{ cwd: string; home: string }>,
): Promise<unknown> => {
  const { exitCode, stdout, stderr } = await execute(command, options);
  if (exitCode === 0) fail(`${command[0]} unexpectedly succeeded.`);
  if (stdout.trim().length === 0) fail(stderr.trim() || `${command[0]} returned no receipt.`);
  return JSON.parse(stdout);
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
    "AGENTS.md",
    "CONTEXT.md",
    "docs/agents",
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
    const source = join(input.sourceRoot, locator);
    try {
      await access(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const target = join(input.repositoryRoot, locator);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, {
      recursive: true,
      force: true,
    });
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

  await activate({ ...input, runtime: "development" });
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
    fail("CONFIG-04 Development Runtime bootstrap did not complete.");
  }

  const manifestPath = join(input.repositoryRoot, ".bearing/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  if (manifest["packageVersion"] !== "0.1.2-dev" || manifest["runtime"] !== "development") {
    fail("CONFIG-04 target Development Configuration was not established.");
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, packageVersion: "0.1.1" }, null, 2)}\n`,
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
    fail("CONFIG-04 Development Runtime receipt is not coherent.");
  }
};

const installPlanningState = async (input: {
  sourceRoot: string;
  repositoryRoot: string;
  includeEffort: boolean;
  productProgram: string;
  agentHome: string;
}): Promise<void> => {
  const baseline = join(input.sourceRoot, "validation/live-journey/fixtures/planning-state");
  await rm(join(input.repositoryRoot, ".bearing/state"), { recursive: true, force: true });
  await cp(baseline, join(input.repositoryRoot, ".bearing/state"), {
    recursive: true,
    force: true,
  });
  if (!input.includeEffort) {
    await rm(join(input.repositoryRoot, ".bearing/state/efforts/label-delivery.md"), {
      force: true,
    });
    const gatePath = join(
      input.repositoryRoot,
      ".bearing/state/milestone-gates/stable-label-output.md",
    );
    const gate = await readFile(gatePath, "utf8");
    await writeFile(
      gatePath,
      gate.replace("Effort order:\n  - effort:label-delivery", "Effort order: []"),
    );
  }
  await run([input.productProgram, "cache", "rebuild", "--repo", input.repositoryRoot], {
    cwd: input.repositoryRoot,
    home: input.agentHome,
  });
  if (input.includeEffort) {
    await run(
      [
        input.productProgram,
        "provider",
        "capture",
        "--scope",
        ".scratch/label-delivery",
        "--repo",
        input.repositoryRoot,
      ],
      { cwd: input.repositoryRoot, home: input.agentHome },
    );
  }
};

export const materializeGitHubLiveScenarioPlanningState = async (input: {
  sourceRoot: string;
  repositoryRoot: string;
  productProgram: string;
  agentHome: string;
}): Promise<void> => {
  await installPlanningState({ ...input, includeEffort: false });
  commitBaseline(input.repositoryRoot, "Prepare GitHub Live Scenario planning baseline");
};

const retainNativeTickets = async (
  repositoryRoot: string,
  retained: readonly string[],
  decisions: readonly string[],
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
  const mapPath = join(repositoryRoot, ".scratch/label-delivery/map.md");
  const map = await readFile(mapPath, "utf8");
  await writeFile(
    mapPath,
    map.replace(
      /## Decisions so far\n\n[\s\S]*?\n\n## Fog/u,
      `## Decisions so far\n\n${decisions.join("\n")}\n\n## Fog`,
    ),
  );
};

export const materializeLiveScenarioProductState = async (input: {
  scenario: LiveScenario;
  sourceRoot: string;
  repositoryRoot: string;
  productProgram: string;
  agentHome: string;
}): Promise<void> => {
  const materializer = input.scenario.fixture.materializer;
  if (
    ["fresh-repository", "installed-unconfigured-repository", "non-project-directory"].includes(
      materializer,
    )
  ) {
    return;
  }
  if (materializer === "active-github-repository") {
    await cp(
      join(
        input.sourceRoot,
        "validation/live-journey/fixtures/github-provider/docs/agents/issue-tracker.md",
      ),
      join(input.repositoryRoot, "docs/agents/issue-tracker.md"),
      { force: true },
    );
  }
  if (materializer === "repository-update-required-repository") {
    await materializeDevelopmentRepositoryUpdateSource(input);
    return;
  }
  await activate(input);
  if (
    [
      "active-planning-repository",
      "active-unbound-native-repository",
      "active-bound-local-repository",
      "active-bound-wayfinder-repository",
      "active-bound-wayfinder-capture-required-repository",
      "active-github-repository",
      "active-ambiguous-native-repository",
      "active-failing-execution-repository",
    ].includes(materializer)
  ) {
    if (materializer === "active-bound-local-repository") {
      await retainNativeTickets(
        input.repositoryRoot,
        ["04-complete-secondary-format.md"],
        [
          "- [Complete secondary label formatting](issues/04-complete-secondary-format.md) — Finish the accepted secondary behavior.",
        ],
      );
    }
    if (
      materializer === "active-bound-wayfinder-repository" ||
      materializer === "active-bound-wayfinder-capture-required-repository"
    ) {
      await writeFile(
        join(
          input.repositoryRoot,
          ".scratch/label-delivery/issues/05-decide-secondary-label-casing.md",
        ),
        `# 05 — Decide secondary label casing

Type: task

Status: claimed

Blocked by: None — can start immediately

## Question

How should secondary labels normalize surrounding whitespace and letter casing?
`,
      );
      await retainNativeTickets(input.repositoryRoot, ["05-decide-secondary-label-casing.md"], []);
    }
    if (materializer === "active-ambiguous-native-repository") {
      await retainNativeTickets(
        input.repositoryRoot,
        ["01-update-output.md", "02-update-output.md"],
        [
          "- [Update primary output](issues/01-update-output.md) — Keep one bounded primary change.",
          "- [Update secondary output](issues/02-update-output.md) — Keep the secondary behavior separate.",
        ],
      );
    }
    if (materializer === "active-failing-execution-repository") {
      await retainNativeTickets(
        input.repositoryRoot,
        ["03-run-failing-delivery.md"],
        [
          "- [Run the failing delivery check](issues/03-run-failing-delivery.md) — Preserve its actual command failure.",
        ],
      );
    }
    await installPlanningState({
      ...input,
      includeEffort: materializer !== "active-unbound-native-repository",
    });
    if (materializer === "active-bound-wayfinder-capture-required-repository") {
      const contractPath = join(input.repositoryRoot, "docs/agents/issue-tracker.md");
      const contract = await readFile(contractPath, "utf8");
      await rm(contractPath);
      try {
        const failed = await runExpectedProductOutcome(
          [
            input.productProgram,
            "reconcile-native",
            "--scope",
            ".scratch/label-delivery",
            "--ref",
            ".scratch/label-delivery/issues/05-decide-secondary-label-casing.md",
            "--repo",
            input.repositoryRoot,
          ],
          { cwd: input.repositoryRoot, home: input.agentHome },
        );
        if (
          !z
            .object({ outcome: z.literal("unfulfilled") })
            .passthrough()
            .safeParse(failed).success
        ) {
          fail("NATIVE-03 did not establish a failed provider attempt.");
        }
      } finally {
        await writeFile(contractPath, contract);
      }
      const inspected = z
        .object({
          result: z.object({
            binding: z.object({
              targetedReconciliationBasis: z.object({
                state: z.literal("capture-required"),
                reason: z.literal("latest-attempt-failed"),
              }),
            }),
          }),
        })
        .passthrough()
        .parse(
          JSON.parse(
            await run(
              [
                input.productProgram,
                "inspect",
                "--native",
                ".scratch/label-delivery/issues/05-decide-secondary-label-casing.md",
                "--repo",
                input.repositoryRoot,
              ],
              { cwd: input.repositoryRoot, home: input.agentHome },
            ),
          ),
        );
      if (inspected.result.binding.targetedReconciliationBasis.state !== "capture-required") {
        fail("NATIVE-03 Targeted Reconciliation Basis is not capture-required.");
      }
    }
  }
  if (materializer === "active-repository-with-drift") {
    const path = join(input.repositoryRoot, "AGENTS.md");
    const current = await readFile(path, "utf8");
    if (!current.includes("For a new request")) fail("Managed Agent Surface cannot be drifted.");
    await writeFile(path, current.replace("For a new request", "For a changed request"));
  }
  if (materializer === "kit-update-required-repository") {
    await writeFile(
      join(input.repositoryRoot, ".bearing/manifest.json"),
      `${JSON.stringify({ schemaVersion: 99, status: "active" }, null, 2)}\n`,
    );
  }
  if (materializer === "unsupported-repository") {
    await writeFile(
      join(input.repositoryRoot, ".bearing/manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          packageVersion: "0.0.9",
          surfaces: ["agent-skills"],
          executorProfiles: [],
        },
        null,
        2,
      )}\n`,
    );
  }
  commitBaseline(input.repositoryRoot, `Prepare ${input.scenario.id} Live Scenario baseline`);
};
