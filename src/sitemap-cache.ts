import type { Stats } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { z } from "zod";
import { parseMarkdownEnvelope } from "./markdown-document";
import type { AdvisoryFreshness } from "./types";

const SUPPORTED_SITEMAP_VERSION = 1;
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FRESHNESS_VALUES = ["current", "stale", "unknown"] as const;

const inputLocatorSchema = z
  .string()
  .min(1)
  .refine(
    (locator) =>
      !locator.includes("\0") &&
      !locator.includes("\\") &&
      !posix.isAbsolute(locator) &&
      posix.normalize(locator) === locator &&
      locator !== "." &&
      locator !== ".." &&
      !locator.startsWith("../"),
    { message: "Inputs must contain normalized repository-relative POSIX locators." },
  );

const inputListSchema = z
  .array(inputLocatorSchema)
  .refine((inputs) => new Set(inputs).size === inputs.length, {
    message: "Inputs must be unique.",
  })
  .refine(
    (inputs) => {
      let previous: string | undefined;
      for (const input of inputs) {
        if (
          previous !== undefined &&
          Buffer.compare(Buffer.from(previous), Buffer.from(input)) > 0
        ) {
          return false;
        }
        previous = input;
      }
      return true;
    },
    { message: "Inputs must use stable UTF-8 ordering." },
  );

const envelopeSchema = z.strictObject({
  Type: z.literal("project-sitemap"),
  Version: z.number().int().positive(),
  Inputs: inputListSchema,
  "Input fingerprint": z.string().regex(FINGERPRINT_PATTERN),
  "Advisory freshness": z.strictObject({
    "planning-audit:current": z.enum(FRESHNESS_VALUES).optional(),
  }),
});

export type ProjectSitemapCacheEnvelope = Readonly<{
  type: "project-sitemap";
  version: 1;
  inputs: readonly string[];
  inputFingerprint: string;
  advisoryFreshness: AdvisoryFreshness;
}>;

export type ProjectSitemapCacheMalformedReason =
  | "unsafe-cache-boundary"
  | "unsafe-cache-file"
  | "unreadable-cache-file"
  | "missing-frontmatter"
  | "invalid-envelope";

export type ProjectSitemapCacheResult =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "available"; envelope: ProjectSitemapCacheEnvelope }>
  | Readonly<{ kind: "malformed"; reason: ProjectSitemapCacheMalformedReason }>
  | Readonly<{ kind: "unsupported"; version: number }>;

type InspectedPath =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "available"; metadata: Stats }>
  | Readonly<{ kind: "unreadable" }>;

const inspectPath = async (target: string): Promise<InspectedPath> => {
  try {
    return { kind: "available", metadata: await lstat(target) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "unreadable" };
  }
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unexpected path inspection variant: ${JSON.stringify(value)}`);
};

const malformed = (reason: ProjectSitemapCacheMalformedReason): ProjectSitemapCacheResult => ({
  kind: "malformed",
  reason,
});

export const readProjectSitemapCache = async (
  repoRoot: string,
): Promise<ProjectSitemapCacheResult> => {
  for (const directory of [join(repoRoot, ".bearing"), join(repoRoot, ".bearing/cache")]) {
    const inspected = await inspectPath(directory);
    switch (inspected.kind) {
      case "missing":
        return { kind: "missing" };
      case "unreadable":
        return malformed("unreadable-cache-file");
      case "available":
        if (inspected.metadata.isSymbolicLink() || !inspected.metadata.isDirectory()) {
          return malformed("unsafe-cache-boundary");
        }
        break;
      default:
        return assertNever(inspected);
    }
  }

  const target = join(repoRoot, ".bearing/cache/project-sitemap.md");
  const inspected = await inspectPath(target);
  switch (inspected.kind) {
    case "missing":
      return { kind: "missing" };
    case "unreadable":
      return malformed("unreadable-cache-file");
    case "available":
      if (
        inspected.metadata.isSymbolicLink() ||
        !inspected.metadata.isFile() ||
        inspected.metadata.nlink !== 1
      ) {
        return malformed("unsafe-cache-file");
      }
      break;
    default:
      return assertNever(inspected);
  }

  let source: string;
  try {
    source = await readFile(target, "utf8");
  } catch {
    return malformed("unreadable-cache-file");
  }
  const frontmatter = parseMarkdownEnvelope(source);
  if (!frontmatter.ok) {
    return malformed(frontmatter.reason === "missing" ? "missing-frontmatter" : "invalid-envelope");
  }
  const parsed = envelopeSchema.safeParse(frontmatter.data);
  if (!parsed.success) return malformed("invalid-envelope");
  if (parsed.data.Version !== SUPPORTED_SITEMAP_VERSION) {
    return { kind: "unsupported", version: parsed.data.Version };
  }
  const parsedFreshness = parsed.data["Advisory freshness"];
  const advisoryFreshness: AdvisoryFreshness = {
    ...(parsedFreshness["planning-audit:current"] === undefined
      ? {}
      : { "planning-audit:current": parsedFreshness["planning-audit:current"] }),
  };
  return {
    kind: "available",
    envelope: {
      type: parsed.data.Type,
      version: parsed.data.Version,
      inputs: parsed.data.Inputs,
      inputFingerprint: parsed.data["Input fingerprint"],
      advisoryFreshness,
    },
  };
};
