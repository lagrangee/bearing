import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { browserOutputContract } from "../browser-tests/browser-artifact-output";
import config from "../playwright.config";

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
    "architecture-contraction-candidate.spec.ts",
    "packaged-catalog.spec.ts",
    "project-isolation-real-host.spec.ts",
    "project-preview-real-host.spec.ts",
    "safe-markdown-reading-candidate.spec.ts",
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
