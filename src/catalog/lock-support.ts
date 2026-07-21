import { open, readdir } from "node:fs/promises";
import type { LockOwner } from "./lock-owner";

export const lockDelay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const hasErrorCode = (error: unknown, ...codes: string[]): boolean =>
  error instanceof Error && "code" in error && codes.includes(String(error.code));

export const hasExactEntries = async (
  target: string,
  expected: readonly string[],
): Promise<boolean> => {
  try {
    const entries = (await readdir(target)).sort();
    const sorted = [...expected].sort();
    return entries.length === sorted.length && entries.every((entry, i) => entry === sorted[i]);
  } catch {
    return false;
  }
};

export const writeLockOwner = async (target: string, owner: LockOwner): Promise<void> => {
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(Buffer.from(`${JSON.stringify(owner)}\n`));
    await handle.sync();
  } finally {
    await handle.close();
  }
};
