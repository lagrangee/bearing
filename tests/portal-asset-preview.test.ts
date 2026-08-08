import { expect, test } from "bun:test";
import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { createPortalApp } from "../src/portal/app";
import {
  type AssetPreviewResolution,
  createAssetPreviewService,
} from "../src/portal/asset-preview";
import type { PortalAssets } from "../src/portal/assets";
import type { CatalogReadResult } from "../src/portal/contract";
import { materializeProjectReadModelCandidate } from "../src/project-read-model/inspect";
import { PortalProjectReadModelUnavailableError } from "../src/project-read-model/portal";
import type { ProjectReadModelCandidate } from "../src/project-read-model/store";
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

const candidates = new Map<string, ProjectReadModelCandidate>();

const previewService = (repoRoot: string) =>
  createAssetPreviewService({
    readCatalog: catalogFor(repoRoot),
    readAssetRow: async (root, assetId) => {
      const candidate = candidates.get(root);
      if (candidate === undefined) throw new Error("Preview fixture has no typed rows.");
      const state = candidate.objects.find((row) => row.reference === "portal-projection:assets");
      if (state === undefined) throw new Error("Preview fixture has no Assets state.");
      const stateValue = JSON.parse(state.payload) as { validity?: string };
      if (stateValue.validity === "invalid") return { state: "unavailable" };
      const row = candidate.objects.find(
        (candidateRow) => candidateRow.kind === "asset" && candidateRow.reference === assetId,
      );
      if (row !== undefined) return { state: "available", asset: JSON.parse(row.payload) };
      return stateValue.validity === "partial" ? { state: "unavailable" } : { state: "missing" };
    },
  });

