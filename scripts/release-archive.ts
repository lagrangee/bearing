import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";

export type ReleaseArchiveEntry = Readonly<{
  path: string;
  type: string;
  mode: number;
  size: number;
  linkname?: string;
  bytes: Buffer;
}>;

export type ReleaseArchiveLimits = Readonly<{
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}>;

const defaultLimits: ReleaseArchiveLimits = Object.freeze({
  maxEntries: 4_096,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
});

export const readReleaseTarGz = async (
  artifactPath: string,
  limits: ReleaseArchiveLimits = defaultLimits,
): Promise<readonly ReleaseArchiveEntry[]> => {
  const archive = extract();
  const entries: ReleaseArchiveEntry[] = [];
  let totalBytes = 0;
  let boundaryError: Error | undefined;

  const fail = (message: string): void => {
    boundaryError ??= new Error(message);
    archive.destroy();
  };

  archive.on("entry", (header, stream, next) => {
    if (entries.length >= limits.maxEntries) {
      stream.resume();
      fail(`candidate archive exceeds ${limits.maxEntries} entries`);
      return;
    }
    const size = header.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      stream.resume();
      fail(`candidate archive entry has an invalid size: ${header.name}`);
      return;
    }
    if (size > limits.maxEntryBytes) {
      stream.resume();
      fail(`candidate archive entry exceeds ${limits.maxEntryBytes} bytes: ${header.name}`);
      return;
    }
    if (totalBytes + size > limits.maxTotalBytes) {
      stream.resume();
      fail(`candidate archive exceeds ${limits.maxTotalBytes} uncompressed bytes`);
      return;
    }

    const chunks: Buffer[] = [];
    let received = 0;
    stream.on("data", (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > size || received > limits.maxEntryBytes) {
        fail(`candidate archive entry size is inconsistent: ${header.name}`);
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    stream.on("end", () => {
      if (boundaryError !== undefined) return;
      if (received !== size) {
        fail(`candidate archive entry size is inconsistent: ${header.name}`);
        return;
      }
      totalBytes += received;
      entries.push(
        Object.freeze({
          path: header.name,
          type: header.type ?? "file",
          mode: header.mode ?? 0,
          size,
          ...(header.linkname === undefined || header.linkname === null
            ? {}
            : { linkname: header.linkname }),
          bytes: Buffer.concat(chunks, received),
        }),
      );
      next();
    });
    stream.on("error", (error) => {
      boundaryError = error;
      archive.destroy();
    });
  });

  try {
    await pipeline(createReadStream(artifactPath), createGunzip(), archive);
  } catch (error) {
    if (boundaryError !== undefined) throw boundaryError;
    throw new Error(`could not read candidate archive: ${artifactPath}`, { cause: error });
  }
  if (boundaryError !== undefined) throw boundaryError;
  return Object.freeze(entries);
};
