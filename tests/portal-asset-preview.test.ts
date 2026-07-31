import { expect, test } from "bun:test";
import { readFile, realpath, rm } from "node:fs/promises";
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

const writeAssetRegistry = async (repoRoot: string, location: string): Promise<void> => {
  await writeFixture(
    repoRoot,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:preview
    Title: Preview Asset
    Kind: context
    Location: ${location}
    Owner: effort:test
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
  await writeAssetRegistry(repoRoot, location);
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
    projectSnapshotVersion: 13,
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
