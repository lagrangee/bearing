import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test.beforeAll(async () => {
  fixtureRoot = await realpath(await copyPortalProjectFixture("G3 Preview Project"));
  await mkdir(join(fixtureRoot, "prototypes/demo"), { recursive: true });
  await mkdir(join(fixtureRoot, "docs/bundle"), { recursive: true });
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
  ]);
  const assetsPath = join(fixtureRoot, ".bearing/state/assets.md");
  const assets = await readFile(assetsPath, "utf8");
  const mapPath = join(fixtureRoot, ".scratch/work/map.md");
  const map = await readFile(mapPath, "utf8");
  await writeFile(
    assetsPath,
    assets.replace(
      "---\n\n# Asset Registry",
      `  - ID: asset:g3-prototype\n    Title: G3 Prototype\n    Purpose: Preserve the accepted interaction direction.\n    Kind: prototype\n    Source: prototypes/demo\n    Owner: effort:fixture\n    Added at: null\n    Disposition: active\n  - ID: asset:g3-reading-document\n    Title: G3 Reading Document\n    Purpose: Keep the durable reading reference available.\n    Kind: reference\n    Source: docs/reading.html\n    Owner: effort:fixture\n    Added at: null\n    Disposition: active\n  - ID: asset:g3-directory\n    Title: G3 Directory Asset\n    Purpose: Keep the durable directory reference available.\n    Kind: reference\n    Source: docs/bundle\n    Owner: effort:fixture\n    Added at: null\n    Disposition: active\n  - ID: asset:g3-unsupported\n    Title: G3 Unsupported Content\n    Purpose: Keep the durable opaque reference available.\n    Kind: reference\n    Source: docs/payload.bin\n    Owner: effort:fixture\n    Added at: null\n    Disposition: active\n---\n\n# Asset Registry`,
    ),
  );
  await writeFile(
    mapPath,
    map.replace(
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
      body: [],
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
  await expect(page.locator('.provider-markdown input[type="checkbox"]')).toBeDisabled();
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
