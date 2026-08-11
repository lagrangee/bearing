import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const readCiWorkflow = async (): Promise<{
  readonly on: {
    readonly push: { readonly branches: readonly string[] };
    readonly pull_request: { readonly branches: readonly string[] };
  };
  readonly permissions: Readonly<Record<string, string>>;
  readonly concurrency: Readonly<{ group: string; "cancel-in-progress": boolean }>;
  readonly jobs: Readonly<
    Record<
      string,
      {
        readonly name?: string;
        readonly "runs-on"?: string;
        readonly "timeout-minutes"?: number;
        readonly steps?: readonly Readonly<{
          name?: string;
          run?: string;
          uses?: string;
          if?: string;
          env?: Readonly<Record<string, string>>;
          with?: Readonly<Record<string, string | number | boolean>>;
        }>[];
      }
    >
  >;
}> => parse(await readFile(".github/workflows/ci.yml", "utf8"));

test("required CI exposes the six stable contexts on main integration events", async () => {
  const workflow = await readCiWorkflow();

  expect(Object.keys(workflow.on)).toEqual(["push", "pull_request"]);
  expect(workflow.on.push.branches).toEqual(["main"]);
  expect(workflow.on.pull_request.branches).toEqual(["main"]);
  expect(Object.values(workflow.jobs).map((job) => job.name)).toEqual([
    "Source Quality",
    "Safety",
    "Runtime Compatibility (Node 24)",
    "Runtime Compatibility (Node 26)",
    "Browser Behavior",
    "Package Proof",
  ]);
});

test("Safety solely owns repository, secret, dependency, and license policy", async () => {
  const workflow = await readCiWorkflow();
  const safetySteps = workflow.jobs["safety"]?.steps ?? [];
  const safetyCommands = safetySteps.flatMap((step) => (step.run === undefined ? [] : [step.run]));

  expect(safetyCommands).toContain("bun run public-source:check");
  expect(safetyCommands).toContain("bun run gitleaks:revision");
  expect(safetyCommands).toContain("npm audit --audit-level=high");
  expect(safetyCommands).toContain("bun run license:check");
  expect(safetySteps.find((step) => step.name === "Scan pull request range")).toMatchObject({
    if: "github.event_name == 'pull_request'",
    env: {
      BASE_SHA: ["$", "{{ github.event.pull_request.base.sha }}"].join(""),
      HEAD_SHA: ["$", "{{ github.event.pull_request.head.sha }}"].join(""),
    },
  });

  const nonSafetyCommands = Object.entries(workflow.jobs).flatMap(([jobId, job]) =>
    jobId === "safety"
      ? []
      : (job.steps ?? []).flatMap((step) => (step.run === undefined ? [] : [step.run])),
  );
  expect(nonSafetyCommands.join("\n")).not.toMatch(
    /public-source:check|gitleaks|npm audit|license:check/u,
  );
});

test("runtime contexts execute the built CLI with the selected Node runtime only", async () => {
  const workflow = await readCiWorkflow();
  for (const [jobId, nodeVersion, context] of [
    ["runtime-node-24", "24.15.0", "Node 24"],
    ["runtime-node-26", 26, "Node 26"],
  ] as const) {
    const steps = workflow.jobs[jobId]?.steps ?? [];
    const setupNode = steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
    const commands = steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));

    expect(setupNode).toMatchObject({ with: { "node-version": nodeVersion } });
    expect(steps.find((step) => step.name === "Build public CLI for runtime execution")?.run).toBe(
      "bun run build",
    );
    expect(
      steps.find((step) => step.name === `Execute built public CLI with ${context}`)?.run,
    ).toBe("node dist/cli.js --version");
    expect(commands.join("\n")).not.toMatch(
      /bun run verify|public-source:check|gitleaks|npm audit|license:check|package:check|playwright|chromium|candidate/u,
    );
  }
});

