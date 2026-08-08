import { describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  G1_REGRESSION_CORE,
  g1RegressionCoreCommands,
  g1RegressionCoreFiles,
  runG1RegressionCore,
} from "../scripts/g1-regression-core";

describe("G1 deterministic regression core", () => {
  test("keeps one bounded selection across the two deterministic seams", async () => {
    const expected = [
      {
        key: "repository-configuration",
        seam: "repository-lifecycle-cli",
        files: [
          "tests/repository-configuration-product-seam.test.ts",
          "tests/repo-setup-regressions.test.ts",
        ],
      },
      {
        key: "repository-deactivation",
        seam: "repository-lifecycle-cli",
        files: ["node-tests/repository-lifecycle.test.ts"],
      },
      {
        key: "asset-contract",
        seam: "planning-asset-contract",
        files: ["tests/asset-kiss-contract.test.ts", "tests/portal-asset-source-probe.test.ts"],
      },
      {
        key: "package-topology",
        seam: "package-skill-contract",
        files: [
          "tests/installer.test.ts",
          "tests/installer-upgrade.test.ts",
          "tests/package.test.ts",
        ],
      },
      {
        key: "composition-contracts",
        seam: "package-skill-contract",
        files: ["tests/skills.test.ts"],
      },
    ] as const;
    expect(G1_REGRESSION_CORE).toEqual(expected);
    expect([...new Set(expected.map((group) => group.seam))].sort()).toEqual([
      "package-skill-contract",
      "planning-asset-contract",
      "repository-lifecycle-cli",
    ]);

    const files = g1RegressionCoreFiles();
    expect(files.length).toBe(9);
    expect(new Set(files).size).toBe(files.length);
    for (const locator of files) await access(join(process.cwd(), locator));
  });

  test("exposes the bounded core as a standalone package command while CI retains every test", async () => {
    const metadata = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Readonly<Record<string, string>>;
    };
    expect(metadata.scripts["test:g1-regression"]).toBe(
      "bun run build && bun scripts/g1-regression-core.ts",
    );
    expect(metadata.scripts["verify"]).toBe(
      "bun run typecheck && bun run check && bun run build && bun test tests/*.test.ts && bun run test:catalog-node && bun run test:g2-regression",
    );
  });

  test("emits stable envelopes and returns the child failure code", async () => {
    const commands: (readonly string[])[] = [];
    const output: string[] = [];
    const exitCodes = [0, 23];
    const exitCode = await runG1RegressionCore({
      spawn: (command) => {
        commands.push(command);
        return { exited: Promise.resolve(exitCodes[commands.length - 1] ?? 0) };
      },
      write: (line) => output.push(line),
    });

    expect(commands).toEqual(g1RegressionCoreCommands().map((item) => item.command));
    expect(exitCode).toBe(23);
    expect(output).toHaveLength(4);
    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      schemaVersion: 1,
      kind: "g1-regression-core-selection",
      groups: G1_REGRESSION_CORE,
      files: g1RegressionCoreFiles(),
    });
    expect(JSON.parse(output[1] ?? "{}")).toEqual({
      schemaVersion: 1,
      kind: "g1-regression-core-check",
      key: "g1-focused-tests",
      outcome: "passed",
      exitCode: 0,
    });
    expect(JSON.parse(output[2] ?? "{}")).toEqual({
      schemaVersion: 1,
      kind: "g1-regression-core-check",
      key: "node-catalog-and-lifecycle",
      outcome: "failed",
      exitCode: 23,
    });
    expect(JSON.parse(output[3] ?? "{}")).toEqual({
      schemaVersion: 1,
      kind: "g1-regression-core-result",
      outcome: "failed",
      failedCheck: "node-catalog-and-lifecycle",
      exitCode: 23,
    });
  });
});
