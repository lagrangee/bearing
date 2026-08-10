import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { browserOutputContract } from "./browser-tests/browser-artifact-output";

const port = 4180;
const artifacts = browserOutputContract();

// biome-ignore lint/style/noDefaultExport: Playwright discovers configuration through this export.
export default defineConfig({
  testDir: "./browser-tests",
  testIgnore: [
    "architecture-contraction-candidate.spec.ts",
    "packaged-catalog.spec.ts",
    "project-isolation-real-host.spec.ts",
    "project-preview-real-host.spec.ts",
    "portal-reference-fidelity.spec.ts",
    "safe-markdown-reading-candidate.spec.ts",
  ],
  outputDir: artifacts.outputDir,
  metadata: artifacts.metadata,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: `node dist/cli.js portal --port ${port}`,
    env: { HOME: join(process.cwd(), "browser-tests/fixtures/empty-home") },
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 30_000,
    url: `http://127.0.0.1:${port}/healthz`,
  },
});
