import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import { createMarkdownEngine } from "../src/portal/markdown-engine";
import { portalProjectReadEnvelopeSchema } from "../src/portal-project-read-wire";
import { PROJECT_READ_MODEL_PROJECTION_VERSION } from "../src/project-read-model/contract";
import { runHarnessCommand, writeCatalogFixture } from "./real-host-test-support";
import {
  armProviderReadMonitor,
  changedProviderReads,
  digestReadingTruth,
  digestSelfHostAuthority,
  type InstalledPortal,
  prepareSelfHostReadingCopy,
  type ReadingCandidate,
  readReadingCandidate,
  runInstalledBearing,
  setInstalledReadModelProjectionVersion,
  startInstalledPortal,
  stopInstalledPortal,
  verifyReadingCandidateIdentity,
} from "./safe-markdown-reading-candidate-support";

let candidate: ReadingCandidate;
let homeRoot = "";
let portal: InstalledPortal | undefined;
let selfHostRoot = "";
let typedInspect: unknown;

test.beforeAll(async () => {
  candidate = await readReadingCandidate();
  await verifyReadingCandidateIdentity(candidate);
  selfHostRoot = await prepareSelfHostReadingCopy(candidate.selfHostRepo);
  if (candidate.expectation === "fixed") {
    await runInstalledBearing(candidate, ["cache", "rebuild", "--repo", selfHostRoot]);
    const authorityBeforeControls = await digestSelfHostAuthority(selfHostRoot);
    const readModelPath = join(selfHostRoot, ".bearing/cache/project-read-model.sqlite");
    setInstalledReadModelProjectionVersion(selfHostRoot, PROJECT_READ_MODEL_PROJECTION_VERSION - 1);
    const oldProjection = await runHarnessCommand(
      candidate.installedCli,
      ["inspect", "project", "--repo", selfHostRoot],
      { environment: process.env, label: "Ticket 27 v20 read-model control" },
    );
    expect(JSON.parse(oldProjection.stdout)).toMatchObject({ outcome: "recovery-required" });
    await runInstalledBearing(candidate, ["cache", "rebuild", "--repo", selfHostRoot]);

    setInstalledReadModelProjectionVersion(selfHostRoot, PROJECT_READ_MODEL_PROJECTION_VERSION + 1);
    const futureProjectionBytes = await readFile(readModelPath);
    const futureProjection = await runHarnessCommand(
      candidate.installedCli,
      ["inspect", "project", "--repo", selfHostRoot],
      { environment: process.env, label: "Ticket 27 mixed read-model control" },
    );
    expect(JSON.parse(futureProjection.stdout)).toMatchObject({ outcome: "need-update" });
    const refusedDowngrade = await runHarnessCommand(
      candidate.installedCli,
      ["cache", "rebuild", "--repo", selfHostRoot],
      { environment: process.env, label: "Ticket 27 mixed-generation rebuild control" },
    );
    expect(refusedDowngrade.exitCode).not.toBe(0);
    expect(await readFile(readModelPath)).toEqual(futureProjectionBytes);
    setInstalledReadModelProjectionVersion(selfHostRoot, PROJECT_READ_MODEL_PROJECTION_VERSION);
    expect(await digestSelfHostAuthority(selfHostRoot)).toBe(authorityBeforeControls);
  }
  await runInstalledBearing(candidate, [
    "provider",
    "capture",
    "--repo",
    selfHostRoot,
    "--scope",
    ".scratch/bearing-architecture-contraction",
  ]);
  const inspection = await runHarnessCommand(
    candidate.installedCli,
    [
      "inspect",
      "--native",
      ".scratch/bearing-architecture-contraction/PRD.md",
      "--repo",
      selfHostRoot,
    ],
    { environment: process.env, label: "Ticket 27 installed typed Inspect" },
  );
  expect(inspection.exitCode).toBe(0);
  typedInspect = JSON.parse(inspection.stdout);

  homeRoot = await mkdtemp(join(tmpdir(), "bearing-ticket27-home-"));
  await mkdir(join(homeRoot, ".bearing"), { recursive: true });
  await writeCatalogFixture(homeRoot, [
    {
      entryId: "bearing-self-host",
      repoRoot: selfHostRoot,
      displayName: "Bearing Self Host",
    },
  ]);
  portal = await startInstalledPortal(candidate, homeRoot);
});

