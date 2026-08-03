import { lstat, readdir } from "node:fs/promises";
import { extname, isAbsolute, join, posix, relative, sep } from "node:path";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { probeContainedInput } from "../input-boundary";
import { readContainedFile, resolveContainedPath } from "../path-boundary";
import { readProjectSnapshotCache } from "../project-snapshot/cache";
import type { AssetProjection } from "../project-snapshot/contract";
import { assetIdSchema } from "../project-snapshot/schema-primitives";
import { readProjectSitemapCache } from "../sitemap-cache";
import type { CatalogReadResult } from "./contract";
import { resolveProjectEntry } from "./project-entry";

export const ASSET_PREVIEW_POLICY_VERSION = 1 as const;
export const ASSET_PREVIEW_BUNDLE_POLICY_VERSION = 1 as const;
export const MAX_ASSET_PREVIEW_BYTES = 4 * 1024 * 1024;
export const MAX_ASSET_PREVIEW_BUNDLE_FILES = 128;
export const MAX_ASSET_PREVIEW_BUNDLE_BYTES = 16 * 1024 * 1024;
export const MAX_ASSET_PREVIEW_BUNDLE_DEPTH = 8;
export const ASSET_PREVIEW_CONTENT_SECURITY_POLICY =
  "sandbox allow-scripts; default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; object-src data:; connect-src 'none'; frame-ancestors 'none'; font-src 'none'";

export type AssetPreviewAvailability =
  | "available"
  | "not-offered"
  | "unavailable"
  | "unsupported"
  | "unsafe"
  | "exceeds-limit";

export type AssetPreviewUnavailableCode =
  | "project-unavailable"
  | "snapshot-unavailable"
  | "asset-not-registered"
  | "preview-not-offered"
  | "content-missing"
  | "content-unreadable"
  | "stale-registration"
  | "unsupported-filesystem-type"
  | "unsafe-content"
  | "unsupported-content"
  | "content-exceeds-limit";

export type AssetPreviewSurface = "file" | "bundle-browser" | "bundle-resource";

export type AssetPreviewResolution =
  | Readonly<{
      kind: "available";
      body: Buffer;
      contentType: string;
      mediaType: string;
      source: "current-checkout";
      policyVersion: typeof ASSET_PREVIEW_POLICY_VERSION;
      surface: AssetPreviewSurface;
      contentSecurityPolicy: string;
      bundlePolicyVersion?: typeof ASSET_PREVIEW_BUNDLE_POLICY_VERSION;
      resourcePath?: string;
    }>
  | Readonly<{
      kind: "unavailable";
      code: AssetPreviewUnavailableCode;
      availability: AssetPreviewAvailability;
      message: string;
    }>;

type PreviewRepresentation =
  | Readonly<{ kind: "markdown"; mediaType: "text/markdown" }>
  | Readonly<{ kind: "html"; mediaType: "text/html" }>
  | Readonly<{ kind: "text"; mediaType: string }>
  | Readonly<{ kind: "image"; mediaType: string }>
  | Readonly<{ kind: "audio"; mediaType: string }>
  | Readonly<{ kind: "video"; mediaType: string }>
  | Readonly<{ kind: "pdf"; mediaType: "application/pdf" }>;

export type AssetPreviewService = Readonly<{
  resolve(entryId: string, assetId: string): Promise<AssetPreviewResolution>;
  resolveResource(
    entryId: string,
    assetId: string,
    resourcePath: string,
  ): Promise<AssetPreviewResolution>;
}>;

const markdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: false,
  typographer: false,
});

const allowedHtmlTags = [
  "a",
  "abbr",
  "article",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "kbd",
  "li",
  "main",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "small",
  "span",
  "strong",
  "summary",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
] as const;

const sanitizerOptions = {
  allowedAttributes: {
    a: ["href", "title"],
    img: ["alt", "src", "title"],
  },
  allowedSchemes: ["data", "http", "https", "mailto"],
  allowProtocolRelative: false,
  allowedTags: [...allowedHtmlTags],
  disallowedTagsMode: "discard" as const,
};

const textSanitizerOptions = {
  allowedAttributes: {},
  allowedTags: [] as string[],
  disallowedTagsMode: "discard" as const,
};

