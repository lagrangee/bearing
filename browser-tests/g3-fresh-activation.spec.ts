import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { basename } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { readRepositorySourceBytes } from "../tests/fixtures/repository-fixture";
import { makeTemporaryDirectory, writeStandardMattLocalRepository } from "../tests/helpers";
import {
  type RunningTestPortal,
  startBuiltPortal,
  stopBuiltPortal,
} from "./real-host-test-support";

type CliResult = Readonly<{
  args: readonly string[];
  code: number;
  stdout: string;
  stderr: string;
}>;

const runDevelopmentCli = async (home: string, args: readonly string[]): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete environment["FORCE_COLOR"];
    const child = spawn("node", ["dist/cli.js", ...args], {
      cwd: process.cwd(),
      env: environment,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ args, code: code ?? 1, stdout, stderr }));
  });

const expectSuccessful = (result: CliResult): void => {
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
};

const sourceBytes = async (root: string): Promise<Readonly<Record<string, string>>> => {
  const all = await readRepositorySourceBytes(root);
  return Object.fromEntries(
    Object.entries(all).filter(
      ([locator]) =>
        locator === "AGENTS.md" ||
        locator.startsWith("docs/agents/") ||
        locator.startsWith(".scratch/"),
    ),
  );
};

test("Fresh Local activation keeps Scope Review transient and Portal read-only", async () => {
  const root = await makeTemporaryDirectory("bearing-g3-fresh-local-");
  const home = await makeTemporaryDirectory("bearing-g3-fresh-home-");
  let portal: RunningTestPortal | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await writeStandardMattLocalRepository(root);
    const beforeNativeSources = await sourceBytes(root);
    const entryName = basename(root);
    const setup = await runDevelopmentCli(home, [
      "setup",
      "--repo",
      root,
      "--surface",
      "agent-skills",
      "--provider-contract",
      "docs/agents/issue-tracker.md",
    ]);
    expectSuccessful(setup);
    expect(setup.stdout).toContain("Outcome: applied");
    expect(setup.stdout).toContain("Repository: applied");
    expect(setup.stdout).toContain("Catalog: applied");
    const afterSetupNativeSources = await sourceBytes(root);
    const afterSetupAgents = afterSetupNativeSources["AGENTS.md"];
    expect(afterSetupAgents).toBeDefined();
    expect(Buffer.from(afterSetupAgents ?? "", "base64").toString("utf8")).toContain(
      "bearing:managed-start",
    );
    expect(
      Object.fromEntries(
        Object.entries(afterSetupNativeSources).filter(([locator]) => locator !== "AGENTS.md"),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(beforeNativeSources).filter(([locator]) => locator !== "AGENTS.md"),
      ),
    );

    const baseline = await runDevelopmentCli(home, [
      "sync",
      "--repo",
      root,
      "--initialize-provider-observations",
    ]);
    expectSuccessful(baseline);
    expect(baseline.stdout).toContain("Diagnostics: 0");
    expect(baseline.stdout).toContain("Provider observations: initial-baseline/acquired");
    expect(baseline.stdout).toContain(
      "Native scope inspection: none/not-requested (0 acquisitions)",
    );

    const ordinary = await runDevelopmentCli(home, ["sync", "--repo", root]);
    expectSuccessful(ordinary);
    expect(ordinary.stdout).toContain(
      "Provider observations: ordinary-sync/reused (0 acquisitions)",
    );
    expect(ordinary.stdout).toContain("Outcome: no-op");

    const stateBytes = await readRepositorySourceBytes(root);
    expect(Object.keys(stateBytes).some((locator) => locator.startsWith(".bearing/state/"))).toBe(
      false,
    );
    expect(JSON.parse(await readFile(`${root}/.bearing/provider.json`, "utf8"))).toEqual({
      schemaVersion: 1,
      provider: "matt-skills/v1",
      contractLocator: "docs/agents/issue-tracker.md",
    });

    portal = await startBuiltPortal(home);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(portal.url);
    await page
      .getByRole("list", { name: "Registered Bearing projects" })
      .getByRole("link", { name: entryName })
      .click();
    await expect(page.getByRole("tab", { name: "Brief", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("Project Brief has not been generated yet.")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Project Summary", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Discovered Work", level: 2 })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Next work", level: 2 })).toHaveCount(0);
    await expect(page.getByText("Create Effort", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Bind", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No Roadmap Index is available", { exact: false })).toBeVisible();

    expect(await sourceBytes(root)).toEqual(afterSetupNativeSources);
  } finally {
    await browser?.close();
    await stopBuiltPortal(portal);
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
