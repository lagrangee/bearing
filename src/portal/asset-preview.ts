import { lstat } from "node:fs/promises";
import { extname } from "node:path";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { probeContainedInput } from "../input-boundary";
import { readContainedFile } from "../path-boundary";
import { readProjectSnapshotCache } from "../project-snapshot/cache";
import { assetIdSchema } from "../project-snapshot/schema-primitives";
import { readProjectSitemapCache } from "../sitemap-cache";
import type { CatalogReadResult } from "./contract";
import { resolveProjectEntry } from "./project-entry";

export const ASSET_PREVIEW_POLICY_VERSION = 1 as const;
export const MAX_ASSET_PREVIEW_BYTES = 4 * 1024 * 1024;
export const ASSET_PREVIEW_CONTENT_SECURITY_POLICY =
  "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; object-src data:; connect-src 'none'; frame-ancestors 'none'; font-src 'none'; navigate-to 'none'";

export type AssetPreviewAvailability =
  | "available"
  | "unsupported"
  | "unsafe"
  | "exceeds-limit"
  | "preview-entry-missing";

export type AssetPreviewUnavailableCode =
  | "project-unavailable"
  | "snapshot-unavailable"
  | "asset-not-registered"
  | "content-missing"
  | "content-unreadable"
  | "stale-registration"
  | "unsupported-filesystem-type"
  | "unsafe-content"
  | "unsupported-content"
  | "content-exceeds-limit";

export type AssetPreviewResolution =
  | Readonly<{
      kind: "available";
      body: Buffer;
      contentType: "text/html; charset=utf-8";
      mediaType: string;
      source: "current-checkout";
      policyVersion: typeof ASSET_PREVIEW_POLICY_VERSION;
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

const previewDocument = (title: string, body: string): Buffer =>
  Buffer.from(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>${safeText(title)}</title></head><body><header><p>Asset Preview · current-checkout content</p><p>This is not historical Snapshot bytes; the registered Asset was revalidated against the current checkout.</p></header><main>${body}</main></body></html>`,
    "utf8",
  );

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

const renderRepresentation = (
  title: string,
  bytes: Buffer,
  representation: PreviewRepresentation,
): Buffer => {
  const value = bytes.toString("utf8");
  switch (representation.kind) {
    case "markdown":
      return previewDocument(title, safeHtml(markdown.render(value)));
    case "html":
      return previewDocument(title, safeHtml(value));
    case "text":
      return previewDocument(title, `<pre>${safeText(value)}</pre>`);
    case "image":
      return previewDocument(
        title,
        `<figure><img alt="${safeText(title)}" src="${dataUri(representation.mediaType, bytes)}"><figcaption>Browser-native image surface</figcaption></figure>`,
      );
    case "audio":
      return previewDocument(
        title,
        `<audio controls src="${dataUri(representation.mediaType, bytes)}">Audio preview unavailable in this browser.</audio>`,
      );
    case "video":
      return previewDocument(
        title,
        `<video controls src="${dataUri(representation.mediaType, bytes)}">Video preview unavailable in this browser.</video>`,
      );
    case "pdf":
      return previewDocument(
        title,
        `<object data="${dataUri(representation.mediaType, bytes)}" type="${representation.mediaType}">PDF preview unavailable in this browser.</object>`,
      );
  }
};

export const createAssetPreviewService = (options: {
  readonly readCatalog: () => Promise<CatalogReadResult>;
}): AssetPreviewService =>
  Object.freeze({
    async resolve(entryId: string, assetId: string): Promise<AssetPreviewResolution> {
      const parsedAssetId = assetIdSchema.safeParse(assetId);
      if (!parsedAssetId.success) {
        return unavailable(
          "asset-not-registered",
          "The requested Asset identity is invalid.",
          "preview-entry-missing",
        );
      }
      const entry = await resolveProjectEntry({ entryId, readCatalog: options.readCatalog });
      if (entry.kind !== "available") {
        return unavailable(
          "project-unavailable",
          "The registered project is unavailable.",
          "preview-entry-missing",
        );
      }
      const sitemap = await readProjectSitemapCache(entry.entry.repoRoot);
      if (sitemap.kind !== "available") {
        return unavailable(
          "snapshot-unavailable",
          "The current project generation is unavailable.",
          "preview-entry-missing",
        );
      }
      const cache = await readProjectSnapshotCache(
        entry.entry.repoRoot,
        sitemap.envelope.inputFingerprint,
      );
      if (cache.kind !== "available") {
        return unavailable(
          "stale-registration",
          "The registered Asset does not have matching current revision evidence.",
          "preview-entry-missing",
        );
      }
      if (cache.snapshot.assets.validity === "invalid") {
        return unavailable(
          "snapshot-unavailable",
          "The Asset projection is unavailable.",
          "preview-entry-missing",
        );
      }
      const asset = cache.snapshot.assets.items.find(
        (candidate) => candidate.id === parsedAssetId.data,
      );
      if (asset === undefined) {
        return unavailable(
          "asset-not-registered",
          "The requested Asset is not registered in this project.",
          "preview-entry-missing",
        );
      }
      if (asset.contentAvailability === "missing") {
        return unavailable(
          "content-missing",
          "The registered Asset content is missing.",
          "preview-entry-missing",
        );
      }
      if (asset.contentAvailability === "unreadable") {
        return unavailable(
          "content-unreadable",
          "The registered Asset content is unreadable.",
          "unsafe",
        );
      }

      const probe = await probeContainedInput(entry.entry.repoRoot, asset.displayLocation);
      if (probe.status === "missing") {
        return unavailable(
          "content-missing",
          "The registered Asset content is missing.",
          "preview-entry-missing",
        );
      }
      if (probe.status === "blocked") {
        return unavailable(
          "unsafe-content",
          "The registered Asset failed current-checkout containment.",
          "unsafe",
        );
      }
      const metadata = await lstat(probe.path);
      if (!metadata.isFile()) {
        return unavailable(
          "unsupported-filesystem-type",
          "This Asset is a directory or unsupported filesystem type; bundle preview is not part of this ticket.",
          "unsupported",
        );
      }
      if (metadata.size > MAX_ASSET_PREVIEW_BYTES) {
        return unavailable(
          "content-exceeds-limit",
          "This Asset exceeds the versioned single-file preview limit.",
          "exceeds-limit",
        );
      }
      const representation = representationFor(asset.displayLocation);
      if (representation === undefined) {
        const extension = extname(asset.displayLocation).toLowerCase();
        return unsafeExtensions.has(extension)
          ? unavailable(
              "unsafe-content",
              "Executable or runtime content is never previewed.",
              "unsafe",
            )
          : unavailable(
              "unsupported-content",
              "This Asset type is not supported for safe preview.",
              "unsupported",
            );
      }
      let bytes: Buffer;
      try {
        bytes = await readContainedFile(entry.entry.repoRoot, probe.path, {
          maximumBytes: MAX_ASSET_PREVIEW_BYTES,
        });
      } catch {
        return unavailable(
          "unsafe-content",
          "The Asset changed or failed safety validation while it was read.",
          "unsafe",
        );
      }
      return {
        kind: "available",
        body: renderRepresentation(asset.title, bytes, representation),
        contentType: "text/html; charset=utf-8",
        mediaType: representation.mediaType,
        source: "current-checkout",
        policyVersion: ASSET_PREVIEW_POLICY_VERSION,
      };
    },
  });
