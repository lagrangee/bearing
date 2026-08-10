import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const port = 4181;

// The contract suite owns exactly one Host. Specs that own a Host or exercise
// Ticket 16's separate visual matrix run under their dedicated configurations.
// biome-ignore lint/style/noDefaultExport: Playwright discovers configuration through this export.
export default defineConfig({
  testDir: join(process.cwd(), "browser-tests"),
  testIgnore: [
    "architecture-contraction-candidate.spec.ts",
    "packaged-catalog.spec.ts",
    "project-isolation-real-host.spec.ts",
    "portal-reference-fidelity.spec.ts",
    "safe-markdown-reading-candidate.spec.ts",
  ],
  outputDir: join(process.cwd(), "test-results/playwright-portal-contract"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: `node ${join(process.cwd(), "dist/cli.js")} portal --port ${port}`,
    env: { HOME: join(process.cwd(), "browser-tests/fixtures/empty-home") },
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 30_000,
    url: `http://127.0.0.1:${port}/healthz`,
  },
});
