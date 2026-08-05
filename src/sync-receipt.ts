import { lstat, readFile } from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import {
  SYNC_RECEIPT_SCHEMA_VERSION,
  type SyncReceipt,
  type SyncReceiptCompletion,
  syncReceiptSchema,
} from "./sync-receipt-schema";

export {
  SYNC_RECEIPT_SCHEMA_VERSION,
  type SyncReceipt,
  type SyncReceiptCompletion,
  syncReceiptSchema,
} from "./sync-receipt-schema";

export type SyncReceiptReadResult =
  | Readonly<{ kind: "available"; receipt: SyncReceipt }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "malformed" }>
  | Readonly<{ kind: "unsupported"; schemaVersion: number }>;

type TargetState =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "regular-file"; mode: number }>
  | Readonly<{ kind: "unsafe" }>;

export class SyncReceiptTargetError extends Error {
  readonly name = "SyncReceiptTargetError";

  constructor(readonly target: string) {
    super(`Sync Receipt target must be one unlinked regular file: ${target}`);
  }
}

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

const inspectTarget = async (target: string): Promise<TargetState> => {
  try {
    const metadata = await lstat(target);
    if (metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1) {
      return { kind: "regular-file", mode: metadata.mode };
    }
    return { kind: "unsafe" };
  } catch (error) {
    if (isMissingPathError(error)) return { kind: "missing" };
    throw error;
  }
};

const assertNever = (value: never): never => {
  void value;
  throw new TypeError("Unexpected Sync Receipt target state.");
};

export const createSyncReceipt = (completion: SyncReceiptCompletion): SyncReceipt =>
  syncReceiptSchema.parse({
    schemaVersion: SYNC_RECEIPT_SCHEMA_VERSION,
    ...completion,
  });

export const readSyncReceipt = async (target: string): Promise<SyncReceiptReadResult> => {
  const targetState = await inspectTarget(target);
  switch (targetState.kind) {
    case "missing":
      return { kind: "missing" };
    case "unsafe":
      return { kind: "malformed" };
    case "regular-file":
      break;
    default:
      return assertNever(targetState);
  }

  let bytes: string;
  try {
    bytes = await readFile(target, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return { kind: "missing" };
    throw error;
  }

  let document: unknown;
  try {
    document = JSON.parse(bytes);
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "malformed" };
    throw error;
  }

  const version = z.object({ schemaVersion: z.number().int() }).safeParse(document);
  if (!version.success) return { kind: "malformed" };
  if (version.data.schemaVersion !== SYNC_RECEIPT_SCHEMA_VERSION) {
    return { kind: "unsupported", schemaVersion: version.data.schemaVersion };
  }
  const parsed = syncReceiptSchema.safeParse(document);
  return parsed.success ? { kind: "available", receipt: parsed.data } : { kind: "malformed" };
};

export const writeSyncReceipt = async (target: string, receipt: SyncReceipt): Promise<void> => {
  const targetState = await inspectTarget(target);
  let mode: number;
  switch (targetState.kind) {
    case "missing":
      mode = 0o644;
      break;
    case "regular-file":
      mode = targetState.mode & 0o777;
      break;
    case "unsafe":
      throw new SyncReceiptTargetError(target);
    default:
      return assertNever(targetState);
  }
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeFileAtomic(target, bytes, { mode });
};
