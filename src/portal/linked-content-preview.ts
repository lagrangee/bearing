import { createHash, randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import { basename, extname, posix, resolve } from "node:path";
import { probeContainedInput } from "../input-boundary";
import { isRepositoryPathBoundaryError, readContainedFile } from "../path-boundary";
import {
  CONTAINED_PREVIEW_CONTENT_SECURITY_POLICY,
  CONTAINED_PREVIEW_POLICY_VERSION,
  MAX_CONTAINED_PREVIEW_BYTES,
  type PreviewRepresentation,
  previewRepresentationFor,
  renderContainedPreview,
  safePreviewText,
} from "./contained-preview";
import type { CatalogReadResult } from "./contract";
import { resolveProjectEntry } from "./project-entry";

export const MAX_LINKED_IMAGE_PREVIEW_BYTES = 16 * 1024 * 1024;

export type LinkedContentUnavailableCode =
  | "project-unavailable"
  | "content-missing"
  | "content-unreadable"
  | "unsupported-filesystem-type"
  | "unsafe-content"
  | "unsupported-content"
  | "content-exceeds-limit";

export type LinkedContentPresentation =
  | Readonly<{
      kind: "available";
      representation: PreviewRepresentation["kind"];
      token: string;
      previewHref: string;
      thumbnailSrc?: string | undefined;
    }>
  | Readonly<{
      kind: "unavailable";
      code: LinkedContentUnavailableCode;
      availability: "unavailable" | "unsupported" | "unsafe" | "exceeds-limit";
      message: string;
    }>;

export type LinkedContentPreviewResolution =
  | Readonly<{
      kind: "available";
      body: Buffer;
      contentType: string;
      mediaType: string;
      source: "current-checkout";
      policyVersion: 1;
      surface: "file" | "thumbnail";
      contentSecurityPolicy: string;
    }>
  | Extract<LinkedContentPresentation, { kind: "unavailable" }>;

type LinkedTarget = Readonly<{
  entryId: string;
  targetLocator: string;
  usage: "image" | "link";
}>;

export type LinkedContentPreviewService = Readonly<{
  present(
    input: Readonly<{
      entryId: string;
      sourceLocator: string;
      authoredHref: string;
      usage: "image" | "link";
    }>,
  ): Promise<LinkedContentPresentation>;
  resolve(
    entryId: string,
    token: string,
    surface: "preview" | "content",
  ): Promise<LinkedContentPreviewResolution>;
}>;

const unavailable = (
  code: LinkedContentUnavailableCode,
  message: string,
  availability: Extract<LinkedContentPresentation, { kind: "unavailable" }>["availability"],
): Extract<LinkedContentPresentation, { kind: "unavailable" }> => ({
  kind: "unavailable",
  code,
  availability,
  message,
});

const localTargetLocator = (sourceLocator: string, authoredHref: string): string | undefined => {
  const normalizedSource = posix.normalize(sourceLocator);
  if (
    sourceLocator.length === 0 ||
    sourceLocator.includes("\\") ||
    sourceLocator.startsWith("/") ||
    normalizedSource === ".." ||
    normalizedSource.startsWith("../") ||
    authoredHref.length === 0 ||
    authoredHref.startsWith("#") ||
    authoredHref.startsWith("?") ||
    authoredHref.startsWith("/") ||
    authoredHref.startsWith("\\") ||
    authoredHref.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(authoredHref) ||
    authoredHref.startsWith("//")
  ) {
    return undefined;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(authoredHref.split(/[?#]/u, 1)[0] ?? "");
  } catch {
    return undefined;
  }
  if (
    pathname.length === 0 ||
    pathname.includes("\0") ||
    pathname.includes("\\") ||
    pathname.startsWith("/")
  ) {
    return undefined;
  }
  const sourceDirectory = posix.dirname(normalizedSource);
  const locator = posix.normalize(posix.join(sourceDirectory, pathname));
  return locator === ".." || locator.startsWith("../") ? undefined : locator;
};

const limitFor = (representation: PreviewRepresentation): number =>
  representation.kind === "image" ? MAX_LINKED_IMAGE_PREVIEW_BYTES : MAX_CONTAINED_PREVIEW_BYTES;

const isSystemError = (error: unknown): error is Error & Readonly<{ code: string }> =>
  error instanceof Error && "code" in error && typeof error.code === "string";

const inspectTarget = async (
  repoRoot: string,
  target: LinkedTarget,
): Promise<
  | Readonly<{
      kind: "available";
      representation: PreviewRepresentation;
      path: string;
      bytes: Buffer;
    }>
  | Extract<LinkedContentPresentation, { kind: "unavailable" }>
> => {
  const probe = await probeContainedInput(repoRoot, target.targetLocator);
  if (probe.status === "missing") {
    return unavailable("content-missing", "The linked content is missing.", "unavailable");
  }
  if (probe.status === "blocked") {
    try {
      const apparent = await lstat(resolve(repoRoot, target.targetLocator));
      if (apparent.isFile() && apparent.nlink === 1) {
        return unavailable(
          "content-unreadable",
          "The linked content is unreadable.",
          "unavailable",
        );
      }
    } catch {
      // Keep the fail-closed safety classification below.
    }
    return unavailable(
      "unsafe-content",
      "The linked content failed repository containment or link safety checks.",
      "unsafe",
    );
  }
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(probe.path);
  } catch (error) {
    return isSystemError(error) && (error.code === "EACCES" || error.code === "EPERM")
      ? unavailable("content-unreadable", "The linked content is unreadable.", "unavailable")
      : unavailable(
          "unsafe-content",
          "The linked content changed during safety validation.",
          "unsafe",
        );
  }
  if (!metadata.isFile()) {
    return unavailable(
      "unsupported-filesystem-type",
      metadata.isDirectory()
        ? "The linked target is a directory, not a Preview file."
        : "The linked target is not a regular file.",
      "unsupported",
    );
  }
  const representation = previewRepresentationFor(target.targetLocator);
  if (
    representation === undefined ||
    (target.usage === "image" && representation.kind !== "image")
  ) {
    const unsafe = new Set([
      ".app",
      ".dmg",
      ".dll",
      ".dylib",
      ".exe",
      ".msi",
      ".pkg",
      ".so",
      ".wasm",
    ]).has(extname(target.targetLocator).toLowerCase());
    return unavailable(
      unsafe ? "unsafe-content" : "unsupported-content",
      unsafe
        ? "Executable or runtime linked content is never previewed."
        : "This linked content type is not supported for safe Preview.",
      unsafe ? "unsafe" : "unsupported",
    );
  }
  const maximumBytes = limitFor(representation);
  if (metadata.size > maximumBytes) {
    return unavailable(
      "content-exceeds-limit",
      representation.kind === "image"
        ? "The linked image exceeds the 16 MiB Preview limit."
        : "The linked content exceeds the existing single-file Preview limit.",
      "exceeds-limit",
    );
  }
  try {
    return {
      kind: "available",
      representation,
      path: probe.path,
      bytes: await readContainedFile(repoRoot, probe.path, { maximumBytes }),
    };
  } catch (error) {
    if (isSystemError(error) && (error.code === "EACCES" || error.code === "EPERM")) {
      return unavailable("content-unreadable", "The linked content is unreadable.", "unavailable");
    }
    return unavailable(
      "unsafe-content",
      isRepositoryPathBoundaryError(error)
        ? "The linked content changed or failed bounded safety validation."
        : "The linked content could not be read safely.",
      "unsafe",
    );
  }
};

export const linkedContentPreviewUnavailableDocument = (
  result: Extract<LinkedContentPreviewResolution, { kind: "unavailable" }>,
): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CONTAINED_PREVIEW_CONTENT_SECURITY_POLICY}"><title>Linked content unavailable</title></head><body><main><h1>Linked content unavailable</h1><p>Cause: ${safePreviewText(result.message)}</p><p>Impact: only this authored link is unavailable. The surrounding Provider-authored section and project truth are unchanged.</p></main></body></html>`;

export const createLinkedContentPreviewService = (options: {
  readonly readCatalog: () => Promise<CatalogReadResult>;
}): LinkedContentPreviewService => {
  const salt = randomBytes(32);
  const targets = new Map<string, LinkedTarget>();
  const tokenFor = (target: LinkedTarget): string =>
    createHash("sha256")
      .update(salt)
      .update("\0")
      .update(target.entryId)
      .update("\0")
      .update(target.targetLocator)
      .update("\0")
      .update(target.usage)
      .digest("hex");
  const entryRoot = async (entryId: string): Promise<string | undefined> => {
    const entry = await resolveProjectEntry({ entryId, readCatalog: options.readCatalog });
    return entry.kind === "available" ? entry.entry.repoRoot : undefined;
  };
  return Object.freeze({
    async present(input): Promise<LinkedContentPresentation> {
      const targetLocator = localTargetLocator(input.sourceLocator, input.authoredHref);
      if (targetLocator === undefined) {
        return unavailable(
          "unsafe-content",
          "The authored link is not a safe repository-relative locator.",
          "unsafe",
        );
      }
      const repoRoot = await entryRoot(input.entryId);
      if (repoRoot === undefined) {
        return unavailable(
          "project-unavailable",
          "The registered project is unavailable.",
          "unavailable",
        );
      }
      const target: LinkedTarget = {
        entryId: input.entryId,
        targetLocator,
        usage: input.usage,
      };
      const inspected = await inspectTarget(repoRoot, target);
      if (inspected.kind === "unavailable") return inspected;
      const token = tokenFor(target);
      targets.set(token, target);
      const previewHref = `/preview/projects/${encodeURIComponent(input.entryId)}/linked/${token}`;
      return {
        kind: "available",
        representation: inspected.representation.kind,
        token,
        previewHref,
        ...(inspected.representation.kind === "image"
          ? { thumbnailSrc: `${previewHref}/content` }
          : {}),
      };
    },
    async resolve(entryId, token, surface): Promise<LinkedContentPreviewResolution> {
      const target = targets.get(token);
      if (target === undefined || target.entryId !== entryId) {
        return unavailable(
          "content-missing",
          "The linked Preview route is unavailable.",
          "unavailable",
        );
      }
      const repoRoot = await entryRoot(entryId);
      if (repoRoot === undefined) {
        return unavailable(
          "project-unavailable",
          "The registered project is unavailable.",
          "unavailable",
        );
      }
      const inspected = await inspectTarget(repoRoot, target);
      if (inspected.kind === "unavailable") return inspected;
      if (surface === "content") {
        if (inspected.representation.kind !== "image") {
          return unavailable(
            "unsupported-content",
            "Only linked images have a thumbnail content surface.",
            "unsupported",
          );
        }
        return {
          kind: "available",
          body: inspected.bytes,
          contentType: inspected.representation.mediaType,
          mediaType: inspected.representation.mediaType,
          source: "current-checkout",
          policyVersion: CONTAINED_PREVIEW_POLICY_VERSION,
          surface: "thumbnail",
          contentSecurityPolicy: CONTAINED_PREVIEW_CONTENT_SECURITY_POLICY,
        };
      }
      return {
        kind: "available",
        body: renderContainedPreview(
          basename(target.targetLocator),
          inspected.bytes,
          inspected.representation,
          `/projects/${encodeURIComponent(entryId)}`,
          {
            returnLabel: "Return to reading surface",
            historyNote:
              "This reads current-checkout linked content and is not historical Provider capture bytes.",
          },
        ),
        contentType: "text/html; charset=utf-8",
        mediaType: inspected.representation.mediaType,
        source: "current-checkout",
        policyVersion: CONTAINED_PREVIEW_POLICY_VERSION,
        surface: "file",
        contentSecurityPolicy: CONTAINED_PREVIEW_CONTENT_SECURITY_POLICY,
      };
    },
  });
};
