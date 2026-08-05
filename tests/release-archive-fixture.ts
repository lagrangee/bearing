import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pack } from "tar-stream";

export type TarFixtureEntry = Readonly<{
  path: string;
  bytes?: string | Buffer;
  mode?: number;
  type?: "file" | "directory" | "symlink" | "fifo";
  linkname?: string;
}>;

export const writeTarGzFixture = async (
  target: string,
  entries: readonly TarFixtureEntry[],
): Promise<void> => {
  const archive = pack();
  const output = pipeline(archive, createGzip(), createWriteStream(target));
  for (const entry of entries) {
    const bytes = Buffer.isBuffer(entry.bytes)
      ? entry.bytes
      : Buffer.from(entry.bytes ?? "", "utf8");
    await new Promise<void>((resolve, reject) => {
      archive.entry(
        {
          name: entry.path,
          type: entry.type ?? "file",
          mode: entry.mode ?? 0o644,
          ...(entry.linkname === undefined ? {} : { linkname: entry.linkname }),
          size: bytes.byteLength,
        },
        bytes,
        (error) => (error === null ? resolve() : reject(error)),
      );
    });
  }
  archive.finalize();
  await output;
};
