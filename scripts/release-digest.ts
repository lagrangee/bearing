import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const sha256File = async (path: string): Promise<string> =>
  sha256Bytes(await readFile(path));
