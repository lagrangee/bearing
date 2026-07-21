import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runSync } from "../src/sync";
import { createValidBearingRepo } from "./helpers";

type ChildResult = Readonly<{
  exitCode: number;
  stderr: string;
  timedOut: boolean;
}>;

const runSyncInChild = async (root: string): Promise<ChildResult> => {
  const script = `import { runSync } from "./src/sync.ts"; await runSync(${JSON.stringify(root)});`;
  const processHandle = Bun.spawn([process.execPath, "-e", script], {
    cwd: process.cwd(),
    stdout: "ignore",
    stderr: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    processHandle.kill(9);
  }, 750);
  const [exitCode, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stderr).text(),
  ]);
  clearTimeout(timeout);
  return { exitCode, stderr, timedOut };
};

const outputNames = ["sync-report.md", "project-sitemap.md"] as const;

describe("bearing sync cache output boundary", () => {
  for (const outputName of outputNames) {
    test(`rejects a FIFO at ${outputName} without blocking`, async () => {
      const root = await createValidBearingRepo();
      const cache = join(root, ".bearing/cache");
      const target = join(cache, outputName);
      await mkdir(cache, { recursive: true });
      const created = Bun.spawn(["mkfifo", target]);
      expect(await created.exited).toBe(0);

      const result = await runSyncInChild(root);

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Bearing cache output must be a regular file");
    });

    test(`rejects a directory at ${outputName} with a bounded error`, async () => {
      const root = await createValidBearingRepo();
      const target = join(root, ".bearing/cache", outputName);
      await mkdir(target, { recursive: true });

      await expect(runSync(root)).rejects.toThrow("Bearing cache output must be a regular file");
    });
  }
});
