import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { TestInfo } from "@playwright/test";

const disposableOutputDir = "test-results/playwright";

type BrowserOutputEnvironment = Readonly<Record<string, string | undefined>>;

export type BrowserOutputContract = Readonly<{
  outputDir: string;
  metadata: Readonly<{ evidenceRoot?: string }>;
}>;

export const browserOutputContract = (
  environment: BrowserOutputEnvironment = process.env,
  cwd = process.cwd(),
): BrowserOutputContract => {
  const configured = environment["BEARING_BROWSER_EVIDENCE_ROOT"]?.trim();
  if (configured === undefined || configured.length === 0) {
    return { outputDir: disposableOutputDir, metadata: {} };
  }
  const evidenceRoot = resolve(cwd, configured);
  return {
    outputDir: join(evidenceRoot, "playwright-output"),
    metadata: { evidenceRoot },
  };
};

export const browserArtifactPath = async (
  testInfo: TestInfo,
  filename: string,
): Promise<string> => {
  const evidenceRoot = testInfo.project.metadata["evidenceRoot"];
  const path =
    typeof evidenceRoot === "string" && isAbsolute(evidenceRoot)
      ? join(evidenceRoot, filename)
      : testInfo.outputPath(filename);
  await mkdir(dirname(path), { recursive: true });
  return path;
};
