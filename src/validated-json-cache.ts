import { lstat } from "node:fs/promises";
import type { z } from "zod";
import { readContainedFile, resolveContainedPath, resolveRepositoryRoot } from "./path-boundary";

export const MAXIMUM_VALIDATED_JSON_CACHE_BYTES = 16 * 1024 * 1024;

export type ValidatedJsonCacheRead<Value> =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "malformed" }>
  | Readonly<{ kind: "available"; value: Value; bytes: Buffer }>;

const missing = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

export const readValidatedJsonCache = async <Schema extends z.ZodType>(
  input: Readonly<{
    namespacePath: string;
    cachePath: string;
    targetPath: string;
    schema: Schema;
    maximumBytes?: number;
  }>,
): Promise<ValidatedJsonCacheRead<z.output<Schema>>> => {
  try {
    const namespace = await lstat(input.namespacePath);
    if (!namespace.isDirectory() || namespace.isSymbolicLink()) return { kind: "malformed" };
    const namespacePath = await resolveRepositoryRoot(input.namespacePath);
    const cachePath = await resolveContainedPath(namespacePath, input.cachePath);
    const cache = await lstat(cachePath);
    if (!cache.isDirectory() || cache.isSymbolicLink()) return { kind: "malformed" };
    const targetPath = await resolveContainedPath(cachePath, input.targetPath);
    const target = await lstat(targetPath);
    if (
      !target.isFile() ||
      target.isSymbolicLink() ||
      target.nlink !== 1 ||
      (input.maximumBytes !== undefined && target.size > input.maximumBytes)
    ) {
      return { kind: "malformed" };
    }
    const bytes = await readContainedFile(
      cachePath,
      targetPath,
      input.maximumBytes === undefined ? {} : { maximumBytes: input.maximumBytes },
    );
    const parsed = input.schema.safeParse(JSON.parse(bytes.toString("utf8")));
    return parsed.success
      ? { kind: "available", value: parsed.data, bytes }
      : { kind: "malformed" };
  } catch (error) {
    return missing(error) ? { kind: "missing" } : { kind: "malformed" };
  }
};

export const serializeValidatedJson = <Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): Buffer => Buffer.from(`${JSON.stringify(schema.parse(value), null, 2)}\n`, "utf8");
