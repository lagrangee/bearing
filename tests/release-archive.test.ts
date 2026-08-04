import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReleaseTarGz } from "../scripts/release-archive";
import { writeTarGzFixture } from "./release-archive-fixture";

test("reads one gzip tar stream without extraction and enforces resource bounds", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-release-archive-"));
  const artifact = join(root, "candidate.tgz");
  try {
    await writeTarGzFixture(artifact, [
      { path: "package/README.md", bytes: "readme\n" },
      { path: "package/package.json", bytes: "{}\n" },
    ]);
    await expect(readReleaseTarGz(artifact)).resolves.toMatchObject([
      { path: "package/README.md", type: "file", size: 7 },
      { path: "package/package.json", type: "file", size: 3 },
    ]);
    await expect(
      readReleaseTarGz(artifact, { maxEntries: 1, maxEntryBytes: 64, maxTotalBytes: 64 }),
    ).rejects.toThrow("exceeds 1 entries");
    await expect(
      readReleaseTarGz(artifact, { maxEntries: 4, maxEntryBytes: 6, maxTotalBytes: 64 }),
    ).rejects.toThrow("entry exceeds 6 bytes");
    await expect(
      readReleaseTarGz(artifact, { maxEntries: 4, maxEntryBytes: 64, maxTotalBytes: 9 }),
    ).rejects.toThrow("exceeds 9 uncompressed bytes");
    await writeFile(artifact, "not gzip");
    await expect(readReleaseTarGz(artifact)).rejects.toThrow("could not read candidate archive");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
