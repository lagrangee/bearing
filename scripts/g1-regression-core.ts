export const G1_REGRESSION_CORE = [
  {
    key: "setup-apply-reconcile",
    seam: "repository-lifecycle-cli",
    files: ["tests/repo-setup-regressions.test.ts", "tests/repository-integration-plan.test.ts"],
  },
  {
    key: "cutover-lifecycle-recovery",
    seam: "repository-lifecycle-cli",
    files: [
      "tests/repository-cutover.test.ts",
      "node-tests/repository-lifecycle.test.ts",
      "tests/repository-recovery.test.ts",
    ],
  },
  {
    key: "asset-registration",
    seam: "repository-lifecycle-cli",
    files: ["tests/asset-registration-cli.test.ts"],
  },
  {
    key: "package-topology",
    seam: "package-skill-contract",
    files: ["tests/installer.test.ts", "tests/installer-upgrade.test.ts", "tests/package.test.ts"],
  },
  {
    key: "composition-contracts",
    seam: "package-skill-contract",
    files: ["tests/skills.test.ts"],
  },
] as const;

export const g1RegressionCoreFiles = (): readonly string[] =>
  G1_REGRESSION_CORE.flatMap((group) => group.files);

export const g1RegressionCoreCommands = (): readonly Readonly<{
  key: string;
  command: readonly string[];
}>[] => [
  {
    key: "g1-focused-tests",
    command: [
      "bun",
      "test",
      ...g1RegressionCoreFiles().filter((file) => file.startsWith("tests/")),
    ],
  },
  {
    key: "node-catalog-and-lifecycle",
    command: [
      "bun",
      "scripts/run-node-catalog-tests.ts",
      "node-tests/repository-lifecycle.test.ts",
    ],
  },
];

type RegressionProcess = Readonly<{ exited: Promise<number> }>;

export type G1RegressionCoreRuntime = Readonly<{
  spawn: (command: readonly string[]) => RegressionProcess;
  write: (line: string) => void;
}>;

const defaultRuntime = (): G1RegressionCoreRuntime => ({
  spawn: (command) =>
    Bun.spawn([...command], {
      cwd: process.cwd(),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  write: (line) => process.stdout.write(line),
});

export const runG1RegressionCore = async (
  runtime: G1RegressionCoreRuntime = defaultRuntime(),
): Promise<number> => {
  const files = g1RegressionCoreFiles();
  runtime.write(
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "g1-regression-core-selection",
      groups: G1_REGRESSION_CORE,
      files,
    })}\n`,
  );
  for (const check of g1RegressionCoreCommands()) {
    const child = runtime.spawn(check.command);
    const exitCode = await child.exited;
    runtime.write(
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "g1-regression-core-check",
        key: check.key,
        outcome: exitCode === 0 ? "passed" : "failed",
        exitCode,
      })}\n`,
    );
    if (exitCode !== 0) {
      runtime.write(
        `${JSON.stringify({
          schemaVersion: 1,
          kind: "g1-regression-core-result",
          outcome: "failed",
          failedCheck: check.key,
          exitCode,
        })}\n`,
      );
      return exitCode;
    }
  }
  runtime.write(
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "g1-regression-core-result",
      outcome: "passed",
      exitCode: 0,
    })}\n`,
  );
  return 0;
};

if (import.meta.main) process.exitCode = await runG1RegressionCore();
