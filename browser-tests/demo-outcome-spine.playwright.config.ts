import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const port = 4192;
const repoRoot = join(import.meta.dirname, "..");
const evidenceRoot = join(repoRoot, ".scratch/bearing-portal-github-demo/evidence/ticket-02");

// biome-ignore lint/style/noDefaultExport: Playwright discovers configuration through this export.
export default defineConfig({
  testDir: join(repoRoot, "browser-tests"),
  testMatch: "demo-outcome-spine.pw.ts",
  outputDir: join(evidenceRoot, "playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["line"], ["json", { outputFile: join(evidenceRoot, "playwright-report.json") }]],
  use: {
    baseURL: `http://127.0.0.1:${port}/bearing/`,
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: `node ${join(repoRoot, "node_modules/vite/bin/vite.js")} demo --base /bearing/ --host 127.0.0.1 --port ${port}`,
    cwd: repoRoot,
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 30_000,
    url: `http://127.0.0.1:${port}/bearing/`,
  },
});