test("Browser Behavior solely owns Playwright and retains bounded failure diagnostics", async () => {
  const workflow = await readCiWorkflow();
  const browserSteps = workflow.jobs["browser-behavior"]?.steps ?? [];
  const browserCommands = browserSteps.flatMap((step) =>
    step.run === undefined ? [] : [step.run],
  );

  expect(workflow.jobs["browser-behavior"]).toMatchObject({ "runs-on": "macos-latest" });
  expect(
    browserSteps.find((step) => step.uses?.startsWith("actions/setup-node@"))?.with?.[
      "node-version"
    ],
  ).toBe("24.15.0");
  expect(browserCommands).toContain("npx playwright install chromium");
  expect(browserCommands).toContain("bun run test:browser");
  expect(browserCommands).toContain(
    "npx playwright test --config browser-tests/packed-portal.playwright.config.ts",
  );
  expect(browserCommands).toContain(
    "npx playwright test --config browser-tests/portal-isolation.playwright.config.ts",
  );

  const upload = browserSteps.find((step) => step.name === "Upload browser failure diagnostics");
  expect(upload).toMatchObject({
    if: ["$", "{{ failure() }}"].join(""),
    uses: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    with: {
      path: [
        "test-results/playwright/",
        "test-results/playwright-packed-portal/",
        "test-results/playwright-portal-isolation/",
      ].join("\n"),
      "if-no-files-found": "warn",
      "retention-days": 7,
    },
  });

  const nonBrowserSurface = Object.entries(workflow.jobs).flatMap(([jobId, job]) =>
    jobId === "browser-behavior"
      ? []
      : (job.steps ?? []).flatMap((step) => [step.run ?? "", step.uses ?? ""]),
  );
  expect(nonBrowserSurface.join("\n")).not.toMatch(/playwright|chromium/u);
});

test("Package Proof prepares deterministic bytes and executes a clean-room installed CLI", async () => {
  const workflow = await readCiWorkflow();
  const packageSteps = workflow.jobs["package-proof"]?.steps ?? [];
  const packageSurface = packageSteps.flatMap((step) => [step.run ?? "", step.uses ?? ""]);

  expect(
    packageSteps.find((step) => step.uses?.startsWith("actions/setup-node@"))?.with?.[
      "node-version"
    ],
  ).toBe("24.15.0");
  expect(packageSteps.find((step) => step.name === "Build deterministic package inputs")?.run).toBe(
    "bun run build",
  );
  expect(packageSteps.find((step) => step.name === "Validate public package boundary")?.run).toBe(
    "bun run package:check",
  );

  const proof = packageSteps.find(
    (step) => step.name === "Prepare, install, and execute disposable package",
  )?.run;
  expect(proof?.match(/npm pack --json --ignore-scripts/gu)).toHaveLength(2);
  expect(proof).toContain('cmp "$PACK_A/$TARBALL" "$PACK_B/$TARBALL"');
  expect(proof).toContain("npm install --ignore-scripts --no-audit --no-fund --save-exact");
  expect(proof).toContain("./node_modules/.bin/bearing --version");
  expect(packageSurface.join("\n")).not.toMatch(/candidate|actions\/upload-artifact/u);
});

test("required CI has minimum authority and bounded ref-scoped execution", async () => {
  const workflow = await readCiWorkflow();

  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.concurrency).toEqual({
    group: [
      "required-ci-$",
      "{{ github.workflow }}-$",
      "{{ github.event.pull_request.number || github.ref }}",
    ].join(""),
    "cancel-in-progress": true,
  });
  for (const job of Object.values(workflow.jobs)) {
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(15);
    for (const action of (job.steps ?? []).flatMap((step) =>
      step.uses === undefined ? [] : [step.uses],
    )) {
      expect(action).toMatch(/@[0-9a-f]{40}$/u);
    }
  }
});

