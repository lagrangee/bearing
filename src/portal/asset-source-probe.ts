import { lstat } from "node:fs/promises";
import { probeContainedInput } from "../input-boundary";

export type AssetSourceProbe =
  | Readonly<{ kind: "external"; href: string; verification: "unverified" }>
  | Readonly<{
      kind: "local";
      locator: string;
      availability: "file" | "directory" | "missing" | "unreadable" | "unsafe";
    }>;

export const probeExactAssetSource = async (
  repoRoot: string,
  locator: string,
): Promise<AssetSourceProbe | undefined> => {
  if (locator.startsWith("https://")) {
    return { kind: "external", href: locator, verification: "unverified" };
  }
  const probe = await probeContainedInput(repoRoot, locator);
  if (probe.status === "missing") return { kind: "local", locator, availability: "missing" };
  if (probe.status === "blocked") return { kind: "local", locator, availability: "unsafe" };
  try {
    const metadata = await lstat(probe.path);
    return {
      kind: "local",
      locator,
      availability: metadata.isFile()
        ? "file"
        : metadata.isDirectory()
          ? "directory"
          : "unreadable",
    };
  } catch {
    return { kind: "local", locator, availability: "unreadable" };
  }
};
