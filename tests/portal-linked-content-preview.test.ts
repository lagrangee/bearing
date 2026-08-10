import { expect, test } from "bun:test";
import { chmod, link, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPortalApp } from "../src/portal/app";
import type { PortalAssets } from "../src/portal/assets";
import {
  createLinkedContentPreviewService,
  MAX_LINKED_IMAGE_PREVIEW_BYTES,
} from "../src/portal/linked-content-preview";
import { renderProviderMarkdownDocuments } from "../src/portal/markdown-engine";
import { createValidBearingRepo } from "./helpers";

const catalogFor = (repoRoot: string) => async () => ({
  state: "ready" as const,
  entries: [
    {
      entryId: "project-one",
      displayName: "Project One",
      repoRoot,
      availability: "available" as const,
    },
  ],
});

const portalAssets: PortalAssets = {
  manifest: {
    schemaVersion: 1,
    packageVersion: "0.0.0-test",
    interfaceVersion: 1,
    projectGenerationVersion: 21,
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

test("resolves a repository-relative image into opaque current-checkout thumbnail and Preview routes", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  try {
    await mkdir(join(repoRoot, ".scratch/work/issues"), { recursive: true });
    await mkdir(join(repoRoot, ".scratch/work/evidence"), { recursive: true });
    await writeFile(join(repoRoot, ".scratch/work/issues/01-finish.md"), "# Finish\n");
    await writeFile(join(repoRoot, ".scratch/work/evidence/screenshot.png"), "png bytes");
    await writeFile(
      join(repoRoot, '.scratch/work/evidence/x" onerror="globalThis.bad=true.png'),
      "quoted filename bytes",
    );
    const service = createLinkedContentPreviewService({ readCatalog: catalogFor(repoRoot) });

    const presentation = await service.present({
      entryId: "project-one",
      sourceLocator: ".scratch/work/issues/01-finish.md",
      authoredHref: "../evidence/screenshot.png",
      usage: "image",
    });

    expect(presentation).toMatchObject({
      kind: "available",
      representation: "image",
    });
    if (presentation.kind !== "available") throw new Error("Expected linked image Preview.");
    expect(presentation.previewHref).toMatch(
      /^\/preview\/projects\/project-one\/linked\/[a-f0-9]{64}$/u,
    );
    expect(presentation.thumbnailSrc).toBe(`${presentation.previewHref}/content`);
    expect(JSON.stringify(presentation)).not.toContain(repoRoot);
    expect(JSON.stringify(presentation)).not.toContain(".scratch/work");

    const preview = await service.resolve("project-one", presentation.token, "preview");
    expect(preview).toMatchObject({
      kind: "available",
      contentType: "text/html; charset=utf-8",
      mediaType: "image/png",
      source: "current-checkout",
      surface: "file",
    });
    if (preview.kind !== "available") throw new Error("Expected full contained Preview.");
    expect(preview.body.toString("utf8")).toContain("not historical Provider capture bytes");
    expect(preview.body.toString("utf8")).not.toContain(repoRoot);

    const thumbnail = await service.resolve("project-one", presentation.token, "content");
    expect(thumbnail).toMatchObject({
      kind: "available",
      contentType: "image/png",
      mediaType: "image/png",
      source: "current-checkout",
      surface: "thumbnail",
    });
    if (thumbnail.kind !== "available") throw new Error("Expected original image bytes.");
    expect(thumbnail.body.toString("utf8")).toBe("png bytes");

    const quoted = await service.present({
      entryId: "project-one",
      sourceLocator: ".scratch/work/issues/01-finish.md",
      authoredHref: "../evidence/x%22%20onerror=%22globalThis.bad=true.png",
      usage: "image",
    });
    if (quoted.kind !== "available") throw new Error("Expected quoted filename Preview.");
    const quotedPreview = await service.resolve("project-one", quoted.token, "preview");
    if (quotedPreview.kind !== "available") throw new Error("Expected quoted filename content.");
    const quotedHtml = quotedPreview.body.toString("utf8");
    expect(quotedHtml).toContain('alt="x&quot; onerror=&quot;globalThis.bad=true.png"');
    const imageTag = quotedHtml.match(/<img [^>]+>/u)?.[0];
    expect(imageTag).toBeDefined();
    expect(imageTag).not.toContain(' onerror="');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("keeps linked image limits separate from existing non-image Preview limits", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  try {
    await mkdir(join(repoRoot, "docs"), { recursive: true });
    await writeFile(join(repoRoot, "docs/source.md"), "# Source\n");
    await writeFile(
      join(repoRoot, "docs/large.png"),
      Buffer.alloc(MAX_LINKED_IMAGE_PREVIEW_BYTES + 1),
    );
    await writeFile(join(repoRoot, "docs/large.txt"), Buffer.alloc(4 * 1024 * 1024 + 1));
    const service = createLinkedContentPreviewService({ readCatalog: catalogFor(repoRoot) });

    await expect(
      service.present({
        entryId: "project-one",
        sourceLocator: "docs/source.md",
        authoredHref: "large.png",
        usage: "image",
      }),
    ).resolves.toMatchObject({
      kind: "unavailable",
      code: "content-exceeds-limit",
      availability: "exceeds-limit",
    });
    await expect(
      service.present({
        entryId: "project-one",
        sourceLocator: "docs/source.md",
        authoredHref: "large.txt",
        usage: "link",
      }),
    ).resolves.toMatchObject({
      kind: "unavailable",
      code: "content-exceeds-limit",
      availability: "exceeds-limit",
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("renders each local link from its containing document without exposing repository locators", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  try {
    await mkdir(join(repoRoot, "docs/one"), { recursive: true });
    await mkdir(join(repoRoot, "docs/two"), { recursive: true });
    await writeFile(join(repoRoot, "docs/one/source.md"), "# One\n");
    await writeFile(join(repoRoot, "docs/two/source.md"), "# Two\n");
    await writeFile(join(repoRoot, "docs/one/proof.txt"), "one\n");
    await writeFile(join(repoRoot, "docs/two/proof.txt"), "two\n");
    await writeFile(join(repoRoot, "docs/one/image.png"), "image\n");
    const service = createLinkedContentPreviewService({ readCatalog: catalogFor(repoRoot) });
    const markdown =
      "![local image](image.png) [proof](proof.txt) [missing](missing.pdf) ![remote](https://images.example/remote.png)";
    const section = {
      version: 1 as const,
      sourceIdentity: "body",
      title: "Body",
      sourceOrder: 0,
      availability: "available" as const,
      markdown,
    };

    const rendered = await renderProviderMarkdownDocuments(
      "project-one",
      [
        { sourceLocator: "docs/one/source.md", sections: [section] },
        { sourceLocator: "docs/two/source.md", sections: [section] },
      ],
      service,
    );

    expect(rendered).toHaveLength(2);
    expect(rendered[0]?.sourceLocator).toBe("docs/one/source.md");
    expect(rendered[1]?.sourceLocator).toBe("docs/two/source.md");
    expect(rendered[0]?.html).toContain('class="markdown-linked-image-thumbnail"');
    expect(rendered[0]?.html).toContain('loading="lazy"');
    expect(rendered[0]?.html).toContain("Preview unavailable: The linked content is missing.");
    expect(rendered[0]?.html).toContain(
      '<a class="markdown-linked-image" href="https://images.example/remote.png" target="_blank" rel="noopener noreferrer"><img class="markdown-linked-image-thumbnail" src="https://images.example/remote.png" alt="remote" loading="lazy" /></a>',
    );
    expect(rendered[0]?.html).not.toContain(repoRoot);
    expect(rendered[0]?.html).not.toContain("docs/one");
    expect(rendered[0]?.html).not.toBe(rendered[1]?.html);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("Host serves linked Preview and original thumbnail bytes with isolated response headers", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  try {
    await writeFile(join(repoRoot, "docs/image.png"), "current image");
    const linkedContentPreview = createLinkedContentPreviewService({
      readCatalog: catalogFor(repoRoot),
    });
    const presentation = await linkedContentPreview.present({
      entryId: "project-one",
      sourceLocator: "docs/source.md",
      authoredHref: "image.png",
      usage: "image",
    });
    if (presentation.kind !== "available") throw new Error("Expected linked image Preview.");
    const app = createPortalApp({
      assets: portalAssets,
      linkedContentPreviewService: linkedContentPreview,
      readCatalog: catalogFor(repoRoot),
      sessions: { secret: "ticket-32-linked-preview-secret-32-bytes" },
    });

    const preview = await app.request(`http://127.0.0.1:4178${presentation.previewHref}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(preview.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(preview.headers.get("referrer-policy")).toBe("no-referrer");
    expect(preview.headers.get("x-bearing-preview-source")).toBe("current-checkout");
    expect(await preview.text()).toContain("not historical Provider capture bytes");

    const thumbnail = await app.request(`http://127.0.0.1:4178${presentation.thumbnailSrc ?? ""}`);
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get("content-type")).toBe("image/png");
    expect(thumbnail.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await thumbnail.text()).toBe("current image");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("keeps linked-content Preview outside Asset identity and Provider acquisition graphs", async () => {
  const source = await readFile("src/portal/linked-content-preview.ts", "utf8");
  for (const forbidden of [
    "queryPortalAssetRow",
    "assetIdSchema",
    "AssetProjection",
    "provider-acquisition",
    "provider-operations",
  ]) {
    expect(source).not.toContain(forbidden);
  }
  const outputRoot = await realpath(await createValidBearingRepo());
  try {
    const result = await Bun.build({
      entrypoints: [join(process.cwd(), "src/portal/linked-content-preview.ts")],
      outdir: join(outputRoot, "build"),
      target: "node",
      format: "esm",
      minify: false,
      sourcemap: "none",
      metafile: true,
    });
    expect(result.success).toBe(true);
    if (result.metafile === undefined) throw new Error("Expected linked Preview import graph.");
    const modules = Object.keys(result.metafile.inputs);
    for (const forbidden of [
      "src/portal/asset-preview.ts",
      "src/project-read-model/portal.ts",
      "src/provider-acquisition.ts",
      "src/project-read-model/provider-operations.ts",
      "src/asset-records.ts",
    ]) {
      expect(
        modules.some((module) => module.endsWith(forbidden)),
        forbidden,
      ).toBe(false);
    }
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("reuses contained Markdown, HTML, text, audio, video, and PDF representations", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  try {
    await writeFile(join(repoRoot, "docs/source.md"), "# Source\n");
    const fixtures = [
      ["reading.md", "# Linked Markdown\n", "text/markdown", "<h1>Linked Markdown</h1>"],
      [
        "reading.html",
        "<h1>Linked HTML</h1><script>globalThis.bad=true</script>",
        "text/html",
        "<h1>Linked HTML</h1>",
      ],
      ["reading.txt", "Linked text\n", "text/plain", "<pre>Linked text"],
      ["reading.mp3", "audio bytes", "audio/mpeg", "<audio controls"],
      ["reading.mp4", "video bytes", "video/mp4", "<video controls"],
      ["reading.pdf", "%PDF fixture", "application/pdf", "<object data="],
    ] as const;
    const service = createLinkedContentPreviewService({ readCatalog: catalogFor(repoRoot) });
    for (const [locator, bytes, mediaType, marker] of fixtures) {
      await writeFile(join(repoRoot, "docs", locator), bytes);
      const presentation = await service.present({
        entryId: "project-one",
        sourceLocator: "docs/source.md",
        authoredHref: locator,
        usage: "link",
      });
      expect(presentation.kind, locator).toBe("available");
      if (presentation.kind !== "available") continue;
      const preview = await service.resolve("project-one", presentation.token, "preview");
      expect(preview, locator).toMatchObject({
        kind: "available",
        mediaType,
        source: "current-checkout",
        surface: "file",
      });
      if (preview.kind !== "available") continue;
      expect(preview.body.toString("utf8"), locator).toContain(marker);
      expect(preview.body.toString("utf8"), locator).not.toContain("globalThis.bad");
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("returns one typed unavailable presentation for each failed local target", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  try {
    await writeFile(join(repoRoot, "docs/source.md"), "# Source\n");
    await mkdir(join(repoRoot, "docs/directory"), { recursive: true });
    await writeFile(join(repoRoot, "docs/unsupported.bin"), "opaque\n");
    await writeFile(join(repoRoot, "docs/symlink-target.txt"), "target\n");
    await symlink("symlink-target.txt", join(repoRoot, "docs/symlink.txt"));
    await writeFile(join(repoRoot, "docs/hardlink-target.txt"), "target\n");
    await link(join(repoRoot, "docs/hardlink-target.txt"), join(repoRoot, "docs/hardlink.txt"));
    await writeFile(join(repoRoot, "docs/unreadable.txt"), "private\n");
    await chmod(join(repoRoot, "docs/unreadable.txt"), 0);
    const service = createLinkedContentPreviewService({ readCatalog: catalogFor(repoRoot) });
    const cases = [
      ["missing.txt", "content-missing", "unavailable"],
      ["directory", "unsupported-filesystem-type", "unsupported"],
      ["unsupported.bin", "unsupported-content", "unsupported"],
      ["symlink.txt", "unsafe-content", "unsafe"],
      ["hardlink.txt", "unsafe-content", "unsafe"],
      ["../../../outside.txt", "unsafe-content", "unsafe"],
      ["..%5Coutside.txt", "unsafe-content", "unsafe"],
      ["unreadable.txt", "content-unreadable", "unavailable"],
    ] as const;
    for (const [authoredHref, code, availability] of cases) {
      await expect(
        service.present({
          entryId: "project-one",
          sourceLocator: "docs/source.md",
          authoredHref,
          usage: "link",
        }),
        authoredHref,
      ).resolves.toMatchObject({ kind: "unavailable", code, availability });
    }
    await expect(
      service.present({
        entryId: "project-one",
        sourceLocator: "/tmp/source.md",
        authoredHref: "outside.txt",
        usage: "link",
      }),
    ).resolves.toMatchObject({ kind: "unavailable", code: "unsafe-content" });
  } finally {
    await chmod(join(repoRoot, "docs/unreadable.txt"), 0o600).catch(() => {});
    await rm(repoRoot, { recursive: true, force: true });
  }
});
