import { lstat } from "node:fs/promises";
import { extname } from "node:path";
import { probeContainedInput } from "../input-boundary";
import { readContainedFile } from "../path-boundary";
import type { AssetProjection } from "../project-generation/contract";
import { assetIdSchema } from "../project-generation/schema-primitives";
import {
  PortalProjectReadModelUnavailableError,
  queryPortalAssetRow,
} from "../project-read-model/portal";
import {
  CONTAINED_PREVIEW_CONTENT_SECURITY_POLICY,
  CONTAINED_PREVIEW_POLICY_VERSION,
  MAX_CONTAINED_PREVIEW_BYTES,
  previewRepresentationFor,
  renderContainedPreview,
  safePreviewText,
} from "./contained-preview";
import type { CatalogReadResult } from "./contract";
import { resolveProjectEntry } from "./project-entry";

export const ASSET_PREVIEW_POLICY_VERSION = CONTAINED_PREVIEW_POLICY_VERSION;
export const MAX_ASSET_PREVIEW_BYTES = MAX_CONTAINED_PREVIEW_BYTES;
export const ASSET_PREVIEW_CONTENT_SECURITY_POLICY = CONTAINED_PREVIEW_CONTENT_SECURITY_POLICY;

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

export type AssetPreviewService = Readonly<{
  resolve(entryId: string, assetId: string): Promise<AssetPreviewResolution>;
}>;

export type AssetPreviewRowReader = (
  repoRoot: string,
  assetId: string,
) => ReturnType<typeof queryPortalAssetRow>;

const assetDetailHref = (entryId: string, assetId: string): string =>
  `/projects/${encodeURIComponent(entryId)}/lineage/asset/${encodeURIComponent(assetId)}`;

const returnControl = (href: string, label: string): string =>
  `<button type="button" data-bearing-return data-bearing-return-href="${escapeAttribute(href)}" onclick="window.close()">${safePreviewText(label)}</button>`;

export const assetPreviewUnavailableDocument = (
  entryId: string,
  assetId: string,
  result: Extract<AssetPreviewResolution, { kind: "unavailable" }>,
): string => {
  const returnButton = returnControl(assetDetailHref(entryId, assetId), "Return to Asset detail");
  if (result.code === "preview-not-offered") {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>Preview not offered</title></head><body><header>${returnButton}</header><main><h1>Preview not offered</h1><p>Cause: ${safePreviewText(result.message)}</p><p>Impact: Bearing exposes no content or runtime resources for this Asset.</p><p>Return to Asset detail to read its semantic information or inspect provenance in Technical Details.</p></main></body></html>`;
  }
  if (result.code === "project-data-needs-rebuild" || result.code === "project-data-needs-update") {
    const recovery =
      result.code === "project-data-needs-rebuild"
        ? "Use the Agent Surface to rebuild project data, then open this Asset again."
        : "Install a compatible Bearing runtime, then open this Asset again.";
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>Content unavailable</title></head><body><header>${returnButton}<p>View Content · current-checkout content</p></header><main><h1>Content unavailable</h1><p>Cause: ${safePreviewText(result.message)}</p><p>Impact: this Asset content cannot be read on the current content surface.</p><p>Recovery: ${recovery}</p></main></body></html>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${ASSET_PREVIEW_CONTENT_SECURITY_POLICY}"><title>Content unavailable</title></head><body><header>${returnButton}<p>View Content · current-checkout content</p></header><main><h1>Content unavailable</h1><p>Cause: ${safePreviewText(result.message)}</p><p>Impact: this Asset content cannot be read on the current content surface.</p><p>Recovery: return to Asset detail, open Technical Details, repair the registered source, then open this Asset again.</p></main></body></html>`;
};

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
  const representation = previewRepresentationFor(context.asset.sourceLocator);
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
      body: renderContainedPreview(
        context.asset.title,
        bytes,
        representation,
        assetDetailHref(entryId, context.asset.id),
        {
          returnLabel: "Return to Asset detail",
          historyNote:
            "This is not historical Project Read Model bytes; the registered Asset was revalidated against the current checkout.",
        },
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