test.afterAll(async () => {
  await stopInstalledPortal(portal);
  await Promise.all(
    [homeRoot, selfHostRoot]
      .filter((root) => root.length > 0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("installed candidate records the safe self-host reading outcome", async ({ page }) => {
  if (portal === undefined) throw new Error("Ticket 27 installed Portal did not start.");
  const posts: string[] = [];
  const externalRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
    if (!new URL(request.url()).hostname.match(/^(?:127\.0\.0\.1|localhost)$/u)) {
      externalRequests.push(request.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  expect(typedInspect).toMatchObject({
    schemaVersion: 1,
    command: "inspect",
    outcome: "complete",
    result: {
      reference: ".scratch/bearing-architecture-contraction/PRD.md",
      coverage: { state: "available", assessment: "complete" },
    },
  });
  const truthBefore = await digestReadingTruth(selfHostRoot, homeRoot);
  const monitorProbe = await armProviderReadMonitor(selfHostRoot);
  const monitoredProbe = monitorProbe[0];
  if (monitoredProbe === undefined) throw new Error("Ticket 27 provider monitor is empty.");
  await readFile(monitoredProbe.path);
  expect(await changedProviderReads(monitorProbe)).toContain(monitoredProbe.path);
  const providerReadMonitor = await armProviderReadMonitor(selfHostRoot);
  const prdHref = planningLineageSubjectHref("bearing-self-host", {
    kind: "native-subject",
    id: ".scratch/bearing-architecture-contraction/PRD.md",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${portal.url}${prdHref}`);
  await expect(page.getByRole("heading", { name: "Problem Statement", level: 2 })).toBeVisible();

  if (candidate.expectation === "historical-failure") {
    await expect(page.locator(".provider-markdown")).toHaveCount(0);
    await expect(page.locator("main p").filter({ hasText: "1. As a Bearing user" })).toBeVisible();
    await page.screenshot({ path: candidate.screenshotPath, fullPage: true });
  } else {
    const inferredTime = page.locator('.source-event-time[title*="Approximate time"]').first();
    await expect(inferredTime).toBeVisible();
    await inferredTime.focus();
    await expect(inferredTime).toHaveAttribute("aria-describedby");
    const sourceInstant = await inferredTime.locator("time").getAttribute("datetime");
    expect(sourceInstant).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    if (sourceInstant === null) throw new Error("Ticket 27 inferred time has no source instant.");
    const absoluteTime = await page.evaluate(
      (value) =>
        new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(value),
        ),
      sourceInstant,
    );
    await expect(inferredTime.locator("time")).toHaveText(absoluteTime);
    expect(await inferredTime.getAttribute("title")).toMatch(
      /^(?:.+\. )?Approximate time from current source metadata\.$/u,
    );
    const probeHeading = page.getByRole("heading", {
      name: "Ticket 27 controlled real self-host reading probe",
      level: 2,
    });
    const probe = probeHeading
      .locator("xpath=following-sibling::*[1]")
      .locator(".provider-markdown");
    await expect(probe).toBeVisible();
    const disclosure = probe.locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' read-disclosure ')][1]",
    );
    const disclosureToggle = disclosure.getByRole("button", { name: /^Show more:/u });
    await expect(disclosureToggle).toHaveAttribute("aria-expanded", "false");
    await disclosureToggle.click();
    await expect(disclosure.getByRole("button", { name: /^Show less:/u })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(probe.locator("p").first()).toContainText("real self-host PRD");
    await expect(probe.locator("ol")).toContainText("ordered item");
    await expect(probe.locator("blockquote")).toContainText("real self-host blockquote");
    const tasks = probe.locator('input[type="checkbox"]');
    await expect(tasks).toHaveCount(2);
    await expect(tasks.first()).toBeDisabled();
    await expect(tasks.last()).toBeDisabled();
    await expect(probe.getByRole("link", { name: "Safe source" })).toHaveAttribute(
      "href",
      "https://example.com/spec",
    );
    await expect(probe.getByRole("link", { name: "Relative source" })).toHaveCount(0);
    await expect(probe.getByText("Relative source", { exact: true })).toBeVisible();
    await expect(probe.locator("img")).toHaveCount(0);
    await expect(probe.getByRole("link", { name: "image source" })).toBeVisible();
    expect(
      await page.evaluate(
        () => (globalThis as { __ticket27ActiveContent?: boolean }).__ticket27ActiveContent,
      ),
    ).toBeUndefined();
    await expect(page.locator("main")).not.toContainText("Formatting unavailable");
    const copiedProbeText = await probe.evaluate((element) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? "";
    });
    expect(copiedProbeText).toContain("real self-host blockquote");
    expect(copiedProbeText).toContain("completed task stays disabled");
    await disclosure.getByRole("button", { name: /^Show less:/u }).click();

    for (const width of [640, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(disclosureToggle).toBeVisible();
      const overflow = await page.locator("body *").evaluateAll((elements) =>
        elements.flatMap((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.right > window.innerWidth + 0.5
            ? [{ tag: element.tagName, className: element.className, right: bounds.right }]
            : [];
        }),
      );
      expect(overflow).toEqual([]);
    }
    await page.locator("body").evaluate((body) => {
      body.style.fontSize = "200%";
    });
    await expect(disclosureToggle).toBeVisible();
    expect(
      await page.locator("body *").evaluateAll((elements) =>
        elements.flatMap((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.right > window.innerWidth + 0.5
            ? [{ tag: element.tagName, className: element.className, right: bounds.right }]
            : [];
        }),
      ),
    ).toEqual([]);
    await page.locator("body").evaluate((body) => {
      body.style.fontSize = "";
    });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole("button", { name: "Find in project" }).click();
    const find = page.getByRole("dialog", { name: "Find in project" });
    await find
      .getByRole("searchbox", { name: "Search identity, title, or semantic phrase" })
      .fill("real self-host blockquote stays a blockquote");
    await expect(find.getByRole("option").first()).toContainText(
      "Bearing 0.1.1 Architecture Contraction",
    );
    await page.keyboard.press("Escape");
    await page.screenshot({ path: candidate.screenshotPath, fullPage: true });

    const readModelPattern = "**/api/v1/projects/bearing-self-host/read-model?section=lineage&*";
    const normalResponse = await page.request.get(
      `${portal.url}/api/v1/projects/bearing-self-host/read-model?section=lineage&targetKind=native-subject&targetId=${encodeURIComponent(
        ".scratch/bearing-architecture-contraction/PRD.md",
      )}`,
    );
    const normalEnvelope = portalProjectReadEnvelopeSchema.parse(await normalResponse.json());
    if (normalEnvelope.state !== "ready") {
      throw new Error("Ticket 27 expected a ready PRD read envelope.");
    }
    const fallbackTarget = normalEnvelope.rows.renderedMarkdown.find((entry) =>
      entry.markdown.includes("real self-host PRD"),
    );
    if (fallbackTarget === undefined) {
      throw new Error("Ticket 27 controlled Markdown was absent from the Host response.");
    }
    const injectedFallback = createMarkdownEngine({
      render: () => {
        throw new Error("Ticket 27 deliberate renderer failure");
      },
    }).renderFragment(fallbackTarget.markdown);
    expect(injectedFallback.presentation).toBe("fallback");
    const { renderedMarkdown: _normalRenderedMarkdown, ...normalTrustRows } = normalEnvelope.rows;
    let fallbackReadCount = 0;
    await page.route(readModelPattern, async (route) => {
      const response = await route.fetch();
      const envelope = portalProjectReadEnvelopeSchema.parse(await response.json());
      if (envelope.state !== "ready") throw new Error("Ticket 27 fallback source was not ready.");
      fallbackReadCount += 1;
      const injectedRows = {
        ...envelope.rows,
        renderedMarkdown: envelope.rows.renderedMarkdown.map((entry) =>
          entry.markdown === fallbackTarget.markdown
            ? { markdown: entry.markdown, ...injectedFallback }
            : entry,
        ),
      };
      const { renderedMarkdown: _injectedRenderedMarkdown, ...injectedTrustRows } = injectedRows;
      expect(injectedTrustRows).toEqual(normalTrustRows);
      await route.fulfill({ response, json: { ...envelope, rows: injectedRows } });
    });
    await page.reload();
    await expect(page.locator(".markdown-formatting-fallback")).toHaveCount(1);
    await expect(page.locator(".markdown-formatting-fallback")).toContainText("real self-host PRD");
    expect(fallbackReadCount).toBeGreaterThan(0);
    await page.unroute(readModelPattern);
    await page.reload();
    await expect(page.locator(".markdown-formatting-fallback")).toHaveCount(0);

    await page.goto(`${portal.url}/projects/bearing-self-host`);
    for (const heading of ["At a Glance", "Current Position", "Established Baseline"]) {
      await expect(page.getByRole("heading", { name: heading, level: 3 })).toBeVisible();
    }
    await page.getByRole("button", { name: "Refresh all sources" }).click();
    const refreshConfirmation = page.getByRole("dialog", { name: "Refresh all sources" });
    await expect(refreshConfirmation).toContainText(
      "This reads every current Work Binding. It can be slow and can use provider rate limits.",
    );
    await expect(
      refreshConfirmation.getByRole("button", { name: "Confirm refresh all sources" }),
    ).toBeVisible();
    await refreshConfirmation.getByRole("button", { name: "Cancel" }).click();

    const effortHref = planningLineageSubjectHref("bearing-self-host", {
      kind: "effort",
      id: "effort:bearing-0-1-1-architecture-contraction",
    });
    await page.goto(`${portal.url}${effortHref}`);
    await expect(page.getByRole("heading", { name: "Current Work", level: 2 })).toBeVisible();
    const currentWork = page.locator("#native-work-current");
    const managedCounts = currentWork.getByRole("definition");
    const countValues = await managedCounts.allTextContents();
    expect(countValues).toHaveLength(3);
    for (const count of countValues) expect(count).toMatch(/^(?:At least )?\d+$/u);
    const currentItems = currentWork.locator("[data-work-status]");
    expect(await currentItems.count()).toBeGreaterThan(0);
    for (const status of await currentItems.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-work-status")),
    )) {
      expect(status).toMatch(/^(?:ready|claimed|blocked|needs-attention)$/u);
    }
    const workHistory = page.getByRole("link", { name: /^Full work history · History /u });
    await expect(workHistory).toContainText(`History ${countValues[2]}`);
    await workHistory.click();
    await expect(page.getByRole("heading", { name: "History", level: 3 })).toBeInViewport();
    await expect(page.getByText("Source status", { exact: true }).first()).toBeVisible();
    await expect(page.locator("dt").filter({ hasText: "Checked" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh source" })).toBeVisible();

    const gateHref = planningLineageSubjectHref("bearing-self-host", {
      kind: "gate",
      id: "gate:bearing-0-1-1-g4-live-journey-proven",
    });
    await page.goto(`${portal.url}${gateHref}`);
    await expect(
      page.getByRole("heading", { name: "Contributing Efforts", level: 2 }),
    ).toBeVisible();
    const effortTable = page.getByRole("table", {
      name: "Contributing Effort lifecycle and native work counts",
    });
    await expect(effortTable.getByRole("columnheader")).toHaveText([
      "Effort",
      "Lifecycle",
      "Claimed",
      "Ready",
      "Blocked",
      "Resolved",
      "Lifecycle time",
    ]);
    expect(await effortTable.locator("tbody tr").count()).toBeGreaterThan(0);
    const eventHistory = page.locator('[id="gate.event-history"]');
    await expect(
      eventHistory.getByRole("heading", { name: "Event History", level: 2 }),
    ).toBeVisible();
    for (const width of [1440, 640]) {
      await page.setViewportSize({ width, height: 900 });
      const separation = await eventHistory.evaluate((element) => {
        const previous = element.previousElementSibling;
        if (!(previous instanceof HTMLElement)) return undefined;
        return {
          borderTopStyle: getComputedStyle(element).borderTopStyle,
          gap: element.getBoundingClientRect().top - previous.getBoundingClientRect().bottom,
        };
      });
      expect(separation?.borderTopStyle).toBe("solid");
      expect(separation?.gap).toBeGreaterThanOrEqual(24);
      expect(
        await page.locator("html").evaluate((root) => root.scrollWidth > root.clientWidth),
      ).toBe(false);
    }
    const stackedLifecycle = effortTable.locator('tbody td[data-label="Lifecycle"]').first();
    expect(
      await stackedLifecycle.evaluate((element) => ({
        display: getComputedStyle(element).display,
        label: getComputedStyle(element, "::before").content,
      })),
    ).toEqual({ display: "grid", label: '"Lifecycle"' });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${portal.url}/projects/bearing-self-host/assets`);
    await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Evidence" })).toBeVisible();
    const assetHeader = page.locator(".assets-header");
    const assetTable = page.locator(".asset-table");
    const wideAlignment = await Promise.all(
      [assetHeader, assetTable].map((locator) =>
        locator.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right };
        }),
      ),
    );
    expect(wideAlignment[0]?.left).toBeCloseTo(wideAlignment[1]?.left ?? 0, 0);
    expect(wideAlignment[0]?.right).toBeCloseTo(wideAlignment[1]?.right ?? 0, 0);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator(".asset-controls")).toHaveCSS("grid-template-columns", /\d+px/u);
    const narrowAlignment = await Promise.all(
      [assetHeader, assetTable].map((locator) =>
        locator.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right };
        }),
      ),
    );
    expect(narrowAlignment[0]?.left).toBeCloseTo(narrowAlignment[1]?.left ?? 0, 0);
    expect(narrowAlignment[0]?.right).toBeCloseTo(narrowAlignment[1]?.right ?? 0, 0);
  }

  expect(await changedProviderReads(providerReadMonitor)).toEqual([]);
  expect(await digestReadingTruth(selfHostRoot, homeRoot)).toBe(truthBefore);
  expect(posts).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.locator("html").evaluate((root) => root.scrollWidth > root.clientWidth)).toBe(
    false,
  );
});
