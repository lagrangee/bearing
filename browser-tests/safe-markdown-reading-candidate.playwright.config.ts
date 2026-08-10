import { join } from "node:path";
import { defineConfig } from "@playwright/test";

if (process.env["BEARING_READING_CANDIDATE"] === undefined) {
  throw new Error("Ticket 27 candidate config requires BEARING_READING_CANDIDATE.");
}

// biome-ignore lint/style/noDefaultExport: Playwright discovers configuration through this export.
export default defineConfig({
  testDir: join(process.cwd(), "browser-tests"),
  testMatch: "safe-markdown-reading-candidate.spec.ts",
  outputDir: join(process.cwd(), "test-results/playwright-safe-markdown-reading-candidate"),
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
