import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPortalApp } from "../src/portal/app";
import {
  type AssetPreviewResolution,
  createAssetPreviewService,
} from "../src/portal/asset-preview";
import type { PortalAssets } from "../src/portal/assets";
import type { CatalogReadResult } from "../src/portal/contract";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

const catalogFor =
  (repoRoot: string): (() => Promise<CatalogReadResult>) =>
  async () => ({
    state: "ready",
    entries: [
      {
        entryId: "project-one",
        displayName: "Project one",
        repoRoot,
        availability: "available",
      },
    ],
  });

const writeAssetRegistry = async (
  repoRoot: string,
  location: string,
  options: Readonly<{ kind?: string; previewEntry?: string }> = {},
): Promise<void> => {
  await writeFixture(
    repoRoot,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:preview
    Title: Preview Asset
    Kind: ${options.kind ?? "context"}
    Location: ${location}
${options.previewEntry === undefined ? "" : `    Preview entry: ${options.previewEntry}\n`}    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: registry
    Disposition: available
---

# Asset Registry
`,
  );
};

const prepareRepo = async (location: string, content: string): Promise<string> => {
  const repoRoot = await realpath(await createValidBearingRepo());
  await writeFixture(repoRoot, location, content);
  await finishPreviewRepo(repoRoot, location);
  return repoRoot;
};

const finishPreviewRepo = async (
  repoRoot: string,
  location: string,
  options: Readonly<{ kind?: string; previewEntry?: string }> = {},
): Promise<void> => {
  await writeAssetRegistry(repoRoot, location, options);
  const effort = await readFile(`${repoRoot}/.bearing/state/efforts/test.md`, "utf8");
  await writeFixture(
    repoRoot,
    ".bearing/state/efforts/test.md",
    effort.replace(
      "Citations: []",
      "Citations:\n  - Asset: asset:preview\n    Note: Preview test evidence.",
    ),
  );
  await runSync(repoRoot, {
    completedAt: "2026-07-31T12:00:00.000Z",
    providerObservationIntent: "initial-baseline",
  });
  await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(repoRoot, "ensure-current");
};

const prepareDirectoryRepo = async (
  location: string,
  files: Readonly<Record<string, string>>,
  options: Readonly<{ kind?: string; previewEntry?: string }> = {},
): Promise<string> => {
  const repoRoot = await realpath(await createValidBearingRepo());
  await mkdir(`${repoRoot}/${location}`, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFixture(repoRoot, `${location}/${relativePath}`, content);
  }
  await finishPreviewRepo(repoRoot, location, options);
  return repoRoot;
};

const resolvePreview = async (
  repoRoot: string,
  assetId = "asset:preview",
): Promise<AssetPreviewResolution> =>
  createAssetPreviewService({ readCatalog: catalogFor(repoRoot) }).resolve("project-one", assetId);

const portalAssets: PortalAssets = {
  manifest: {
    schemaVersion: 1,
    packageVersion: "0.0.0-test",
    interfaceVersion: 1,
    projectSnapshotVersion: 15,
    entry: "index.html",
    buildId: "0".repeat(64),
    assets: [
      {
        path: "index.html",
        contentType: "text/html; charset=utf-8",
        byteLength: 0,
        sha256: "0".repeat(64),
      },
    ],
  },
  get: () => undefined,
};

test("renders a registered Markdown Asset as sanitized current-checkout content", async () => {
  const repoRoot = await prepareRepo(
    "docs/preview.md",
    "# Safe heading\n\n<script>alert('xss')</script>\n",
  );
  try {
    const preview = await resolvePreview(repoRoot);

    expect(preview).toMatchObject({
      kind: "available",
      contentType: "text/html; charset=utf-8",
      source: "current-checkout",
      policyVersion: 1,
    });
    if (preview.kind !== "available") throw new Error("Expected an available preview.");
    const html = preview.body.toString("utf8");
    expect(html).toContain("Safe heading");
    expect(html).toContain("current-checkout content");
    expect(html).not.toContain("<script>");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("sandbox");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("keeps HTML inert and renders SVG through a non-executing image surface", async () => {
  const htmlRoot = await prepareRepo(
    "docs/preview.html",
    "<h1>Safe HTML</h1><form action='/submit'><input name='x'></form><script>alert('xss')</script>",
  );
  const svgRoot = await prepareRepo(
    "images/preview.svg",
    "<svg xmlns='http://www.w3.org/2000/svg'><script>alert('xss')</script><text>Safe SVG</text></svg>",
  );
  try {
    const htmlPreview = await resolvePreview(htmlRoot);
    expect(htmlPreview).toMatchObject({ kind: "available", mediaType: "text/html" });
    if (htmlPreview.kind !== "available") throw new Error("Expected an HTML preview.");
    expect(htmlPreview.body.toString("utf8")).toContain("Safe HTML");
    expect(htmlPreview.body.toString("utf8")).not.toContain("<script");
    expect(htmlPreview.body.toString("utf8")).not.toContain("<form");

    const svgPreview = await resolvePreview(svgRoot);
    expect(svgPreview).toMatchObject({ kind: "available", mediaType: "image/svg+xml" });
    if (svgPreview.kind !== "available") throw new Error("Expected an SVG preview.");
    const svgDocument = svgPreview.body.toString("utf8");
    expect(svgDocument).toContain("<img");
    expect(svgDocument).toContain("data:image/svg+xml;base64,");
    expect(svgDocument).not.toContain("<script");
  } finally {
    await Promise.all([
      rm(htmlRoot, { recursive: true, force: true }),
      rm(svgRoot, { recursive: true, force: true }),
    ]);
  }
});

test("rejects unsupported content without reading it as executable", async () => {
  const repoRoot = await prepareRepo("downloads/payload.bin", "not an executable\n");
  try {
    await expect(resolvePreview(repoRoot)).resolves.toMatchObject({
      kind: "unavailable",
      availability: "unsupported",
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("does not preview a stale registration as historical Snapshot bytes", async () => {
  const repoRoot = await prepareRepo("docs/preview.txt", "before\n");
  try {
    await writeFixture(repoRoot, "docs/preview.txt", "after\n");
    await runSync(repoRoot, {
      completedAt: "2026-07-31T12:01:00.000Z",
      providerObservationIntent: "ordinary-sync",
    });
    await expect(resolvePreview(repoRoot)).resolves.toMatchObject({
      kind: "unavailable",
      code: "stale-registration",
      availability: "preview-entry-missing",
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("serves preview in a credential-free isolated Host surface", async () => {
  const repoRoot = await prepareRepo("docs/preview.md", "# Host preview\n");
  try {
    const app = createPortalApp({
      assets: portalAssets,
      readCatalog: catalogFor(repoRoot),
      sessions: { secret: "ticket-21-preview-session-secret-32-bytes" },
    });
    const response = await app.request(
      "http://127.0.0.1:4178/preview/projects/project-one/assets/asset%3Apreview",
      { headers: { Cookie: "bearing_session=portal-session-must-not-be-forwarded" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-bearing-preview-source")).toBe("current-checkout");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(await response.text()).toContain("Host preview");

    const missing = await app.request(
      "http://127.0.0.1:4178/preview/projects/project-one/assets/asset%3Amissing",
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-bearing-preview-availability")).toBe("preview-entry-missing");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("opens a bounded ordinary directory bundle and sanitizes selected resources", async () => {
  const repoRoot = await prepareDirectoryRepo("docs/bundle", {
    "README.md": "# Bundle README\n",
    "notes.txt": "contained notes\n",
    "payload.bin": "opaque bytes\n",
  });
  try {
    const service = createAssetPreviewService({ readCatalog: catalogFor(repoRoot) });
    const bundle = await service.resolve("project-one", "asset:preview");
    expect(bundle).toMatchObject({
      kind: "available",
      surface: "bundle-browser",
      bundlePolicyVersion: 1,
    });
    if (bundle.kind !== "available") throw new Error("Expected a bundle browser.");
    expect(bundle.body.toString("utf8")).toContain("README.md");
    expect(bundle.body.toString("utf8")).toContain("notes.txt");
    expect(bundle.body.toString("utf8")).not.toContain("payload.bin</a>");

    const selected = await service.resolveResource("project-one", "asset:preview", "README.md");
    expect(selected).toMatchObject({
      kind: "available",
      surface: "bundle-resource",
      mediaType: "text/markdown",
    });
    if (selected.kind !== "available") throw new Error("Expected a selected resource.");
    expect(selected.body.toString("utf8")).toContain("Bundle README");

    await expect(
      service.resolveResource("project-one", "asset:preview", "payload.bin"),
    ).resolves.toMatchObject({ kind: "unavailable", availability: "unsupported" });
    await expect(
      service.resolveResource("project-one", "asset:preview", "../outside.txt"),
    ).resolves.toMatchObject({ kind: "unavailable", availability: "preview-entry-missing" });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("runs only a contained prototype entry and rejects runtime resources", async () => {
  const repoRoot = await prepareDirectoryRepo(
    "prototypes/demo",
    {
      "main.html":
        "<!doctype html><html><head><link rel='stylesheet' href='style.css'></head><body><button id='run'>Run</button><script src='app.js'></script></body></html>",
      "app.js": "document.querySelector('#run').textContent = 'contained';",
      "style.css": "button { color: green; }",
      "data.json": '{"ok":true}',
      "server.mjs": "throw new Error('must never run');",
    },
    { kind: "prototype", previewEntry: "main.html" },
  );
  try {
    const service = createAssetPreviewService({ readCatalog: catalogFor(repoRoot) });
    const prototype = await service.resolve("project-one", "asset:preview");
    expect(prototype).toMatchObject({
      kind: "available",
      surface: "prototype",
      resourcePath: "main.html",
      bundlePolicyVersion: 1,
    });
    if (prototype.kind !== "available") throw new Error("Expected a prototype preview.");
    const document = prototype.body.toString("utf8");
    expect(document).toContain("data-bearing-preview-notice");
    expect(document).toContain("/resource/");
    expect(prototype.contentSecurityPolicy).toContain("connect-src 'none'");
    expect(prototype.contentSecurityPolicy).toContain("form-action 'none'");

    const script = await service.resolveResource("project-one", "asset:preview", "app.js");
    expect(script).toMatchObject({
      kind: "available",
      surface: "bundle-resource",
      contentType: "text/javascript; charset=utf-8",
    });
    if (script.kind !== "available") throw new Error("Expected a contained script.");
    expect(script.body.toString("utf8")).toContain("contained");

    await expect(
      service.resolveResource("project-one", "asset:preview", "server.mjs"),
    ).resolves.toMatchObject({ kind: "unavailable", availability: "unsafe" });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("uses root index.html only as the prototype convention and fails closed when absent", async () => {
  const conventionRoot = await prepareDirectoryRepo(
    "prototypes/convention",
    { "index.html": "<html><body>Convention entry</body></html>" },
    { kind: "prototype" },
  );
  const missingRoot = await prepareDirectoryRepo(
    "prototypes/missing",
    { "start.html": "<html><body>Not a convention entry</body></html>" },
    { kind: "prototype" },
  );
  try {
    await expect(resolvePreview(conventionRoot)).resolves.toMatchObject({
      kind: "available",
      surface: "prototype",
      resourcePath: "index.html",
    });
    await expect(resolvePreview(missingRoot)).resolves.toMatchObject({
      kind: "unavailable",
      availability: "preview-entry-missing",
    });
  } finally {
    await Promise.all([
      rm(conventionRoot, { recursive: true, force: true }),
      rm(missingRoot, { recursive: true, force: true }),
    ]);
  }
});

test("rejects an over-limit directory instead of truncating its navigation", async () => {
  const files = Object.fromEntries(
    Array.from({ length: 129 }, (_, index) => [`file-${index}.txt`, `${index}\n`]),
  );
  const repoRoot = await prepareDirectoryRepo("docs/too-many", files);
  try {
    await expect(resolvePreview(repoRoot)).resolves.toMatchObject({
      kind: "unavailable",
      availability: "exceeds-limit",
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("fails closed for encoded traversal and symlink escape", async () => {
  const repoRoot = await prepareDirectoryRepo("docs/safe-bundle", {
    "README.md": "# safe\n",
  });
  const outsideRoot = await mkdtemp(join(tmpdir(), "bearing-preview-outside-"));
  try {
    const service = createAssetPreviewService({ readCatalog: catalogFor(repoRoot) });
    await expect(
      service.resolveResource("project-one", "asset:preview", "%2e%2e%2Fsecret.txt"),
    ).resolves.toMatchObject({ kind: "unavailable", availability: "preview-entry-missing" });
    await writeFile(join(outsideRoot, "secret.txt"), "outside secret\n");
    await symlink(
      join(outsideRoot, "secret.txt"),
      join(repoRoot, "docs/safe-bundle", "secret.txt"),
    );
    await expect(resolvePreview(repoRoot)).resolves.toMatchObject({
      kind: "unavailable",
      availability: "unsafe",
    });
  } finally {
    await Promise.all([
      rm(repoRoot, { recursive: true, force: true }),
      rm(outsideRoot, { recursive: true, force: true }),
    ]);
  }
});

test("serves prototype bundle resources through the isolated Host route", async () => {
  const repoRoot = await prepareDirectoryRepo(
    "prototypes/route",
    { "index.html": "<html><body>Route prototype</body></html>", "app.js": "console.log('ok');" },
    { kind: "prototype" },
  );
  try {
    const app = createPortalApp({
      assets: portalAssets,
      readCatalog: catalogFor(repoRoot),
      sessions: { secret: "ticket-22-preview-session-secret-32-bytes" },
    });
    const response = await app.request(
      "http://127.0.0.1:4178/preview/projects/project-one/assets/asset%3Apreview",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-bearing-preview-surface")).toBe("prototype");
    expect(response.headers.get("x-bearing-preview-resource")).toBe("index.html");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");

    const resource = await app.request(
      "http://127.0.0.1:4178/preview/projects/project-one/assets/asset%3Apreview/resource/app.js",
    );
    expect(resource.status).toBe(200);
    expect(resource.headers.get("content-type")).toContain("text/javascript");
    expect(resource.headers.get("x-bearing-preview-surface")).toBe("bundle-resource");
    expect(await resource.text()).toContain("console.log");

    const traversal = await app.request(
      "http://127.0.0.1:4178/preview/projects/project-one/assets/asset%3Apreview/resource/%2e%2e%2Fserver.mjs",
    );
    expect(traversal.status).toBe(404);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
