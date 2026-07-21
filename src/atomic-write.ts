import { randomUUID } from "node:crypto";
import { chmod, open, rename, unlink } from "node:fs/promises";

const removeStagingFile = async (target: string): Promise<void> => {
  try {
    await unlink(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
};

export const writeFileAtomically = async (
  target: string,
  bytes: Uint8Array,
  mode: number,
): Promise<void> => {
  const temporary = `${target}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, mode);
    await rename(temporary, target);
  } catch (error) {
    if (handle !== undefined) await handle.close();
    try {
      await removeStagingFile(temporary);
    } catch (cleanupError) {
      throw new Error(`Failed to clean atomic staging file: ${temporary}`, {
        cause: cleanupError,
      });
    }
    throw error;
  }
};