const safeText = (value: string): string => sanitizeHtml(value, textSanitizerOptions);

const safeHtml = (value: string): string => sanitizeHtml(value, sanitizerOptions);

const assetDetailHref = (entryId: string, assetId: string): string =>
  `/projects/${encodeURIComponent(entryId)}/lineage/asset/${encodeURIComponent(assetId)}`;

const returnToAssetDetailControl = (href: string): string =>
  `<button type="button" data-bearing-return data-bearing-return-href="${escapeAttribute(href)}" onclick="window.close()">Return to Asset detail</button>`;

export const assetPreviewUnavailableDocument = (
  entryId: string,
  assetId: string,
  result: Extract<AssetPreviewResolution, { kind: "unavailable" }>,
): string => {
  const returnControl = returnToAssetDetailControl(assetDetailHref(entryId, assetId));
  if (result.code === "preview-not-offered") {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>Preview not offered</title></head><body><header>${returnControl}</header><main><h1>Preview not offered</h1><p>Bearing does not provide content preview or execution for prototype Assets.</p><p>Return to Asset detail to read its semantic information or inspect provenance in Technical Details.</p></main></body></html>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>Content unavailable</title></head><body><header>${returnControl}<p>View Content · current-checkout content</p></header><main><h1>Content unavailable</h1><p>Cause: ${safeText(result.message)}</p><p>Impact: this Asset content cannot be read on the current content surface.</p><p>Recovery: return to Asset detail, open Technical Details, repair the registered source, then run Sync.</p></main></body></html>`;
};

const previewDocument = (title: string, body: string, returnHref: string): Buffer =>
  Buffer.from(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>${safeText(title)}</title></head><body><header>${returnToAssetDetailControl(returnHref)}<p>View Content · current-checkout content</p><p>This is not historical Snapshot bytes; the registered Asset was revalidated against the current checkout.</p></header><main>${body}</main></body></html>`,
    "utf8",
  );

const BUNDLE_BROWSER_CONTENT_SECURITY_POLICY =
  "sandbox allow-scripts; default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; media-src 'none'; object-src 'none'; connect-src 'none'; frame-ancestors 'none'";

type BundleEntry = Readonly<{
  path: string;
  byteLength: number;
  representation: PreviewRepresentation | undefined;
}>;

type BundleInventory = Readonly<{
  root: string;
  entries: readonly BundleEntry[];
  totalBytes: number;
}>;

type RegisteredAssetContext = Readonly<{
  repoRoot: string;
  asset: AssetProjection;
  path: string;
  isDirectory: boolean;
}>;

const encodePath = (value: string): string =>
  value
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const assetResourceHref = (entryId: string, assetId: string, resourcePath = ""): string =>
  `/preview/projects/${encodeURIComponent(entryId)}/assets/${encodeURIComponent(assetId)}/resource/${encodePath(resourcePath)}`;

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const bundleBrowserDocument = (
  title: string,
  entryId: string,
  assetId: string,
  entries: readonly BundleEntry[],
  totalBytes: number,
): Buffer => {
  const supported = entries.filter(
    (entry): entry is BundleEntry & { representation: PreviewRepresentation } =>
      entry.representation !== undefined,
  );
  const list =
    supported.length === 0
      ? "<p>No supported contained files are available for preview.</p>"
      : `<ul>${supported
          .map(
            (entry) =>
              `<li><a href="${assetResourceHref(entryId, assetId, entry.path)}">${safeText(entry.path)}</a><span> · ${entry.byteLength} bytes</span></li>`,
          )
          .join("")}</ul>`;
  return Buffer.from(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${BUNDLE_BROWSER_CONTENT_SECURITY_POLICY}"><title>${safeText(title)}</title></head><body><header>${returnToAssetDetailControl(assetDetailHref(entryId, assetId))}<p>View Content · current-checkout content</p><p>This is not historical Snapshot bytes; the registered directory was revalidated against the current checkout.</p><p>Bundle policy ${ASSET_PREVIEW_BUNDLE_POLICY_VERSION} · ${supported.length} supported entries · ${totalBytes} total bytes</p></header><main><h1>${safeText(title)}</h1>${list}</main></body></html>`,
    "utf8",
  );
};

const dataUri = (mediaType: string, bytes: Buffer): string =>
  `data:${mediaType};base64,${bytes.toString("base64")}`;

const representationFor = (locator: string): PreviewRepresentation | undefined => {
  const extension = extname(locator).toLowerCase();
  switch (extension) {
    case ".md":
    case ".markdown":
      return { kind: "markdown", mediaType: "text/markdown" };
    case ".html":
    case ".htm":
      return { kind: "html", mediaType: "text/html" };
    case ".txt":
    case ".text":
    case ".log":
    case ".json":
    case ".jsonl":
    case ".js":
    case ".jsx":
    case ".ts":
    case ".tsx":
    case ".css":
    case ".csv":
    case ".go":
    case ".java":
    case ".py":
    case ".rs":
    case ".sh":
    case ".toml":
    case ".xml":
    case ".yaml":
    case ".yml":
      return { kind: "text", mediaType: "text/plain" };
    case ".svg":
      return { kind: "image", mediaType: "image/svg+xml" };
    case ".png":
      return { kind: "image", mediaType: "image/png" };
    case ".jpg":
    case ".jpeg":
      return { kind: "image", mediaType: "image/jpeg" };
    case ".gif":
      return { kind: "image", mediaType: "image/gif" };
    case ".avif":
      return { kind: "image", mediaType: "image/avif" };
    case ".webp":
      return { kind: "image", mediaType: "image/webp" };
    case ".mp3":
      return { kind: "audio", mediaType: "audio/mpeg" };
    case ".wav":
      return { kind: "audio", mediaType: "audio/wav" };
    case ".ogg":
      return { kind: "audio", mediaType: "audio/ogg" };
    case ".m4a":
      return { kind: "audio", mediaType: "audio/mp4" };
    case ".mp4":
      return { kind: "video", mediaType: "video/mp4" };
    case ".webm":
      return { kind: "video", mediaType: "video/webm" };
    case ".mov":
      return { kind: "video", mediaType: "video/quicktime" };
    case ".pdf":
      return { kind: "pdf", mediaType: "application/pdf" };
    case ".zip":
    case ".7z":
    case ".gz":
    case ".rar":
    case ".tar":
    case ".tgz":
      return undefined;
    case ".app":
    case ".dmg":
    case ".dll":
    case ".dylib":
    case ".exe":
    case ".msi":
    case ".pkg":
    case ".so":
    case ".wasm":
      return undefined;
    default:
      return undefined;
  }
};

const unsafeExtensions = new Set([
  ".app",
  ".dmg",
  ".dll",
  ".dylib",
  ".exe",
  ".msi",
  ".pkg",
  ".so",
  ".wasm",
]);

const normalizeBundleRelativePath = (value: string): string | undefined => {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.length === 0 || normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }
  return segments.join("/");
};