test("Source Quality solely owns canonical aggregate repository verification", async () => {
  const workflow = await readCiWorkflow();
  const scripts = (
    JSON.parse(await readFile("package.json", "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>;
    }
  ).scripts;
  const sourceSteps = workflow.jobs["source-quality"]?.steps ?? [];

  expect(
    sourceSteps.find((step) => step.name === "Run canonical aggregate repository verification")
      ?.run,
  ).toBe("bun run verify");
  expect(
    Object.entries(workflow.jobs).flatMap(([jobId, job]) =>
      jobId === "source-quality"
        ? []
        : (job.steps ?? []).flatMap((step) => (step.run === undefined ? [] : [step.run])),
    ),
  ).not.toContain("bun run verify");

  const directAggregate = scripts["verify"]?.split(" && ");
  expect(directAggregate).toEqual([
    "bun run typecheck",
    "bun run check",
    "bun run build",
    "bun test tests/*.test.ts",
    "bun run test:catalog-node",
  ]);
  expect(scripts["test:catalog-node"]).toBe("bun scripts/run-node-catalog-tests.ts");
  expect(Object.keys(scripts).filter((name) => /^test:g[12](?:-|$)/u.test(name))).toEqual([]);

  const requiredCommands = Object.values(workflow.jobs).flatMap((job) =>
    (job.steps ?? []).flatMap((step) => (step.run === undefined ? [] : [step.run])),
  );
  expect(requiredCommands.join("\n")).not.toMatch(/bun run test:g[12](?:-|\b)/u);
  expect(
    Object.entries(scripts)
      .filter(([, command]) => command.includes("bun test tests/*.test.ts"))
      .map(([name]) => name),
  ).toEqual(["test", "verify"]);
  expect(
    Object.entries(scripts)
      .filter(([, command]) => command.includes("bun scripts/run-node-catalog-tests.ts"))
      .map(([name]) => name),
  ).toEqual(["test:catalog-node"]);
  expect(
    Object.entries(scripts)
      .filter(([name]) => !["test", "test:catalog-node", "verify"].includes(name))
      .map(([name, command]) => `${name}=${command}`)
      .join("\n"),
  ).not.toMatch(
    /bun test tests\/\*\.test\.ts|bun scripts\/run-node-catalog-tests\.ts|bun run (?:verify|test(?:\s|$)|test:catalog-node)/u,
  );

  expect(sourceSteps.flatMap((step) => (step.run === undefined ? [] : [step.run]))).toEqual([
    "npm ci",
    "bun run verify",
  ]);
  expect(
    Object.entries(workflow.jobs)
      .filter(([jobId]) => jobId !== "source-quality")
      .flatMap(([, job]) =>
        (job.steps ?? []).flatMap((step) => (step.run === undefined ? [] : [step.run])),
      )
      .join("\n"),
  ).not.toMatch(
    /bun test tests\/\*\.test\.ts|bun scripts\/run-node-catalog-tests\.ts|bun run (?:verify|test(?:\s|$)|test:catalog-node)/u,
  );
});

test("only owner-specific environment preparation repeats across required jobs", async () => {
  const workflow = await readCiWorkflow();
  const commands = new Map<string, { jobId: string; name: string | undefined }[]>();
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (step.run === undefined || step.run.includes("\n")) continue;
      const owners = commands.get(step.run) ?? [];
      owners.push({ jobId, name: step.name });
      commands.set(step.run, owners);
    }
  }

  expect([...commands].filter(([, owners]) => owners.length > 1).map(([run]) => run)).toEqual([
    "npm ci",
    "bun run build",
    "node dist/cli.js --version",
  ]);
  expect(commands.get("npm ci")?.map(({ name }) => name)).toEqual([
    "Install source-quality dependencies",
    "Install audited dependencies",
    "Install Node 24 compatibility dependencies",
    "Install Node 26 compatibility dependencies",
    "Install browser dependencies",
    "Install package-proof dependencies",
  ]);
  expect(commands.get("bun run build")?.map(({ jobId, name }) => ({ jobId, name }))).toEqual([
    { jobId: "safety", name: "Build bundle metadata for license validation" },
    { jobId: "runtime-node-24", name: "Build public CLI for runtime execution" },
    { jobId: "runtime-node-26", name: "Build public CLI for runtime execution" },
    { jobId: "package-proof", name: "Build deterministic package inputs" },
  ]);
  const safetySteps = workflow.jobs["safety"]?.steps ?? [];
  expect(
    safetySteps.findIndex(
      (step) =>
        step.name === "Build bundle metadata for license validation" &&
        step.run === "bun run build",
    ),
  ).toBe(
    safetySteps.findIndex(
      (step) =>
        step.name === "Validate dependency licenses" && step.run === "bun run license:check",
    ) - 1,
  );
  expect(
    commands.get("node dist/cli.js --version")?.map(({ jobId, name }) => ({ jobId, name })),
  ).toEqual([
    { jobId: "runtime-node-24", name: "Execute built public CLI with Node 24" },
    { jobId: "runtime-node-26", name: "Execute built public CLI with Node 26" },
  ]);
});