const writeAssetRegistry = async (
  repoRoot: string,
  location: string,
  options: Readonly<{ kind?: string }> = {},
): Promise<void> => {
  await writeFixture(
    repoRoot,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:preview
    Title: Preview Asset
    Purpose: Exercise one exact Asset preview source.
    Kind: ${options.kind ?? "reference"}
    Source: ${location}
    Owner: effort:test
    Added at: null
    Disposition: active
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
  options: Readonly<{ kind?: string }> = {},
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
  candidates.set(repoRoot, await materializeProjectReadModelCandidate(repoRoot));
};

const prepareDirectoryRepo = async (
  location: string,
  files: Readonly<Record<string, string>>,
  options: Readonly<{ kind?: string }> = {},
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
): Promise<AssetPreviewResolution> => previewService(repoRoot).resolve("project-one", assetId);

const portalAssets: PortalAssets = {
  manifest: {
    schemaVersion: 1,
    packageVersion: "0.0.0-test",
    interfaceVersion: 1,
    projectGenerationVersion: 20,
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
    expect(html).toContain("View Content");
    expect(html).toContain("Return to Asset detail");
    expect(html).toContain("/projects/project-one/lineage/asset/asset%3Apreview");
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

test("reads current registered rows and current-checkout bytes without historical Snapshot data", async () => {
  const repoRoot = await prepareRepo("docs/preview.txt", "before\n");
  try {
    await writeFixture(repoRoot, "docs/preview.txt", "after\n");
    candidates.set(repoRoot, await materializeProjectReadModelCandidate(repoRoot));
    const preview = await resolvePreview(repoRoot);
    expect(preview).toMatchObject({ kind: "available", source: "current-checkout" });
    if (preview.kind !== "available") throw new Error("Expected current Asset content.");
    expect(preview.body.toString("utf8")).toContain("after");
    expect(preview.body.toString("utf8")).not.toContain("before");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("serves preview in a credential-free isolated Host surface", async () => {
  const repoRoot = await prepareRepo("docs/preview.md", "# Host preview\n");
  try {
    const app = createPortalApp({
      assets: portalAssets,
      assetPreviewService: previewService(repoRoot),
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
    expect(missing.headers.get("x-bearing-preview-availability")).toBe("unavailable");
    expect(missing.headers.get("content-type")).toContain("text/html");
    const missingBody = await missing.text();
    expect(missingBody).toContain("Content unavailable");
    expect(missingBody).toContain("Impact:");
    expect(missingBody).toContain("Recovery:");
    expect(missingBody).toContain(
      'data-bearing-return-href="/projects/project-one/lineage/asset/asset%3Amissing"',
    );
    expect(missingBody).not.toContain("allow-top-navigation");
    expect(missingBody).not.toContain("navigate-to");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("keeps an unproven Asset absence unavailable under partial coverage", async () => {
  const repoRoot = await prepareRepo("docs/preview.md", "# Partial coverage\n");
  try {
    const partialService = createAssetPreviewService({
      readCatalog: catalogFor(repoRoot),
      readAssetRow: async () => ({ state: "unavailable" }),
    });
    await expect(partialService.resolve("project-one", "asset:missing")).resolves.toMatchObject({
      kind: "unavailable",
      code: "project-data-unavailable",
    });
    const app = createPortalApp({
      assets: portalAssets,
      assetPreviewService: partialService,
      readCatalog: catalogFor(repoRoot),
      sessions: { secret: "ticket-11-partial-preview-secret-32-bytes" },
    });
    const response = await app.request(
      "http://127.0.0.1:4178/preview/projects/project-one/assets/asset%3Amissing",
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("x-bearing-preview-availability")).toBe("unavailable");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("preserves typed Project data recovery on the Asset preview surface", async () => {
  const repoRoot = await prepareRepo("docs/preview.md", "# Typed recovery\n");
  try {
    for (const [reason, code, recovery] of [
      [
        "need-rebuild",
        "project-data-needs-rebuild",
        "Use the Agent Surface to rebuild project data",
      ],
      ["need-update", "project-data-needs-update", "Install a compatible Bearing runtime"],
    ] as const) {
      const service = createAssetPreviewService({
        readCatalog: catalogFor(repoRoot),
        readAssetRow: async () => {
          throw new PortalProjectReadModelUnavailableError(reason);
        },
      });
      await expect(service.resolve("project-one", "asset:preview")).resolves.toMatchObject({
        kind: "unavailable",
        code,
      });
      const app = createPortalApp({
        assets: portalAssets,
        assetPreviewService: service,
        readCatalog: catalogFor(repoRoot),
        sessions: { secret: `ticket-11-${reason}-preview-secret-32-bytes` },
      });
      const response = await app.request(
        "http://127.0.0.1:4178/preview/projects/project-one/assets/asset%3Apreview",
      );
      expect(response.status).toBe(409);
      expect(await response.text()).toContain(recovery);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("does not offer Preview for an ordinary directory Asset", async () => {
  const repoRoot = await prepareDirectoryRepo("docs/bundle", {
    "README.md": "# Bundle README\n",
    "notes.txt": "contained notes\n",
    "payload.bin": "opaque bytes\n",
  });
  try {
    await expect(resolvePreview(repoRoot)).resolves.toMatchObject({
      kind: "unavailable",
      code: "preview-not-offered",
      availability: "not-offered",
    });

    const app = createPortalApp({
      assets: portalAssets,
      assetPreviewService: previewService(repoRoot),
      readCatalog: catalogFor(repoRoot),
      sessions: { secret: "ticket-38-directory-preview-secret-32-bytes" },
    });
    const response = await app.request(
      "http://127.0.0.1:4178/preview/projects/project-one/assets/asset%3Apreview",
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("x-bearing-preview-availability")).toBe("not-offered");
    const body = await response.text();
    expect(body).toContain("Preview not offered");
    expect(body).toContain("directory Assets");
    expect(body).not.toContain("prototype Assets");
    expect(body).not.toContain("Content unavailable");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("does not offer Preview for prototype Assets before probing their content", async () => {
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
    { kind: "prototype" },
  );
  try {
    await rm(join(repoRoot, "prototypes/demo"), { recursive: true, force: true });
    const prototype = await resolvePreview(repoRoot);
    expect(prototype).toMatchObject({
      kind: "unavailable",
      code: "preview-not-offered",
      availability: "not-offered",
    });
    if (prototype.kind !== "unavailable") throw new Error("Expected Preview to be unavailable.");
    expect(prototype.message).toContain("not offered for prototype Assets");
    expect(prototype.message).not.toContain("missing");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("Host returns typed not-offered responses without serving prototype content", async () => {
  const repoRoot = await prepareDirectoryRepo(
    "prototypes/route",
    { "index.html": "<html><body>Route prototype</body></html>", "app.js": "console.log('ok');" },
    { kind: "prototype" },
  );
  try {
    const app = createPortalApp({
      assets: portalAssets,
      assetPreviewService: previewService(repoRoot),
      readCatalog: catalogFor(repoRoot),
      sessions: { secret: "ticket-22-preview-session-secret-32-bytes" },
    });
    const response = await app.request(
      "http://127.0.0.1:4178/preview/projects/project-one/assets/asset%3Apreview",
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("x-bearing-preview-availability")).toBe("not-offered");
    const responseBody = await response.text();
    expect(responseBody).toContain("Preview not offered");
    expect(responseBody).not.toContain("Content unavailable");
    expect(responseBody).not.toContain("Route prototype");

    const removedResourceRoute = await app.request(
      "http://127.0.0.1:4178/preview/projects/project-one/assets/asset%3Apreview/resource/app.js",
    );
    expect(removedResourceRoute.status).toBe(404);
    expect(removedResourceRoute.headers.get("x-bearing-preview-availability")).toBeNull();
    expect(await removedResourceRoute.text()).not.toContain("console.log");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