const isContainedBy = (root: string, target: string): boolean => {
  const fromRoot = relative(root, target);
  return (
    fromRoot !== "" &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
};

const unavailable = (
  code: AssetPreviewUnavailableCode,
  message: string,
  availability: AssetPreviewAvailability,
): AssetPreviewResolution => ({
  kind: "unavailable",
  code,
  availability,
  message,
});

type UnavailableResolution = Extract<AssetPreviewResolution, { kind: "unavailable" }>;
type RegisteredAssetResult =
  | Readonly<{ kind: "available"; context: RegisteredAssetContext }>
  | Readonly<{ kind: "unavailable"; resolution: UnavailableResolution }>;

const resolveRegisteredAsset = async (
  entryId: string,
  assetId: string,
  readCatalog: () => Promise<CatalogReadResult>,
): Promise<RegisteredAssetResult> => {
  const parsedAssetId = assetIdSchema.safeParse(assetId);
  if (!parsedAssetId.success) {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "asset-not-registered",
        "The requested Asset identity is invalid.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  const entry = await resolveProjectEntry({ entryId, readCatalog });
  if (entry.kind !== "available") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "project-unavailable",
        "The registered project is unavailable.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  const sitemap = await readProjectSitemapCache(entry.entry.repoRoot);
  if (sitemap.kind !== "available") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "snapshot-unavailable",
        "The current project generation is unavailable.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  const cache = await readProjectSnapshotCache(
    entry.entry.repoRoot,
    sitemap.envelope.inputFingerprint,
  );
  if (cache.kind !== "available") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "stale-registration",
        "The registered Asset does not have matching current revision evidence.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  if (cache.snapshot.assets.validity === "invalid") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "snapshot-unavailable",
        "The Asset projection is unavailable.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  const asset = cache.snapshot.assets.items.find(
    (candidate) => candidate.id === parsedAssetId.data,
  );
  if (asset === undefined) {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "asset-not-registered",
        "The requested Asset is not registered in this project.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  if (asset.kind === "prototype") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "preview-not-offered",
        "Content preview and execution are not offered for prototype Assets.",
        "not-offered",
      ) as UnavailableResolution,
    };
  }
  if (asset.contentAvailability === "missing") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "content-missing",
        "The registered Asset content is missing.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  if (asset.contentAvailability === "unreadable") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "content-unreadable",
        "The registered Asset content is unreadable.",
        "unsafe",
      ) as UnavailableResolution,
    };
  }
  const probe = await probeContainedInput(entry.entry.repoRoot, asset.displayLocation);
  if (probe.status === "missing") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "content-missing",
        "The registered Asset content is missing.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  if (probe.status === "blocked") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "unsafe-content",
        "The registered Asset failed current-checkout containment.",
        "unsafe",
      ) as UnavailableResolution,
    };
  }
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(probe.path);
  } catch {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "unsafe-content",
        "The Asset changed or failed safety validation while it was opened.",
        "unsafe",
      ) as UnavailableResolution,
    };
  }
  if (!metadata.isFile() && !metadata.isDirectory()) {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "unsupported-filesystem-type",
        "This Asset has an unsupported filesystem type.",
        "unsupported",
      ) as UnavailableResolution,
    };
  }
  return {
    kind: "available",
    context: {
      repoRoot: entry.entry.repoRoot,
      asset,
      path: probe.path,
      isDirectory: metadata.isDirectory(),
    },
  };
};

