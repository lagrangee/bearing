import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { browserOutputContract } from "../browser-tests/browser-artifact-output";
import currentRealHostConfig from "../browser-tests/project-preview-real-host.playwright.config";
import packageMetadata from "../package.json";
import config from "../playwright.config";

const retainedBrowserFamilies = [
  {
    configuration: "playwright.config.ts",
    consumer: { kind: "package-script", script: "test:browser", command: "playwright test" },
    reason: "ordinary Portal behavior",
  },
  {
    configuration: "browser-tests/demo-pages.playwright.config.ts",
    consumer: {
      kind: "package-script",
      script: "demo:verify",
      command: "--config browser-tests/demo-pages.playwright.config.ts",
    },
    reason: "consolidated Pages demo artifact",
  },
  {
    configuration: "browser-tests/packed-portal.playwright.config.ts",
    consumer: { kind: "workflow", job: "Browser Behavior" },
    reason: "packed Portal installation",
  },
  {
    configuration: "browser-tests/portal-isolation.playwright.config.ts",
    consumer: { kind: "workflow", job: "Browser Behavior" },
    reason: "real Host isolation",
  },
  {
    configuration: "browser-tests/project-preview-real-host.playwright.config.ts",
    consumer: { kind: "workflow", job: "Browser Behavior" },
    reason: "Provider to v21 read model to Host integration",
  },
] as const;

test("ordinary Bun test files do not launch Playwright browsers", async () => {
  const testRoot = import.meta.dir;
  const sources = await Promise.all(
    (await readdir(testRoot))
      .filter((name) => name.endsWith(".test.ts") && name !== "playwright-config.test.ts")
      .map(async (name) => ({ name, source: await readFile(join(testRoot, name), "utf8") })),
  );
  expect(
    sources.flatMap(({ name, source }) =>
      source.includes('from "@playwright/test"') || source.includes("chromium.launch(")
        ? [name]
        : [],
    ),
  ).toEqual([]);
});

test("every broad browser suite excludes specs with a dedicated Host contract", () => {
  const dedicatedHostSpecs = [
    "packaged-catalog.spec.ts",
    "project-isolation-real-host.spec.ts",
    "project-preview-real-host.spec.ts",
  ];

  expect(config.testIgnore).toEqual(dedicatedHostSpecs);
  expect(
    dedicatedHostSpecs.every((spec) =>
      existsSync(join(import.meta.dir, "..", "browser-tests", spec)),
    ),
  ).toBe(true);
  expect(
    existsSync(
      join(import.meta.dir, "..", "browser-tests", "portal-contract.playwright.config.ts"),
    ),
  ).toBe(false);
});

test("every retained browser family has one explicit consumer and observable reason", async () => {
  const browserConfigurations = (await readdir(join(import.meta.dir, "..", "browser-tests")))
    .filter((name) => name.endsWith(".playwright.config.ts"))
    .map((name) => `browser-tests/${name}`)
    .toSorted();
  expect(["playwright.config.ts", ...browserConfigurations].toSorted()).toEqual(
    retainedBrowserFamilies.map(({ configuration }) => configuration).toSorted(),
  );
  expect(new Set(retainedBrowserFamilies.map(({ reason }) => reason)).size).toBe(
    retainedBrowserFamilies.length,
  );

  const workflow = await readFile(join(import.meta.dir, "..", ".github/workflows/ci.yml"), "utf8");
  for (const family of retainedBrowserFamilies) {
    if (family.consumer.kind === "package-script") {
      expect(packageMetadata.scripts[family.consumer.script]).toContain(family.consumer.command);
    } else {
      expect(family.consumer.job).toBe("Browser Behavior");
      expect(workflow).toContain(`--config ${family.configuration}`);
    }
  }
});

test("current real Host failures retain trace and screenshot output for Browser Behavior", () => {
  expect(currentRealHostConfig.outputDir).toBe(
    join(process.cwd(), "test-results/playwright-project-preview-real-host"),
  );
  expect(currentRealHostConfig.use).toMatchObject({
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  });
});

test("retired Candidate browser families cannot re-enter ordinary CI", async () => {
  const ciSurface = [
    JSON.stringify(packageMetadata.scripts),
    await readFile(join(import.meta.dir, "..", ".github/workflows/ci.yml"), "utf8"),
    await readFile(join(import.meta.dir, "..", ".github/workflows/demo-pages.yml"), "utf8"),
  ].join("\n");
  expect(ciSurface).not.toMatch(
    /architecture-contraction-candidate|safe-markdown-reading-candidate/u,
  );
});

test("the root browser suite writes ordinary artifacts to disposable test output", () => {
  expect(config.outputDir).toBe("test-results/playwright");
});

test("browser evidence output requires an explicit configured mode", () => {
  expect(browserOutputContract({}, "/repo")).toEqual({
    outputDir: "test-results/playwright",
    metadata: {},
  });
  expect(
    browserOutputContract({ BEARING_BROWSER_EVIDENCE_ROOT: ".scratch/run/evidence" }, "/repo"),
  ).toEqual({
    outputDir: "/repo/.scratch/run/evidence/playwright-output",
    metadata: { evidenceRoot: "/repo/.scratch/run/evidence" },
  });
});
