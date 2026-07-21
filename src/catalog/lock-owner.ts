import { type BigIntStats, constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { z } from "zod";

const MAX_OWNER_BYTES = 4_096;
const ownerSchema = z.strictObject({
  pid: z.number().int().min(1).max(0x7fff_ffff),
  token: z.string().min(1),
});

export type LockOwner = z.infer<typeof ownerSchema>;
export type FileIdentity = Readonly<{
  device: bigint;
  inode: bigint;
  links: bigint;
  size: bigint;
  modifiedAt: bigint;
  changedAt: bigint;
}>;

export type LockOwnerArtifact =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "unsafe" }>
  | Readonly<{ state: "unstable" }>
  | Readonly<{
      state: "regular";
      identity: FileIdentity;
      bytes: Buffer;
      owner?: LockOwner;
    }>;

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const isSystemError = (error: unknown): error is Error & Readonly<{ code: string }> =>
  error instanceof Error && "code" in error && typeof error.code === "string";

const identityOf = (metadata: BigIntStats): FileIdentity => ({
  device: metadata.dev,
  inode: metadata.ino,
  links: metadata.nlink,
  size: metadata.size,
  modifiedAt: metadata.mtimeNs,
  changedAt: metadata.ctimeNs,
});

export const sameFileIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.device === right.device &&
  left.inode === right.inode &&
  left.links === right.links &&
  left.size === right.size &&
  left.modifiedAt === right.modifiedAt &&
  left.changedAt === right.changedAt;

const readExactBytes = async (
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<Buffer | undefined> => {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) return undefined;
    offset += result.bytesRead;
  }
  return bytes;
};

export const inspectLockOwner = async (target: string): Promise<LockOwnerArtifact> => {
  let inspected: Awaited<ReturnType<typeof lstat>>;
  try {
    inspected = await lstat(target, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return { state: "missing" };
    if (isSystemError(error)) return { state: "unsafe" };
    throw error;
  }
  if (!inspected.isFile() || inspected.nlink > 1n || inspected.size > MAX_OWNER_BYTES) {
    return { state: "unsafe" };
  }
  if (inspected.nlink === 0n) return { state: "unstable" };
  const inspectedIdentity = identityOf(inspected);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(target, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    const openedIdentity = identityOf(opened);
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.size > MAX_OWNER_BYTES ||
      !sameFileIdentity(inspectedIdentity, openedIdentity)
    ) {
      return { state: "unstable" };
    }
    const bytes = await readExactBytes(handle, Number(opened.size));
    const afterRead = await handle.stat({ bigint: true });
    if (bytes === undefined || !sameFileIdentity(openedIdentity, identityOf(afterRead))) {
      return { state: "unstable" };
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      decoded = undefined;
    }
    const parsed = ownerSchema.safeParse(decoded);
    return {
      state: "regular",
      identity: openedIdentity,
      bytes,
      ...(parsed.success ? { owner: parsed.data } : {}),
    };
  } catch (error) {
    if (isSystemError(error)) return { state: "unstable" };
    throw error;
  } finally {
    await handle?.close();
  }
};

export const sameOwnerArtifact = (
  left: Extract<LockOwnerArtifact, { state: "regular" }>,
  right: Extract<LockOwnerArtifact, { state: "regular" }>,
): boolean => sameFileIdentity(left.identity, right.identity) && left.bytes.equals(right.bytes);

export const sameMovedOwnerArtifact = (
  left: Extract<LockOwnerArtifact, { state: "regular" }>,
  right: Extract<LockOwnerArtifact, { state: "regular" }>,
): boolean =>
  left.identity.device === right.identity.device &&
  left.identity.inode === right.identity.inode &&
  left.identity.links === right.identity.links &&
  left.identity.size === right.identity.size &&
  left.bytes.equals(right.bytes);

export type OwnerProcessState = "alive" | "absent" | "indeterminate";

export const ownerProcessState = (pid: number): OwnerProcessState => {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ESRCH") return "absent";
      if (error.code === "EPERM") return "alive";
    }
    return "indeterminate";
  }
};