type BundleInventoryResult =
  | Readonly<{ kind: "available"; inventory: BundleInventory }>
  | Readonly<{ kind: "unavailable"; resolution: UnavailableResolution }>;

const enumerateBundle = async (context: RegisteredAssetContext): Promise<BundleInventoryResult> => {
  const entries: BundleEntry[] = [];
  let totalBytes = 0;
  const visit = async (directory: string, prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_ASSET_PREVIEW_BUNDLE_DEPTH) {
      throw unavailable(
        "content-exceeds-limit",
        "The registered directory exceeds the versioned navigation depth limit.",
        "exceeds-limit",
      );
    }
    const children = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)),
    );
    for (const child of children) {
      const childPath = join(directory, child.name);
      const containedPath = await resolveContainedPath(context.repoRoot, childPath);
      const metadata = await lstat(containedPath);
      const childRelativePath = posix.join(prefix, child.name);
      if (metadata.isDirectory()) {
        await visit(containedPath, childRelativePath, depth + 1);
        continue;
      }
      if (!metadata.isFile() || metadata.nlink !== 1) {
        throw unavailable(
          "unsafe-content",
          `The bundle contains an unsafe filesystem member: ${childRelativePath}`,
          "unsafe",
        );
      }
      if (entries.length >= MAX_ASSET_PREVIEW_BUNDLE_FILES) {
        throw unavailable(
          "content-exceeds-limit",
          "The registered directory exceeds the versioned file-count limit.",
          "exceeds-limit",
        );
      }
      totalBytes += metadata.size;
      if (totalBytes > MAX_ASSET_PREVIEW_BUNDLE_BYTES) {
        throw unavailable(
          "content-exceeds-limit",
          "The registered directory exceeds the versioned total-byte limit.",
          "exceeds-limit",
        );
      }
      entries.push({
        path: childRelativePath,
        byteLength: metadata.size,
        representation: representationFor(childRelativePath),
      });
    }
  };
  try {
    await visit(context.path, "", 0);
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "kind" in error &&
      error.kind === "unavailable"
    ) {
      return { kind: "unavailable", resolution: error as UnavailableResolution };
    }
    return {
      kind: "unavailable",
      resolution: unavailable(
        "unsafe-content",
        "The registered directory changed or failed containment validation.",
        "unsafe",
      ) as UnavailableResolution,
    };
  }
  return { kind: "available", inventory: { root: context.path, entries, totalBytes } };
};

