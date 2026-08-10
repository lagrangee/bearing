import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import { copyPortalProjectFixture } from "../tests/fixtures/repository-fixture";
import {
  type RunningTestPortal,
  runBuiltBearing,
  startBuiltPortal,
  stopBuiltPortal,
  writeCatalogFixture,
} from "./real-host-test-support";

let host: RunningTestPortal | undefined;
let homeRoot = "";
let fixtureRoot = "";
let markdownFixtureRoot = "";

const markdownNativeScope = (() => {
  const scope = new URL("github-matt-v1://github.com/example/reference/issues/5");
  scope.searchParams.set("rootKind", "standalone-request");
  scope.searchParams.set("repositoryDatabaseId", "9001");
  scope.searchParams.set("repositoryNodeId", "R_reference");
  scope.searchParams.set("objectDatabaseId", "9105");
  scope.searchParams.set("objectNodeId", "I_reference_5");
  return scope.toString();
})();

const githubContract = `# Issue tracker: GitHub

## Conventions

- Use the \`gh\` CLI for GitHub tracker reads.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run \`gh issue view <number> --comments\`.

## Wayfinding operations

Use one issue with child issues.
`;

const githubTriageMapping = `# Triage Labels

| Label in mattpocock/skills | Label in our tracker | Meaning |
| --- | --- | --- |
| \`needs-triage\` | \`custom-triage\` | Evaluate |
| \`needs-info\` | \`custom-info\` | Waiting |
| \`ready-for-agent\` | \`custom-ready\` | Ready |
| \`ready-for-human\` | \`custom-human\` | Human |
| \`wontfix\` | \`custom-wontfix\` | Rejected |
| \`bug\` | \`custom-bug\` | Defect |
| \`enhancement\` | \`custom-enhancement\` | Feature |
`;

const longBriefCurrentPosition =
  "当前 Roadmap 是 Bearing 0.1.1 Matt-Native Experience，当前 Gate 是 0.1.1 Live Journey Proven。Architecture Contraction 保持 active governing commitment，并收口 Portal 阅读合同。当前验证保持 read-only，provider evidence 与 canonical truth 继续由各自 owner 管理。浏览器只提供 presentation，不执行 Effort、Gate 或 release transition。此段使用多语言文字验证实际 rendered height，而不依赖 character、word 或 token 数量。展开与收起只改变视觉呈现，完整文字始终保留在同一个可搜索、可复制、可打印的 authored content 节点中。响应式宽度、字体缩放和窄屏会重新测量真实布局，但不会写入 Bearing State、Project Read Model、Project Catalog、provider evidence 或 native source。";

const projectBrief = `---
Type: project-brief
ID: project-brief:current
Generated at: 2026-08-10T00:00:00.000Z
Languages:
  At a Glance: zh-CN
  Current Position: zh-CN
  Established Baseline: zh-CN
---

# Project Brief

## At a Glance

Portal 保持 read-only。

## Current Position

${longBriefCurrentPosition}

## Established Baseline

- Provider Markdown 保留 authored structure。
- Canonical prose 保留 typed meaning。
- Disclosure 只属于当前 route UI session。
- Human acceptance 仍独立于自动 evidence。
- Print 和 copy 保留完整 authored content。
`;

