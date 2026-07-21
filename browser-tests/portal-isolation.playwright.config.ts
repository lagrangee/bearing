import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// This suite owns its single real Host inside the test so the temporary Catalog
// and repository fixtures cannot leak into the user's HOME or running services.
// biome-ignore lint/style/noDefaultExport: Playwright discovers configuration through this export.
export default defineConfig({
  testDir: join(process.cwd(), "browser-tests"),
  testMatch: "project-isolation-real-host.spec.ts",
  outputDir: join(process.cwd(), "test-results/playwright-portal-isolation"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 75_000,
  expect: { timeout: 10_000 },
  reporter: "line",
  use: {
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
