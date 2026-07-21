import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { manifestSchema } from "../schema-definitions";
import type { CatalogAvailability } from "./availability";

type ManifestAvailability = Exclude<CatalogAvailability, "missing">;

const unavailableState = (error: unknown): ManifestAvailability =>
  error instanceof Error && "code" in error && error.code === "ENOENT"
    ? "manifest-missing"
    : "unreadable";

export const probeRepositoryManifest = async (repoRoot: string): Promise<ManifestAvailability> => {
  const bearingRoot = join(repoRoot, ".bearing");
  try {
    const metadata = await lstat(bearingRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return "invalid-manifest";
  } catch (error) {
    if (!(error instanceof Error)) return "unreadable";
    return unavailableState(error);
  }

  const manifestPath = join(bearingRoot, "manifest.json");
  try {
    const metadata = await lstat(manifestPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      return "invalid-manifest";
    }
  } catch (error) {
    if (!(error instanceof Error)) return "unreadable";
    return unavailableState(error);
  }

  try {
    manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    return "available";
  } catch (error) {
    if (error instanceof Error && "code" in error) return "unreadable";
    return "invalid-manifest";
  }
};
