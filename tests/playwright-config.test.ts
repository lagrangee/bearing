import { expect, test } from "bun:test";
import { browserOutputContract } from "../browser-tests/browser-artifact-output";
import config from "../playwright.config";

test("the root browser suite excludes specs with a dedicated Host contract", () => {
  expect(config.testIgnore).toEqual([
    "packaged-catalog.spec.ts",
    "project-isolation-real-host.spec.ts",
    "portal-reference-fidelity.spec.ts",
  ]);
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
