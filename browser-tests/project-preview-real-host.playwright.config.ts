import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// This spec owns its temporary Catalog, repositories, and single Host.
// biome-ignore lint/style/noDefaultExport: Playwright discovers configuration through this export.
export default defineConfig({
  testDir: join(process.cwd(), "browser-tests"),
  testMatch: "project-preview-real-host.spec.ts",
  outputDir: join(process.cwd(), "test-results/playwright-project-preview-real-host"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: "line",
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
