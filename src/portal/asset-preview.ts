import { lstat } from "node:fs/promises";
import { extname } from "node:path";
import sanitizeHtml from "sanitize-html";
import { probeContainedInput } from "../input-boundary";
import { readContainedFile } from "../path-boundary";
import type { AssetProjection } from "../project-generation/contract";
import { assetIdSchema } from "../project-generation/schema-primitives";
import {
  PortalProjectReadModelUnavailableError,
  queryPortalAssetRow,
} from "../project-read-model/portal";
import type { CatalogReadResult } from "./contract";
import { sharedMarkdownEngine } from "./markdown-engine";
import { resolveProjectEntry } from "./project-entry";

export const ASSET_PREVIEW_POLICY_VERSION = 1 as const;
export const MAX_ASSET_PREVIEW_BYTES = 4 * 1024 * 1024;
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
  | "project-data-unavailable"
  | "project-data-needs-rebuild"
  | "project-data-needs-update"
  | "asset-not-registered"
  | "preview-not-offered"
  | "content-missing"
  | "content-unreadable"
  | "unsupported-filesystem-type"
  | "unsafe-content"
  | "unsupported-content"
  | "content-exceeds-limit";

export type AssetPreviewResolution =
  | Readonly<{
      kind: "available";
      body: Buffer;
      contentType: string;
      mediaType: string;
      source: "current-checkout";
      policyVersion: typeof ASSET_PREVIEW_POLICY_VERSION;
      surface: "file";
      contentSecurityPolicy: string;
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
}>;

export type AssetPreviewRowReader = (
  repoRoot: string,
  assetId: string,
) => ReturnType<typeof queryPortalAssetRow>;

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
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>Preview not offered</title></head><body><header>${returnControl}</header><main><h1>Preview not offered</h1><p>Cause: ${safeText(result.message)}</p><p>Impact: Bearing exposes no content or runtime resources for this Asset.</p><p>Return to Asset detail to read its semantic information or inspect provenance in Technical Details.</p></main></body></html>`;
  }
  if (result.code === "project-data-needs-rebuild" || result.code === "project-data-needs-update") {
    const recovery =
      result.code === "project-data-needs-rebuild"
        ? "Use the Agent Surface to rebuild project data, then open this Asset again."
        : "Install a compatible Bearing runtime, then open this Asset again.";
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>Content unavailable</title></head><body><header>${returnControl}<p>View Content · current-checkout content</p></header><main><h1>Content unavailable</h1><p>Cause: ${safeText(result.message)}</p><p>Impact: this Asset content cannot be read on the current content surface.</p><p>Recovery: ${recovery}</p></main></body></html>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>Content unavailable</title></head><body><header>${returnControl}<p>View Content · current-checkout content</p></header><main><h1>Content unavailable</h1><p>Cause: ${safeText(result.message)}</p><p>Impact: this Asset content cannot be read on the current content surface.</p><p>Recovery: return to Asset detail, open Technical Details, repair the registered source, then open this Asset again.</p></main></body></html>`;
};

const previewDocument = (title: string, body: string, returnHref: string): Buffer =>
  Buffer.from(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>${safeText(title)}</title></head><body><header>${returnToAssetDetailControl(returnHref)}<p>View Content · current-checkout content</p><p>This is not historical Project Read Model bytes; the registered Asset was revalidated against the current checkout.</p></header><main>${body}</main></body></html>`,
    "utf8",
  );

type RegisteredAssetContext = Readonly<{
  repoRoot: string;
  asset: AssetProjection;
  path: string;
}>;

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

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
  readAssetRow: AssetPreviewRowReader,
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
  let assetRow: Awaited<ReturnType<typeof queryPortalAssetRow>>;
  try {
    assetRow = await readAssetRow(entry.entry.repoRoot, parsedAssetId.data);
  } catch (error) {
    if (error instanceof PortalProjectReadModelUnavailableError) {
      return {
        kind: "unavailable",
        resolution: unavailable(
          error.reason === "need-rebuild"
            ? "project-data-needs-rebuild"
            : "project-data-needs-update",
          error.reason === "need-rebuild"
            ? "Project data needs an explicit rebuild."
            : "Project data needs a compatible Bearing runtime.",
          "unavailable",
        ) as UnavailableResolution,
      };
    }
    return {
      kind: "unavailable",
      resolution: unavailable(
        "project-data-unavailable",
        "Project data is unavailable.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  if (assetRow.state === "unavailable") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "project-data-unavailable",
        "The Asset projection is unavailable.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  if (assetRow.state === "missing") {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "asset-not-registered",
        "The requested Asset is not registered in this project.",
        "unavailable",
      ) as UnavailableResolution,
    };
  }
  const asset = assetRow.asset;
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
  if (asset.sourceLocator.startsWith("https://")) {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "preview-not-offered",
        "External HTTPS Asset sources are opened separately and remain unverified.",
        "not-offered",
      ) as UnavailableResolution,
    };
  }
  const probe = await probeContainedInput(entry.entry.repoRoot, asset.sourceLocator);
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
  if (metadata.isDirectory()) {
    return {
      kind: "unavailable",
      resolution: unavailable(
        "preview-not-offered",
        "Content preview is not offered for directory Assets.",
        "not-offered",
      ) as UnavailableResolution,
    };
  }
  if (!metadata.isFile()) {
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
    },
  };
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
      return previewDocument(title, sharedMarkdownEngine.renderFragment(value).html, returnHref);
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
  const representation = representationFor(context.asset.sourceLocator);
  if (representation === undefined) {
    const extension = extname(context.asset.sourceLocator).toLowerCase();
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
  readonly readAssetRow?: AssetPreviewRowReader;
}): AssetPreviewService =>
  Object.freeze({
    async resolve(entryId: string, assetId: string): Promise<AssetPreviewResolution> {
      const registered = await resolveRegisteredAsset(
        entryId,
        assetId,
        options.readCatalog,
        options.readAssetRow ?? queryPortalAssetRow,
      );
      if (registered.kind === "unavailable") return registered.resolution;
      return fileResolution(registered.context, entryId);
    },
  });
