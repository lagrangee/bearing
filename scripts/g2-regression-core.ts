import { tmpdir } from "node:os";
import { join } from "node:path";

export const G2_REGRESSION_CORE = [
  {
    key: "semantic-equivalence",
    seam: "provider-capture",
    files: ["tests/native-work-provider.test.ts", "tests/matt-semantic-equivalence.test.ts"],
  },
  {
    key: "single-generation-product",
    seam: "packaged-product",
    files: [
      "tests/provider-capture-generation.test.ts",
      "tests/local-packaged-product-journey.test.ts",
      "tests/github-packaged-product-journey.test.ts",
      "tests/provider-degradation-product-seam.test.ts",
    ],
  },
  {
    key: "clean-cut-architecture",
    seam: "architecture-guard",
    files: [
      "tests/native-work-provider-architecture.test.ts",
      "tests/provider-capture-cutover-architecture.test.ts",
      "tests/markdown-architecture.test.ts",
      "tests/local-markdown-provider-architecture.test.ts",
      "tests/github-provider-architecture.test.ts",
    ],
  },
  {
    key: "snapshot-portal-isolation",
    seam: "project-snapshot-portal",
    files: [
      "tests/planning-graph-projection-owner.test.ts",
      "tests/project-snapshot-planning-derivation-consistency.test.ts",
      "tests/project-snapshot-structural-isolation.test.ts",
      "tests/project-isolation.test.ts",
    ],
  },
  {
    key: "zero-intrusion-credential-safety",
    seam: "native-ownership-boundary",
    files: ["tests/zero-intrusion-proof.test.ts", "tests/github-provider.test.ts"],
  },
] as const;

export const G2_REGRESSION_CHECKS = [
  {
    key: "g1-deterministic-correctness",
    command: ["bun", "run", "test:g1-regression"],
  },
  {
    key: "package-boundary",
    command: ["bun", "run", "package:check"],
  },
] as const;

export const g2RegressionCoreFiles = (): readonly string[] =>
  G2_REGRESSION_CORE.flatMap((group) => group.files);

export const g2RegressionCoreCommands = (): readonly Readonly<{
  key: string;
  command: readonly string[];
}>[] => [
  {
    key: "g2-focused-tests",
    command: ["bun", "test", ...g2RegressionCoreFiles()],
  },
  ...G2_REGRESSION_CHECKS,
];

type RegressionProcess = Readonly<{ exited: Promise<number> }>;

export type G2RegressionCoreRuntime = Readonly<{
  spawn: (command: readonly string[]) => RegressionProcess;
  write: (line: string) => void;
}>;

const defaultRuntime = (): G2RegressionCoreRuntime => ({
  spawn: (command) =>
    Bun.spawn([...command], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NPM_CONFIG_CACHE:
          process.env["NPM_CONFIG_CACHE"] ?? join(tmpdir(), "bearing-g2-regression-npm-cache"),
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  write: (line) => process.stdout.write(line),
});

export const runG2RegressionCore = async (
  runtime: G2RegressionCoreRuntime = defaultRuntime(),
): Promise<number> => {
  const files = g2RegressionCoreFiles();
  const commands = g2RegressionCoreCommands();
  runtime.write(
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "g2-regression-core-selection",
      groups: G2_REGRESSION_CORE,
      files,
      checks: G2_REGRESSION_CHECKS,
    })}\n`,
  );
  for (const check of commands) {
    const child = runtime.spawn(check.command);
    const exitCode = await child.exited;
    runtime.write(
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "g2-regression-core-check",
        key: check.key,
        outcome: exitCode === 0 ? "passed" : "failed",
        exitCode,
      })}\n`,
    );
    if (exitCode !== 0) {
      runtime.write(
        `${JSON.stringify({
          schemaVersion: 1,
          kind: "g2-regression-core-result",
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
      kind: "g2-regression-core-result",
      outcome: "passed",
      exitCode: 0,
    })}\n`,
  );
  return 0;
};

if (import.meta.main) process.exitCode = await runG2RegressionCore();
