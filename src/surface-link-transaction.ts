import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

export type SurfaceLinkSnapshot = Readonly<
  { kind: "missing" } | { kind: "symlink"; source: string }
>;

type SurfaceDirectoryIdentity = Readonly<{ device: number; inode: number }>;

export type AnchoredSurfaceLinkTransaction = Readonly<{
  identity: SurfaceDirectoryIdentity;
  replace: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  close: () => Promise<void>;
}>;

const helperSource = String.raw`
const { link, lstat, readlink, rename, symlink, unlink } = require("node:fs/promises");
const { createInterface } = require("node:readline");

const options = JSON.parse(process.argv[1]);
let applied = false;

const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");

const inspect = async (path) => {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) return { kind: "symlink", source: await readlink(path) };
    if (metadata.isFile()) return { kind: "file" };
    if (metadata.isDirectory()) return { kind: "directory" };
    return { kind: "other" };
  } catch (error) {
    if (error && error.code === "ENOENT") return { kind: "missing" };
    throw error;
  }
};

const restoreEntry = async (quarantine, target) => {
  const state = await inspect(quarantine);
  if (state.kind === "symlink") {
    await symlink(state.source, target, "dir");
    await unlink(quarantine);
    return;
  }
  if (state.kind === "file") {
    await link(quarantine, target);
    await unlink(quarantine);
    return;
  }
  throw new Error("Anchored recovery preserved unexpected content in quarantine: " + quarantine);
};

const quarantineExpectedSymlink = async (target, expectedSource, quarantine) => {
  await rename(target, quarantine);
  const state = await inspect(quarantine);
  if (state.kind === "symlink" && state.source === expectedSource) return;
  try {
    await restoreEntry(quarantine, target);
  } catch (error) {
    throw new Error(
      "Anchored transaction found replaced content and preserved it in quarantine: " + quarantine,
      { cause: error },
    );
  }
  throw new Error("Anchored transaction found replaced content: " + target);
};

const restoreOriginal = async () => {
  if (options.original.kind === "missing") return;
  const state = await inspect(options.retirement);
  if (state.kind !== "symlink" || state.source !== options.original.source) {
    throw new Error("Anchored recovery found changed retirement data: " + options.retirement);
  }
  await symlink(options.original.source, "bearing", "dir");
  await unlink(options.retirement);
};

const replace = async () => {
  let retired = false;
  if (options.original.kind === "symlink") {
    await quarantineExpectedSymlink("bearing", options.original.source, options.retirement);
    retired = true;
  }
  try {
    await symlink(options.source, "bearing", "dir");
  } catch (error) {
    if (retired) {
      try {
        await restoreOriginal();
      } catch (restoreError) {
        throw new Error(
          "Anchored replacement preserved the original in retirement after recovery failed: " +
            options.retirement,
          { cause: restoreError },
        );
      }
    }
    throw error;
  }
  applied = true;
};

const rollback = async () => {
  if (!applied) return;
  await quarantineExpectedSymlink("bearing", options.source, options.rollback);
  try {
    await restoreOriginal();
  } catch (error) {
    throw new Error(
      "Anchored recovery preserved the installer post-image in quarantine: " + options.rollback,
      { cause: error },
    );
  }
  await unlink(options.rollback);
  applied = false;
};

const commit = async () => {
  if (!applied) return;
  if (options.original.kind === "symlink") {
    const state = await inspect(options.retirement);
    if (state.kind !== "symlink" || state.source !== options.original.source) {
      throw new Error("Anchored commit found changed retirement data: " + options.retirement);
    }
    await unlink(options.retirement);
  }
  applied = false;
};

(async () => {
  const metadata = await lstat(".");
  send({ type: "ready", device: metadata.dev, inode: metadata.ino });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const command = JSON.parse(line);
      try {
        if (command.type === "replace") await replace();
        else if (command.type === "commit") await commit();
        else if (command.type === "rollback") await rollback();
        else throw new Error("Unknown anchored surface transaction command.");
        send({ type: "result", id: command.id, ok: true });
        if (command.type === "commit" || command.type === "rollback") return;
      } catch (error) {
        send({
          type: "result",
          id: command.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    if (applied) await rollback();
  }
})().catch((error) => {
  send({ type: "fatal", error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
`;

type HelperMessage = Readonly<Record<string, unknown>>;

const messageObject = (source: string): HelperMessage => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("Anchored surface transaction returned invalid JSON.", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Anchored surface transaction returned an invalid message.");
  }
  return parsed as HelperMessage;
};

export const createAnchoredSurfaceLinkTransaction = async (
  directory: string,
  original: SurfaceLinkSnapshot,
  source: string,
  retirement: string,
  rollbackPath: string,
): Promise<AnchoredSurfaceLinkTransaction> => {
  const child = spawn(
    process.execPath,
    [
      "--eval",
      helperSource,
      JSON.stringify({ original, source, retirement, rollback: rollbackPath }),
    ],
    { cwd: directory, stdio: ["pipe", "pipe", "pipe"] },
  );
  let spawnError: Error | undefined;
  let stderr = "";
  child.once("error", (error) => {
    spawnError = error;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const messages = lines[Symbol.asyncIterator]();
  const readMessage = async (): Promise<HelperMessage> => {
    const next = await messages.next();
    if (!next.done) return messageObject(next.value);
    const detail = spawnError?.message ?? (stderr.trim() || "helper exited before replying");
    throw new Error(`Anchored surface transaction failed: ${detail}`);
  };
  const ready = await readMessage();
  if (
    ready["type"] !== "ready" ||
    typeof ready["device"] !== "number" ||
    typeof ready["inode"] !== "number"
  ) {
    throw new Error("Anchored surface transaction did not return a directory identity.");
  }
  let commandId = 0;
  const command = async (type: "replace" | "commit" | "rollback"): Promise<void> => {
    const id = commandId++;
    child.stdin.write(`${JSON.stringify({ type, id })}\n`);
    const result = await readMessage();
    if (result["type"] !== "result" || result["id"] !== id) {
      throw new Error("Anchored surface transaction returned an out-of-order response.");
    }
    if (result["ok"] !== true) {
      throw new Error(
        typeof result["error"] === "string"
          ? result["error"]
          : "Anchored surface transaction failed without an error message.",
      );
    }
  };
  const close = async (): Promise<void> => {
    lines.close();
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.stdin.end();
    await exited;
  };
  return {
    identity: { device: ready["device"], inode: ready["inode"] },
    replace: () => command("replace"),
    commit: () => command("commit"),
    rollback: () => command("rollback"),
    close,
  };
};