const renderRepresentation = (
  title: string,
  bytes: Buffer,
  representation: PreviewRepresentation,
  returnHref: string,
): Buffer => {
  const value = bytes.toString("utf8");
  switch (representation.kind) {
    case "markdown":
      return previewDocument(title, safeHtml(markdown.render(value)), returnHref);
    case "html":
      return previewDocument(title, safeHtml(value), returnHref);
    case "text":
      return previewDocument(title, `<pre>${safeText(value)}</pre>`, returnHref);
    case "image":
      return previewDocument(
        title,
        `<figure><img alt="${safeText(title)}" src="${dataUri(representation.mediaType, bytes)}"><figcaption>Browser-native image surface</figcaption></figure>`,
        returnHref,
      );
    case "audio":
      return previewDocument(
        title,
        `<audio controls src="${dataUri(representation.mediaType, bytes)}">Audio preview unavailable in this browser.</audio>`,
        returnHref,
      );
    case "video":
      return previewDocument(
        title,
        `<video controls src="${dataUri(representation.mediaType, bytes)}">Video preview unavailable in this browser.</video>`,
        returnHref,
      );
    case "pdf":
      return previewDocument(
        title,
        `<object data="${dataUri(representation.mediaType, bytes)}" type="${representation.mediaType}">PDF preview unavailable in this browser.</object>`,
        returnHref,
      );
  }
};

const readBundleEntry = async (
  context: RegisteredAssetContext,
  inventory: BundleInventory,
  entry: BundleEntry,
): Promise<Readonly<{ bytes: Buffer; path: string }> | UnavailableResolution> => {
  if (entry.byteLength > MAX_ASSET_PREVIEW_BYTES) {
    return unavailable(
      "content-exceeds-limit",
      "The selected bundle resource exceeds the versioned single-file preview limit.",
      "exceeds-limit",
    ) as UnavailableResolution;
  }
  let target: string;
  try {
    target = await resolveContainedPath(context.repoRoot, join(inventory.root, entry.path));
  } catch {
    return unavailable(
      "unsafe-content",
      "The selected bundle resource failed current-checkout containment.",
      "unsafe",
    ) as UnavailableResolution;
  }
  if (!isContainedBy(inventory.root, target)) {
    return unavailable(
      "unsafe-content",
      "The selected bundle resource escaped its registered directory.",
      "unsafe",
    ) as UnavailableResolution;
  }
  try {
    return {
      bytes: await readContainedFile(context.repoRoot, target, {
        maximumBytes: MAX_ASSET_PREVIEW_BYTES,
      }),
      path: target,
    };
  } catch {
    return unavailable(
      "unsafe-content",
      "The selected bundle resource changed or failed safety validation while it was read.",
      "unsafe",
    ) as UnavailableResolution;
  }
};

const fileResolution = async (
  context: RegisteredAssetContext,
  entryId: string,
): Promise<AssetPreviewResolution> => {
  const metadata = await lstat(context.path);
  if (metadata.size > MAX_ASSET_PREVIEW_BYTES) {
    return unavailable(
      "content-exceeds-limit",
      "This Asset exceeds the versioned single-file preview limit.",
      "exceeds-limit",
    );
  }
  const representation = representationFor(context.asset.displayLocation);
  if (representation === undefined) {
    const extension = extname(context.asset.displayLocation).toLowerCase();
    return unsafeExtensions.has(extension)
      ? unavailable("unsafe-content", "Executable or runtime content is never previewed.", "unsafe")
      : unavailable(
          "unsupported-content",
          "This Asset type is not supported for safe preview.",
          "unsupported",
        );
  }
  try {
    const bytes = await readContainedFile(context.repoRoot, context.path, {
      maximumBytes: MAX_ASSET_PREVIEW_BYTES,
    });
    return {
      kind: "available",
      body: renderRepresentation(
        context.asset.title,
        bytes,
        representation,
        assetDetailHref(entryId, context.asset.id),
      ),
      contentType: "text/html; charset=utf-8",
      mediaType: representation.mediaType,
      source: "current-checkout",
      policyVersion: ASSET_PREVIEW_POLICY_VERSION,
      surface: "file",
      contentSecurityPolicy: ASSET_PREVIEW_CONTENT_SECURITY_POLICY,
    };
  } catch {
    return unavailable(
      "unsafe-content",
      "The Asset changed or failed safety validation while it was read.",
      "unsafe",
    );
  }
};