test.beforeAll(async () => {
  fixtureRoot = await realpath(await copyPortalProjectFixture("G3 Preview Project"));
  await mkdir(join(fixtureRoot, "prototypes/demo"), { recursive: true });
  await mkdir(join(fixtureRoot, "docs/bundle"), { recursive: true });
  await mkdir(join(fixtureRoot, ".bearing/state/authorities"), { recursive: true });
  await Promise.all([
    writeFile(
      join(fixtureRoot, "prototypes/demo/index.html"),
      "<!doctype html><html><head><title>G3 prototype</title></head><body><h1>Prototype</h1><p id='state'>Waiting</p><a href='https://example.com'>External destination</a><script src='app.js'></script></body></html>\n",
    ),
    writeFile(
      join(fixtureRoot, "prototypes/demo/app.js"),
      "globalThis.__bearingPrototypeResourceLoaded = true; document.querySelector('#state').textContent = 'Prototype static script loaded';\n",
    ),
    writeFile(
      join(fixtureRoot, "prototypes/demo/server.mjs"),
      "throw new Error('must not run');\n",
    ),
    writeFile(
      join(fixtureRoot, "docs/reading.html"),
      "<article><h1>G3 reading document</h1><p>Sanitized inert HTML.</p><script>globalThis.__mustNotRun = true</script></article>\n",
    ),
    writeFile(join(fixtureRoot, "docs/payload.bin"), "opaque\n"),
    writeFile(join(fixtureRoot, "docs/bundle/README.md"), "# Directory member\n"),
    writeFile(
      join(fixtureRoot, ".bearing/state/authorities/product-design.md"),
      `---
Type: authority
ID: authority:product-design
Title: Product Design
Baseline:
  - asset:g3-reading-document
---

# Product Design Authority

## Scope

Own the Portal reading presentation.

## Current Baseline

The registered reading document is the current design baseline.
`,
    ),
    writeFile(
      join(fixtureRoot, ".scratch/work/issues/02-review-compact-facts.md"),
      `# Review compact facts

Type: task

## Question

Can current and resolved Work remain an exhaustive partition?
`,
    ),
  ]);
  const assetsPath = join(fixtureRoot, ".bearing/state/assets.md");
  const briefPath = join(fixtureRoot, ".bearing/state/project-brief.md");
  const localEffortPath = join(fixtureRoot, ".bearing/state/efforts/fixture.md");
  const gatePath = join(fixtureRoot, ".bearing/state/milestone-gates/fixture.md");
  const assets = await readFile(assetsPath, "utf8");
  const localEffort = await readFile(localEffortPath, "utf8");
  const gate = await readFile(gatePath, "utf8");
  const mapPath = join(fixtureRoot, ".scratch/work/map.md");
  const map = await readFile(mapPath, "utf8");
  await writeFile(
    assetsPath,
    assets.replace(
      "---\n\n# Asset Registry",
      `  - ID: asset:g3-prototype\n    Title: G3 Prototype\n    Purpose: Preserve the accepted interaction direction.\n    Kind: prototype\n    Source: prototypes/demo\n    Owner: effort:fixture\n    Added at: null\n    Disposition: active\n  - ID: asset:g3-reading-document\n    Title: G3 Reading Document\n    Purpose: Keep the durable reading reference available.\n    Kind: reference\n    Source: docs/reading.html\n    Owner: effort:fixture\n    Added at: null\n    Disposition: active\n  - ID: asset:g3-directory\n    Title: G3 Directory Asset\n    Purpose: Keep the durable directory reference available.\n    Kind: reference\n    Source: docs/bundle\n    Owner: effort:fixture\n    Added at: null\n    Disposition: active\n  - ID: asset:g3-unsupported\n    Title: G3 Unsupported Content\n    Purpose: Keep the durable opaque reference available.\n    Kind: reference\n    Source: docs/payload.bin\n    Owner: effort:fixture\n    Added at: null\n    Disposition: active\n---\n\n# Asset Registry`,
    ),
  );
  await writeFile(briefPath, projectBrief);
  await writeFile(
    localEffortPath,
    localEffort.replace("Activated at: null", "Activated at: 2026-08-03T15:39:36.000Z"),
  );
  await writeFile(
    gatePath,
    gate.replace(
      "- Deterministic fixture checks pass.",
      `- Deterministic fixture checks pass.
- Provider Markdown keeps headings.
- Provider Markdown keeps nested and task lists.
- Canonical prose keeps its typed meaning.
- Disclosure uses actual rendered height.
- Keyboard and pointer behavior are equivalent.
- Print and copy expose complete content.
- Portal performs no canonical or native mutation.`,
    ),
  );
  await writeFile(
    mapPath,
    map
      .replace("Status: resolved", "Status: active")
      .replace(
        "Keep the repository fixture deterministic.",
        `Keep the repository fixture **deterministic** with *readable* \`code\` and ~~retired text~~.

### Safe reading

> Host rendering stays bounded.

- [x] Disabled task
  - Nested item

| Surface | Result |
| --- | --- |
| Portal | Safe |

[Safe source](https://example.com/spec) [Relative source](../PRD.md) [Unsafe source](javascript:alert(1))

![Remote diagram](https://images.example.test/diagram.png)

<script>globalThis.__providerMarkdownRan = true</script>`,
      )
      .replace(
        "## Fog",
        "- [Review compact facts](issues/02-review-compact-facts.md) — Preserve the Work partition.\n\n## Fog",
      ),
  );
  await runBuiltBearing(["provider", "capture", "--repo", fixtureRoot, "--scope", ".scratch/work"]);

  markdownFixtureRoot = await realpath(
    await copyPortalProjectFixture("Safe Markdown Browser Proof"),
  );
  await Promise.all([
    writeFile(join(markdownFixtureRoot, "docs/agents/issue-tracker.md"), githubContract),
    writeFile(join(markdownFixtureRoot, "docs/agents/triage-labels.md"), githubTriageMapping),
  ]);
  const effortPath = join(markdownFixtureRoot, ".bearing/state/efforts/fixture.md");
  const effort = await readFile(effortPath, "utf8");
  await writeFile(
    effortPath,
    effort.replace("Native scope: .scratch/work", `Native scope: ${markdownNativeScope}`),
  );
  const githubIssueBody = `# Authored H1

[Visible source](https://example.com/visible)

## Authored H2

### Authored H3

#### Authored H4

##### Authored H5

###### Authored H6

1. Ordered item
   - Nested item
   - [x] Disabled task

> Host rendering stays bounded.

\`\`\`ts
const safe = true;
\`\`\`

| Surface | Result |
| --- | --- |
| Portal | **Safe** and *readable* with ~~retired text~~ plus \`code\` |

[Safe source](https://example.com/spec) [Relative source](../PRD.md) [Unsafe source](javascript:alert(1))

![Remote diagram](https://images.example.test/diagram.png)

<script>globalThis.__providerMarkdownRan = true</script>`;
  const fixtures = {
    "repos/example/reference": {
      status: 200,
      headers: { etag: '"repo-v1"' },
      body: {
        id: 9001,
        node_id: "R_reference",
        name: "reference",
        full_name: "example/reference",
        html_url: "https://github.com/example/reference",
        owner: { login: "example", id: 90, node_id: "U_example" },
      },
    },
    "repos/example/reference/issues/5": {
      status: 200,
      headers: { etag: '"issue-5-markdown-v1"' },
      body: {
        id: 9105,
        node_id: "I_reference_5",
        number: 5,
        html_url: "https://github.com/example/reference/issues/5",
        repository_url: "https://api.github.com/repos/example/reference",
        title: "Read the complete authored syntax",
        body: githubIssueBody,
        state: "open",
        state_reason: null,
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-02T00:00:00Z",
        closed_at: null,
        closed_by: null,
        labels: [
          { id: 1, node_id: "L_bug", name: "custom-bug" },
          { id: 2, node_id: "L_ready", name: "custom-ready" },
          { id: 3, node_id: "L_scope", name: "same-project" },
        ],
        assignees: [],
        milestone: null,
        user: { login: "reporter", id: 91, node_id: "U_reporter" },
        author_association: "CONTRIBUTOR",
      },
    },
    "repos/example/reference/issues/5/comments?per_page=100&page=1": {
      status: 200,
      headers: { etag: '"comments-5-markdown-v1"' },
      body: [
        {
          id: 9501,
          node_id: "IC_9501",
          html_url: "https://github.com/example/reference/issues/5#issuecomment-9501",
          body: "- [ ] Short authored note.",
          user: { login: "lago", id: 9502, node_id: "U_lago" },
          created_at: "2026-07-20T00:00:00Z",
          updated_at: "2026-07-20T00:00:00Z",
          author_association: "OWNER",
        },
      ],
    },
    "repos/example/reference/issues/5/dependencies/blocked_by?per_page=100&page=1": {
      status: 200,
      headers: { etag: '"dependencies-5-markdown-v1"' },
      body: [],
    },
    "repos/example/reference/issues/5/parent": {
      status: 404,
      headers: {},
      body: { message: "Not Found" },
    },
  };
  const fakeBin = join(markdownFixtureRoot, ".bearing-test-bin");
  const fixturePath = join(fakeBin, "github-responses.json");
  await mkdir(fakeBin, { recursive: true });
  await writeFile(fixturePath, JSON.stringify(fixtures));
  const fakeGh = join(fakeBin, "gh");
  await writeFile(
    fakeGh,
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const endpoint = process.argv.at(-1);
const responses = JSON.parse(readFileSync(process.env.BEARING_GH_FIXTURES, "utf8"));
const response = responses[endpoint];
if (response === undefined) {
  process.stderr.write(\`missing fixture: \${endpoint}\\n\`);
  process.exit(1);
}
const conditional = process.argv.some((argument) => argument.startsWith("If-None-Match:"));
const status = conditional ? 304 : response.status;
const headers = conditional ? { etag: response.headers.etag } : response.headers;
process.stdout.write(\`HTTP/2.0 \${status} Fixture\\r\\n\`);
for (const [name, value] of Object.entries(headers)) {
  if (value !== undefined) process.stdout.write(\`\${name}: \${value}\\r\\n\`);
}
process.stdout.write(\`\\r\\n\${status === 304 ? "" : JSON.stringify(response.body ?? null)}\`);
`,
  );
  await chmod(fakeGh, 0o755);
  await runBuiltBearing(
    ["provider", "capture", "--repo", markdownFixtureRoot, "--scope", markdownNativeScope],
    {
      ...process.env,
      BEARING_GH_FIXTURES: fixturePath,
      PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
    },
  );

  homeRoot = await mkdtemp(join(tmpdir(), "bearing-g3-preview-browser-home-"));
  await mkdir(join(homeRoot, ".bearing"), { recursive: true });
  await writeCatalogFixture(homeRoot, [
    { entryId: "g3-preview", repoRoot: fixtureRoot, displayName: "G3 Preview Project" },
    {
      entryId: "g3-markdown",
      repoRoot: markdownFixtureRoot,
      displayName: "Safe Markdown Browser Proof",
    },
  ]);
  host = await startBuiltPortal(homeRoot);
});

test.afterAll(async () => {
  await stopBuiltPortal(host);
  await Promise.all(
    [homeRoot, fixtureRoot, markdownFixtureRoot]
      .filter((root) => root.length > 0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("real Provider to v21 to Host render stays safe and read-only", async ({ page }) => {
  if (host === undefined) throw new Error("Ticket 25 real Host did not start.");
  const posts: string[] = [];
  const remoteImageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
    if (new URL(request.url()).hostname === "images.example.test") {
      remoteImageRequests.push(request.url());
    }
  });

  await page.goto(
    `${host.url}${planningLineageSubjectHref("g3-markdown", {
      kind: "native-subject",
      id: "github:R_reference:I_reference_5",
    })}`,
  );
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    await expect(page.getByRole("heading", { name: `Authored H${level}`, level })).toBeVisible();
  }
  await expect(page.locator(".provider-markdown ol")).toContainText("Ordered item");
  await expect(page.locator(".provider-markdown pre code")).toContainText("const safe = true;");
  await expect(page.locator(".provider-markdown blockquote")).toContainText(
    "Host rendering stays bounded.",
  );
  await expect(page.locator(".provider-markdown table")).toContainText("Portal");
  await expect(page.locator(".provider-markdown strong")).toContainText("Safe");
  await expect(page.locator(".provider-markdown em")).toContainText("readable");
  await expect(page.locator(".provider-markdown s")).toContainText("retired text");
  const taskCheckboxes = page.locator('.provider-markdown input[type="checkbox"]');
  await expect(taskCheckboxes).toHaveCount(2);
  await expect(taskCheckboxes.nth(0)).toBeDisabled();
  await expect(taskCheckboxes.nth(1)).toBeDisabled();
  await expect(page.getByRole("link", { name: "Safe source" })).toHaveAttribute(
    "href",
    "https://example.com/spec",
  );
  await expect(page.getByRole("link", { name: "Relative source" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Unsafe source" })).toHaveCount(0);
  await expect(page.locator(".provider-markdown img")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "image source" })).toHaveAttribute(
    "href",
    "https://images.example.test/diagram.png",
  );
  expect(
    await page.evaluate(
      () => (globalThis as { __providerMarkdownRan?: boolean }).__providerMarkdownRan,
    ),
  ).toBeUndefined();
  expect(posts).toEqual([]);
  expect(remoteImageRequests).toEqual([]);
});

test("shared disclosure responds to rendered height without changing authored content", async ({
  page,
}) => {
  if (host === undefined) throw new Error("Ticket 26 real Host did not start.");
  const posts: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    `${host.url}${planningLineageSubjectHref("g3-markdown", {
      kind: "native-subject",
      id: "github:R_reference:I_reference_5",
    })}`,
  );

  const longMarkdown = page.locator(".read-disclosure", {
    has: page.getByText("Authored H1", { exact: true }),
  });
  const longMarkdownContent = longMarkdown.locator(".read-disclosure-content");
  const markdownToggle = longMarkdown.locator(".read-disclosure-toggle");
  await expect(markdownToggle).toHaveCount(1);
  await expect(markdownToggle).toHaveAccessibleName(/^Show more:/u);
  await expect(markdownToggle).toHaveAttribute("aria-expanded", "false");
  const markdownContentId = await longMarkdownContent.getAttribute("id");
  if (markdownContentId === null) throw new Error("Disclosure content needs a stable control ID.");
  await expect(markdownToggle).toHaveAttribute("aria-controls", markdownContentId);
  const collapsedMeasure = await longMarkdownContent.evaluate((element) => ({
    clientHeight: element.clientHeight,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    scrollHeight: element.scrollHeight,
  }));
  expect(collapsedMeasure.scrollHeight).toBeGreaterThan(collapsedMeasure.clientHeight);
  expect(collapsedMeasure.clientHeight).toBeLessThanOrEqual(collapsedMeasure.lineHeight * 6 + 1);
  expect(
    await longMarkdownContent.evaluate(
      (element) => getComputedStyle(element, "::after").backgroundImage,
    ),
  ).not.toBe("none");

  await markdownToggle.focus();
  await markdownToggle.press("Shift+Tab");
  await expect(longMarkdown.getByRole("link", { name: "Visible source" })).toBeFocused();
  await expect(longMarkdown.getByRole("link", { name: "Safe source" })).toHaveAttribute(
    "tabindex",
    "-1",
  );
  await markdownToggle.focus();
  await markdownToggle.press("Enter");
  await expect(markdownToggle).toBeFocused();
  await expect(markdownToggle).toHaveAttribute("aria-expanded", "true");
  await expect(markdownToggle).toHaveAccessibleName(/^Show less:/u);
  expect(
    await longMarkdownContent.evaluate((element) => element.clientHeight === element.scrollHeight),
  ).toBe(true);
  await markdownToggle.press("Shift+Tab");
  await expect(longMarkdown.locator("a:focus")).toHaveCount(1);
  await expect(longMarkdown.getByRole("link", { name: "Safe source" })).not.toHaveAttribute(
    "tabindex",
    "-1",
  );
  await markdownToggle.focus();
  await markdownToggle.press("Space");
  await expect(markdownToggle).toBeFocused();
  await expect(markdownToggle).toHaveAttribute("aria-expanded", "false");

  const selectedText = await longMarkdownContent.evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? "";
  });
  expect(selectedText).toContain("const safe = true;");
  expect(selectedText).toContain("Remote diagram");

  const shortMarkdown = page.locator(".read-disclosure", {
    has: page.getByText("Short authored note.", { exact: true }),
  });
  await expect(shortMarkdown.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Disabled task" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Short authored note." })).toBeVisible();
  await expect(page.locator('[id^="task-item-"]')).toHaveCount(0);

  await page.emulateMedia({ media: "print" });
  expect(
    await longMarkdownContent.evaluate((element) => ({
      maxHeight: getComputedStyle(element).maxHeight,
      overflow: getComputedStyle(element).overflow,
      complete: element.clientHeight === element.scrollHeight,
    })),
  ).toEqual({ maxHeight: "none", overflow: "visible", complete: true });
  await expect(markdownToggle).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${host.url}/projects/g3-preview`);
  const shortCanonical = page.locator(".read-disclosure", {
    has: page.getByText("Portal 保持 read-only。", { exact: true }),
  });
  await expect(shortCanonical.getByRole("button")).toHaveCount(0);
  const longCanonical = page.locator(".read-disclosure", {
    has: page.getByText(longBriefCurrentPosition, { exact: true }),
  });
  const canonicalToggle = longCanonical.locator(".read-disclosure-toggle");
  await expect(canonicalToggle).toHaveCount(0);
  // A 1280 CSS-pixel reading surface at 200% browser zoom reflows at 640 CSS pixels.
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(canonicalToggle).toHaveAccessibleName(/^Show more:/u);
  await expect(canonicalToggle).toHaveAttribute("aria-expanded", "false");
  await canonicalToggle.click();
  await expect(canonicalToggle).toHaveAccessibleName(/^Show less:/u);

  await page.goto(
    `${host.url}${planningLineageSubjectHref("g3-preview", {
      kind: "gate",
      id: "gate:fixture",
    })}`,
  );
  const exitCriteria = page.getByRole("heading", { name: "Exit Criteria", level: 2 });
  const exitDisclosure = exitCriteria.locator("xpath=following-sibling::*[1]");
  await expect(exitDisclosure.getByRole("button", { name: /^Show more:/u })).toBeVisible();

  await page.goto(
    `${host.url}${planningLineageSubjectHref("g3-preview", {
      kind: "native-subject",
      id: ".scratch/work/map.md",
    })}`,
  );
  const destinationDisclosure = page.locator(".read-disclosure", {
    has: page.getByRole("heading", { name: "Safe reading", level: 3 }),
  });
  const destinationToggle = destinationDisclosure.locator(".read-disclosure-toggle");
  await expect(destinationToggle).toHaveAccessibleName(/^Show more:/u);
  await destinationToggle.click();
  await expect(destinationToggle).toHaveAttribute("aria-expanded", "true");
  const issueHref = planningLineageSubjectHref("g3-preview", {
    kind: "native-subject",
    id: ".scratch/work/issues/01-verify-isolation.md",
  });
  await page.evaluate((href) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, issueHref);
  await expect(
    page.getByRole("heading", { name: "Verify repository isolation", level: 1 }),
  ).toBeVisible();
  const mapHref = planningLineageSubjectHref("g3-preview", {
    kind: "native-subject",
    id: ".scratch/work/map.md",
  });
  await page.evaluate((href) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, mapHref);
  await expect(destinationDisclosure.getByRole("button", { name: /^Show more:/u })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  for (const width of [375, 640]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 450 });
    await page.goto(
      `${host.url}${planningLineageSubjectHref("g3-markdown", {
        kind: "native-subject",
        id: "github:R_reference:I_reference_5",
      })}`,
    );
    await expect(page.getByRole("button", { name: /^Show more:/u }).first()).toBeVisible();
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
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto(`${host.url}/projects/g3-preview`);
  const responsiveCanonical = page.locator(".read-disclosure", {
    has: page.getByText(longBriefCurrentPosition, { exact: true }),
  });
  await expect(responsiveCanonical.locator(".read-disclosure-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(responsiveCanonical.locator(".read-disclosure-toggle")).toHaveCount(0);
  await page.locator("body").evaluate((body) => {
    body.style.fontSize = "200%";
  });
  await expect(responsiveCanonical.getByRole("button", { name: /^Show more:/u })).toBeVisible();
  await page.locator("body").evaluate((body) => {
    body.style.fontSize = "";
  });
  expect(posts).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("compact Portal facts, statuses, Asset routes, and Work partitions hold on the real Host", async ({
  page,
}) => {
  if (host === undefined) throw new Error("Ticket 29 real Host did not start.");
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    `${host.url}${planningLineageSubjectHref("g3-preview", {
      kind: "roadmap",
      id: "roadmap:fixture",
    })}`,
  );
  const roadmapStatuses = page.locator(".lineage-header-status .lineage-status-tag");
  await expect(roadmapStatuses).toHaveCount(1);
  await expect(roadmapStatuses).toHaveText("Active");
  await expect(roadmapStatuses).toHaveAttribute("data-status-token", "lifecycle-active");
  await roadmapStatuses.focus();
  await expect(roadmapStatuses).toBeFocused();
  await expect(roadmapStatuses).toHaveAttribute("data-tooltip", "This lifecycle is active.");

  await page.goto(
    `${host.url}${planningLineageSubjectHref("g3-preview", {
      kind: "gate",
      id: "gate:fixture",
    })}`,
  );
  await expect(
    page.locator('.lineage-status-tag[data-status-token="position-current"]'),
  ).toHaveText("Current");
  await expect(
    page.locator('.lineage-status-tag[data-status-token="lifecycle-active"]'),
  ).toHaveText("Active");
  const notReadyStatus = page.locator(
    '.lineage-status-tag[data-status-token="readiness-not-ready"]',
  );
  await expect(notReadyStatus).toHaveText("Not ready for passage");
  await expect(notReadyStatus).toHaveAttribute(
    "data-tooltip",
    "Current evidence does not establish readiness for human Gate Passage review.",
  );
  const compactSourceTime = page.locator(".effort-rollup-table .source-event-time.compact").first();
  await expect(compactSourceTime).toHaveAttribute("data-absolute", /.+/u);
  await compactSourceTime.focus();
  await expect(compactSourceTime).toBeFocused();

  const effortHref = planningLineageSubjectHref("g3-preview", {
    kind: "effort",
    id: "effort:fixture",
  });
  await page.goto(`${host.url}${effortHref}`);
  await expect(page.getByRole("heading", { name: "Work (2)", level: 2 })).toBeVisible();
  const countRows = page.locator(".effort-work-counts > div");
  await expect(countRows.filter({ hasText: "Current" }).getByRole("link")).toHaveText("1");
  await expect(countRows.filter({ hasText: "Resolved" }).getByRole("link")).toHaveText("1");
  await countRows.filter({ hasText: "Current" }).getByRole("link").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#native-work-current$/u);
  await expect(page.getByRole("heading", { name: "Planning Basis", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Work (2)", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current", level: 3 })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Resolved", level: 3 })).toBeVisible();
  await expect(page.getByRole("link", { name: /^All ·/u })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("sha256:");

  const wideFact = page.locator(".matt-map-chapter .lineage-compact-facts > div").first();
  const wideLayout = await wideFact.evaluate((row) => {
    const label = row.querySelector("dt")?.getBoundingClientRect();
    const value = row.querySelector("dd")?.getBoundingClientRect();
    const style = getComputedStyle(row);
    return {
      alignItems: style.alignItems,
      display: style.display,
      flexWrap: style.flexWrap,
      labelTop: label?.top ?? -1,
      valueTop: value?.top ?? -1,
    };
  });
  expect(wideLayout).toMatchObject({ display: "flex", flexWrap: "wrap", alignItems: "baseline" });
  expect(Math.abs(wideLayout.labelTop - wideLayout.valueTop)).toBeLessThan(8);

  const checkedTime = page.locator(".provider-observation-time").first();
  await expect(checkedTime).toBeVisible();
  await expect(checkedTime).toHaveAttribute("data-absolute", /.+/u);
  await checkedTime.focus();
  await expect(checkedTime).toBeFocused();

  await page.goto(
    `${host.url}${planningLineageSubjectHref("g3-preview", {
      kind: "authority",
      id: "authority:product-design",
    })}`,
  );
  const baselineAsset = page.getByRole("link", { name: "asset:g3-reading-document" });
  await expect(baselineAsset).toHaveAttribute(
    "href",
    planningLineageSubjectHref("g3-preview", {
      kind: "asset",
      id: "asset:g3-reading-document",
    }),
  );
  await baselineAsset.click();
  await expect(page.getByRole("heading", { name: "G3 Reading Document", level: 1 })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(
    `${host.url}${planningLineageSubjectHref("g3-preview", {
      kind: "native-scope",
      id: ".scratch/work",
    })}`,
  );
  const narrowFact = page.locator(".matt-map-chapter .lineage-compact-facts > div").first();
  const narrowLayout = await narrowFact.evaluate((row) => {
    const label = row.querySelector("dt")?.getBoundingClientRect();
    const value = row.querySelector("dd")?.getBoundingClientRect();
    return { labelBottom: label?.bottom ?? -1, valueTop: value?.top ?? -1 };
  });
  expect(narrowLayout.valueTop).toBeGreaterThan(narrowLayout.labelBottom);
  expect(posts).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("prototype stays semantic-only while an ordinary HTML document keeps inert View Content", async ({
  context,
  page,
}) => {
  if (host === undefined) throw new Error("Ticket 22 real Host did not start.");
  await page.goto(host.url);
  await page
    .getByRole("list", { name: "Registered Bearing projects" })
    .getByRole("link", { name: /G3 Preview Project/u })
    .click();
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  await page.goto(`${host.url}/projects/g3-preview/assets`);
  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Quick Look/u })).toHaveCount(0);

  await page.getByRole("link", { name: /G3 Prototype/u }).press("Enter");
  await expect(page.getByRole("heading", { name: "G3 Prototype", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /View Content/u })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open Preview/u })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Asset Identity" })).toBeVisible();
  await expect(page.getByText("prototype", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Preserve the accepted interaction direction.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ownership and Purpose" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fixture Work" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lifecycle" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source" })).toBeVisible();
  await expect(page.getByText("directory", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Planning Use" })).toBeVisible();
  await expect(
    page
      .getByLabel("Lineage Context")
      .getByRole("heading", { name: "Planning Citations", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open Technical Details" }).press("Enter");
  const technicalDetails = page.getByRole("complementary", { name: "Technical Details" });
  await expect(technicalDetails.getByText("prototypes/demo", { exact: true })).toBeVisible();
  await expect(technicalDetails.getByText("active", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const prototypeRoot = await page.request.get(
    `${host.url}/preview/projects/g3-preview/assets/asset%3Ag3-prototype`,
  );
  expect(prototypeRoot.status()).toBe(404);
  expect(prototypeRoot.headers()["x-bearing-preview-availability"]).toBe("not-offered");
  expect(await prototypeRoot.text()).not.toContain("Prototype static script loaded");
  const prototypeScript = await page.request.get(
    `${host.url}/preview/projects/g3-preview/assets/asset%3Ag3-prototype/resource/app.js`,
  );
  expect(prototypeScript.status()).toBe(404);
  expect(prototypeScript.headers()["x-bearing-preview-availability"]).toBeUndefined();
  expect(await prototypeScript.text()).not.toContain("__bearingPrototypeResourceLoaded");

  await page.goto(`${host.url}/projects/g3-preview/assets`);
  await page.getByRole("link", { name: /G3 Reading Document/u }).click();
  const documentTab = context.waitForEvent("page");
  await page.getByRole("link", { name: /View Content/u }).click();
  const documentPage = await documentTab;
  await expect(documentPage.getByRole("heading", { name: "G3 reading document" })).toBeVisible();
  await expect(documentPage.getByText("Sanitized inert HTML.", { exact: true })).toBeVisible();
  await expect(documentPage.getByText("current-checkout content", { exact: false })).toBeVisible();
  await expect(documentPage.locator("script")).toHaveCount(0);
  await expect(
    documentPage.getByRole("button", { name: "Return to Asset detail" }),
  ).toHaveAttribute(
    "data-bearing-return-href",
    "/projects/g3-preview/lineage/asset/asset%3Ag3-reading-document",
  );
  await documentPage.close();

  await page.goto(`${host.url}/projects/g3-preview/assets`);
  await page.getByRole("link", { name: /G3 Directory Asset/u }).click();
  await expect(page.getByRole("link", { name: /View Content/u })).toHaveCount(0);
  await page.getByRole("button", { name: "Open Technical Details" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Technical Details" })
      .getByText("docs/bundle", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(`${host.url}/projects/g3-preview/assets`);
  await page.getByRole("link", { name: /G3 Unsupported Content/u }).click();
  const unavailableTab = context.waitForEvent("page");
  await page.getByRole("link", { name: /View Content/u }).click();
  const unavailablePage = await unavailableTab;
  await expect(unavailablePage.getByRole("heading", { name: "Content unavailable" })).toBeVisible();
  await expect(unavailablePage.getByText(/^Impact:/u)).toBeVisible();
  await expect(unavailablePage.getByText(/^Recovery:/u)).toBeVisible();
  await expect(
    unavailablePage.getByRole("button", { name: "Return to Asset detail" }),
  ).toHaveAttribute(
    "data-bearing-return-href",
    "/projects/g3-preview/lineage/asset/asset%3Ag3-unsupported",
  );
  await unavailablePage.close();
});
