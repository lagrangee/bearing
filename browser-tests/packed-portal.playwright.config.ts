import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// The packed-product spec owns its temporary install and single Host.
// biome-ignore lint/style/noDefaultExport: Playwright discovers configuration through this export.
export default defineConfig({
  testDir: join(process.cwd(), "browser-tests"),
  testMatch: "packaged-catalog.spec.ts",
  outputDir: join(process.cwd(), "test-results/playwright-packed-portal"),
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
