import { describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  G2_REGRESSION_CHECKS,
  G2_REGRESSION_CORE,
  g2RegressionCoreCommands,
  g2RegressionCoreFiles,
  runG2RegressionCore,
} from "../scripts/g2-regression-core";

describe("G2 Matt-native regression core", () => {
  test("locks the accepted semantic, generation, clean-cut and product isolation seams", async () => {
    const expected = [
      {
        key: "semantic-equivalence",
        seam: "provider-capture",
        files: ["tests/native-work-provider.test.ts", "tests/matt-semantic-equivalence.test.ts"],
      },
      {
        key: "explicit-provider-product",
        seam: "packaged-product",
        files: [
          "tests/architecture-contraction-product-seams.test.ts",
          "tests/architecture-contraction-provider-product-seam.test.ts",
          "tests/portal-provider-application.test.ts",
        ],
      },
      {
        key: "clean-cut-architecture",
        seam: "architecture-guard",
        files: [
          "tests/native-work-provider-architecture.test.ts",
          "tests/architecture-clean-cut.test.ts",
          "tests/markdown-architecture.test.ts",
          "tests/local-markdown-provider-architecture.test.ts",
          "tests/github-provider-architecture.test.ts",
        ],
      },
      {
        key: "typed-portal-isolation",
        seam: "project-read-model-portal",
        files: [
          "tests/portal-typed-row-contract.test.ts",
          "tests/provider-native-subject-contract.test.ts",
        ],
      },
      {
        key: "credential-safety",
        seam: "native-ownership-boundary",
        files: ["tests/github-provider.test.ts", "tests/local-markdown-provider.test.ts"],
      },
    ] as const;
    expect(G2_REGRESSION_CORE).toEqual(expected);
    expect(G2_REGRESSION_CHECKS).toEqual([
      {
        key: "g1-deterministic-correctness",
        command: ["bun", "run", "test:g1-regression"],
      },
    ]);
    const files = g2RegressionCoreFiles();
    expect(new Set(files).size).toBe(files.length);
    for (const locator of files) await access(join(process.cwd(), locator));
  });

  test("exposes the G2 core as a standalone command and the repository verify tail", async () => {
    const metadata = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Readonly<Record<string, string>>;
    };
    expect(metadata.scripts["test:g2-regression"]).toBe(
      "bun run build && bun scripts/g2-regression-core.ts",
    );
    expect(metadata.scripts["verify"]).toBe(
      "bun run typecheck && bun run check && bun run build && bun test tests/*.test.ts && bun run test:catalog-node && bun run test:g2-regression",
    );
  });

  test("emits stable check envelopes, stops at the first failure and returns its code", async () => {
    const commands: (readonly string[])[] = [];
    const output: string[] = [];
    const exitCodes = [0, 23, 0];
    const exitCode = await runG2RegressionCore({
      spawn: (command) => {
        commands.push(command);
        return { exited: Promise.resolve(exitCodes[commands.length - 1] ?? 0) };
      },
      write: (line) => output.push(line),
    });

    expect(commands).toEqual(
      g2RegressionCoreCommands()
        .slice(0, 2)
        .map((item) => item.command),
    );
    expect(exitCode).toBe(23);
    expect(output).toHaveLength(4);
    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      schemaVersion: 1,
      kind: "g2-regression-core-selection",
      groups: G2_REGRESSION_CORE,
      files: g2RegressionCoreFiles(),
      checks: G2_REGRESSION_CHECKS,
    });
    expect(JSON.parse(output[1] ?? "{}")).toEqual({
      schemaVersion: 1,
      kind: "g2-regression-core-check",
      key: "g2-focused-tests",
      outcome: "passed",
      exitCode: 0,
    });
    expect(JSON.parse(output[2] ?? "{}")).toEqual({
      schemaVersion: 1,
      kind: "g2-regression-core-check",
      key: "g1-deterministic-correctness",
      outcome: "failed",
      exitCode: 23,
    });
    expect(JSON.parse(output[3] ?? "{}")).toEqual({
      schemaVersion: 1,
      kind: "g2-regression-core-result",
      outcome: "failed",
      failedCheck: "g1-deterministic-correctness",
      exitCode: 23,
    });
  });
});