export const createAssetPreviewService = (options: {
  readonly readCatalog: () => Promise<CatalogReadResult>;
}): AssetPreviewService =>
  Object.freeze({
    async resolve(entryId: string, assetId: string): Promise<AssetPreviewResolution> {
      const registered = await resolveRegisteredAsset(entryId, assetId, options.readCatalog);
      if (registered.kind === "unavailable") return registered.resolution;
      if (!registered.context.isDirectory) return fileResolution(registered.context, entryId);

      const inventoryResult = await enumerateBundle(registered.context);
      if (inventoryResult.kind === "unavailable") return inventoryResult.resolution;
      const { inventory } = inventoryResult;
      return {
        kind: "available",
        body: bundleBrowserDocument(
          registered.context.asset.title,
          entryId,
          registered.context.asset.id,
          inventory.entries,
          inventory.totalBytes,
        ),
        contentType: "text/html; charset=utf-8",
        mediaType: "text/html",
        source: "current-checkout",
        policyVersion: ASSET_PREVIEW_POLICY_VERSION,
        surface: "bundle-browser",
        contentSecurityPolicy: BUNDLE_BROWSER_CONTENT_SECURITY_POLICY,
        bundlePolicyVersion: ASSET_PREVIEW_BUNDLE_POLICY_VERSION,
      };
    },

    async resolveResource(
      entryId: string,
      assetId: string,
      resourcePath: string,
    ): Promise<AssetPreviewResolution> {
      const registered = await resolveRegisteredAsset(entryId, assetId, options.readCatalog);
      if (registered.kind === "unavailable") return registered.resolution;
      if (!registered.context.isDirectory) {
        return unavailable(
          "asset-not-registered",
          "A file Asset has no contained bundle resources.",
          "unavailable",
        );
      }
      const normalized = normalizeBundleRelativePath(resourcePath);
      if (normalized === undefined) {
        return unavailable(
          "asset-not-registered",
          "The requested bundle resource path is invalid.",
          "unavailable",
        );
      }
      const inventoryResult = await enumerateBundle(registered.context);
      if (inventoryResult.kind === "unavailable") return inventoryResult.resolution;
      const entry = inventoryResult.inventory.entries.find(
        (candidate) => candidate.path === normalized,
      );
      if (entry === undefined) {
        return unavailable(
          "asset-not-registered",
          "The requested bundle resource is not registered inside this directory.",
          "unavailable",
        );
      }
      const representation = entry.representation;
      if (representation === undefined) {
        const extension = extname(normalized).toLowerCase();
        return unsafeExtensions.has(extension)
          ? unavailable("unsafe-content", "Executable content is never previewed.", "unsafe")
          : unavailable(
              "unsupported-content",
              "This bundle resource type is not supported for safe preview.",
              "unsupported",
            );
      }
      const contents = await readBundleEntry(registered.context, inventoryResult.inventory, entry);
      if ("kind" in contents) return contents;
      return {
        kind: "available",
        body: renderRepresentation(
          `${registered.context.asset.title} · ${normalized}`,
          contents.bytes,
          representation,
          assetDetailHref(entryId, registered.context.asset.id),
        ),
        contentType: "text/html; charset=utf-8",
        mediaType: representation.mediaType,
        source: "current-checkout",
        policyVersion: ASSET_PREVIEW_POLICY_VERSION,
        surface: "bundle-resource",
        contentSecurityPolicy: ASSET_PREVIEW_CONTENT_SECURITY_POLICY,
        bundlePolicyVersion: ASSET_PREVIEW_BUNDLE_POLICY_VERSION,
        resourcePath: normalized,
      };
    },
  });
