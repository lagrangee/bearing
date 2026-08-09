import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  spawnHarnessProcess,
  stopHarnessProcess,
  waitForHarnessLine,
} from "./real-host-test-support";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
};

const sourceCommit = required("BEARING_CANDIDATE_SOURCE_COMMIT");
const packagePath = required("BEARING_CANDIDATE_PACKAGE");
const packageSha256 = required("BEARING_CANDIDATE_PACKAGE_SHA256");
const homeDir = required("BEARING_CANDIDATE_HOME");
const repoRoot = required("BEARING_CANDIDATE_REPO");
const evidencePath = required("BEARING_CANDIDATE_PORTAL_EVIDENCE");
const semanticMarker = "Architecture Contraction exact candidate accepted semantic revision.";

const reservePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No browser test port.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
};

test("the exact installed candidate remains coherent through foreground Portal", async ({
  page,
}) => {
  test.setTimeout(120_000);
  expect(
    createHash("sha256")
      .update(await readFile(packagePath))
      .digest("hex"),
  ).toBe(packageSha256);
  const cli = join(homeDir, ".bearing/bin/bearing");
  const environment = { ...process.env, HOME: homeDir };
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const portal = spawnHarnessProcess(cli, ["portal", "--port", String(port)], { environment });
  portal.stdin.end();
  try {
    await waitForHarnessLine(portal, `Bearing Portal ready: ${origin}`, {
      label: "Architecture Contraction candidate Portal",
      timeoutMs: 15_000,
    });

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${origin}/`);
    const catalog = page.getByRole("list", { name: "Registered Bearing projects" });
    const entry = catalog.getByRole("link", {
      name: new RegExp(`^${basename(repoRoot)} .* Available$`),
    });
    await expect(entry).toBeVisible();
    const href = await entry.getAttribute("href");
    if (href === null) throw new Error("Candidate Catalog entry has no route.");
    await entry.click();
    await expect(page.getByRole("heading", { name: "G1 Fixture", level: 1 })).toBeVisible();
    await page.getByRole("tab", { name: "Project Summary", exact: true }).click();
    await expect(page.getByText(semanticMarker, { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByRole("link", { name: "Roadmaps", exact: true }).click();
    await page.getByRole("link", { name: "G1 Fixture Roadmap", exact: true }).click();
    await page.getByRole("link", { name: "G1 Fixture Effort", exact: true }).first().click();
    await page.getByRole("link", { name: /^Full work history · History /u }).click();
    const workHistory = page.locator("#native-work-history");
    const ticketLink = workHistory.getByRole("link", {
      name: "Choose fixture wording",
      exact: true,
    });
    const resolvedTicket = ticketLink.locator("xpath=ancestor::li[1]");
    await expect(ticketLink).toBeVisible();
    await expect(resolvedTicket.getByText("Resolved", { exact: true })).toBeVisible();

    const providerRequest = page.waitForRequest((request) =>
      request.url().endsWith("/provider-observation"),
    );
    const providerResponse = page.waitForResponse((response) =>
      response.url().endsWith("/provider-observation"),
    );
    await page.getByRole("button", { name: "Refresh source", exact: true }).click();
    expect((await providerRequest).postDataJSON()).toEqual({
      version: 1,
      action: "source-load",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
    });
    const refreshResult = await (await providerResponse).json();
    expect(refreshResult).toMatchObject({
      version: 1,
      state: "completed",
      action: "source-load",
      acquisitionCount: 1,
    });
    await expect(page.getByRole("status")).toContainText("1 source checked");
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);

    await page.goto(`${origin}/projects/missing`);
    await expect(page.getByRole("heading", { name: "Project could not be loaded" })).toBeVisible();
    await expect(page.getByText("project-read-failed", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Return to Project Catalog/u })).toHaveAttribute(
      "href",
      "/",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(consoleErrors).toEqual([
      "Failed to load resource: the server responded with a status of 404 (Not Found)",
    ]);
    expect(pageErrors).toEqual([]);

    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          name: "foreground-portal",
          candidate: {
            sourceCommit,
            packageFile: basename(packagePath),
            packageSha256,
          },
          outcome: "passed",
          details: {
            foregroundLoopback: true,
            catalogSeparated: true,
            typedSummaryMarker: semanticMarker,
            localMarkdownScope: ".scratch/work",
            exactNativeReference: ".scratch/work/issues/00-language-decision.md",
            contextualAcquisitionCount: 1,
            degradedRouting: "Project could not be loaded: project-read-failed",
            degradedTransportStatus: 404,
            unexpectedConsoleErrors: 0,
            accessibilityViolations: 0,
          },
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  } finally {
    await stopHarnessProcess(portal, { label: "Architecture Contraction candidate Portal" });
  }
});
