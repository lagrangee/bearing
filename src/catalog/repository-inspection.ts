import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { CatalogAvailability } from "./availability";
import { probeRepositoryManifest } from "./repository";

export type RepositoryInspection =
  | Readonly<{ kind: "available"; canonicalRoot: string }>
  | Readonly<{
      kind: "unavailable";
      availability: CatalogAvailability;
      reason: "missing" | "unreadable" | "unsupported-shape" | "non-canonical" | "manifest";
      canonicalRoot?: string;
    }>;

const rootAvailability = (error: unknown): "missing" | "unreadable" =>
  error instanceof Error && "code" in error && error.code === "ENOENT" ? "missing" : "unreadable";

export const inspectRepository = async (
  repoRoot: string,
  options: Readonly<{ requireCanonical: boolean }>,
): Promise<RepositoryInspection> => {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(resolve(repoRoot));
    const metadata = await lstat(canonicalRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      return { kind: "unavailable", availability: "unreadable", reason: "unsupported-shape" };
    }
  } catch (error) {
    const availability = rootAvailability(error);
    return { kind: "unavailable", availability, reason: availability };
  }
  if (options.requireCanonical && canonicalRoot !== repoRoot) {
    return {
      kind: "unavailable",
      availability: "unreadable",
      reason: "non-canonical",
      canonicalRoot,
    };
  }
  const availability = await probeRepositoryManifest(canonicalRoot);
  return availability === "available"
    ? { kind: "available", canonicalRoot }
    : { kind: "unavailable", availability, reason: "manifest", canonicalRoot };
};
