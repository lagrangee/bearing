import { extname } from "node:path";
import sanitizeHtml from "sanitize-html";
import { sharedMarkdownEngine } from "./markdown-engine";

export const CONTAINED_PREVIEW_POLICY_VERSION = 1 as const;
export const MAX_CONTAINED_PREVIEW_BYTES = 4 * 1024 * 1024;
export const CONTAINED_PREVIEW_CONTENT_SECURITY_POLICY =
  "sandbox allow-scripts; default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; object-src data:; connect-src 'none'; frame-ancestors 'none'; font-src 'none'";

export type PreviewRepresentation =
  | Readonly<{ kind: "markdown"; mediaType: "text/markdown" }>
  | Readonly<{ kind: "html"; mediaType: "text/html" }>
  | Readonly<{ kind: "text"; mediaType: string }>
  | Readonly<{ kind: "image"; mediaType: string }>
  | Readonly<{ kind: "audio"; mediaType: string }>
  | Readonly<{ kind: "video"; mediaType: string }>
  | Readonly<{ kind: "pdf"; mediaType: "application/pdf" }>;

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

export const safePreviewText = (value: string): string => sanitizeHtml(value, textSanitizerOptions);

const safeHtml = (value: string): string => sanitizeHtml(value, sanitizerOptions);

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const returnControl = (href: string, label: string): string =>
  `<button type="button" data-bearing-return data-bearing-return-href="${escapeAttribute(href)}" onclick="window.close()">${safePreviewText(label)}</button>`;

const previewDocument = (
  title: string,
  body: string,
  returnHref: string,
  context: Readonly<{ returnLabel: string; historyNote: string }>,
): Buffer =>
  Buffer.from(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CONTAINED_PREVIEW_CONTENT_SECURITY_POLICY}"><title>${safePreviewText(title)}</title></head><body><header>${returnControl(returnHref, context.returnLabel)}<p>View Content · current-checkout content</p><p>${safePreviewText(context.historyNote)}</p></header><main>${body}</main></body></html>`,
    "utf8",
  );

const dataUri = (mediaType: string, bytes: Buffer): string =>
  `data:${mediaType};base64,${bytes.toString("base64")}`;

export const previewRepresentationFor = (locator: string): PreviewRepresentation | undefined => {
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
    default:
      return undefined;
  }
};

export const renderContainedPreview = (
  title: string,
  bytes: Buffer,
  representation: PreviewRepresentation,
  returnHref: string,
  context: Readonly<{ returnLabel: string; historyNote: string }>,
): Buffer => {
  const value = bytes.toString("utf8");
  switch (representation.kind) {
    case "markdown":
      return previewDocument(
        title,
        sharedMarkdownEngine.renderFragment(value).html,
        returnHref,
        context,
      );
    case "html":
      return previewDocument(title, safeHtml(value), returnHref, context);
    case "text":
      return previewDocument(title, `<pre>${safePreviewText(value)}</pre>`, returnHref, context);
    case "image":
      return previewDocument(
        title,
        `<figure><img alt="${escapeAttribute(title)}" src="${dataUri(representation.mediaType, bytes)}"><figcaption>Browser-native image surface</figcaption></figure>`,
        returnHref,
        context,
      );
    case "audio":
      return previewDocument(
        title,
        `<audio controls src="${dataUri(representation.mediaType, bytes)}">Audio preview unavailable in this browser.</audio>`,
        returnHref,
        context,
      );
    case "video":
      return previewDocument(
        title,
        `<video controls src="${dataUri(representation.mediaType, bytes)}">Video preview unavailable in this browser.</video>`,
        returnHref,
        context,
      );
    case "pdf":
      return previewDocument(
        title,
        `<object data="${dataUri(representation.mediaType, bytes)}" type="${representation.mediaType}">PDF preview unavailable in this browser.</object>`,
        returnHref,
        context,
      );
  }
};
