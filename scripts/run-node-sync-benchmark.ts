#!/usr/bin/env bun

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryRoot = await mkdtemp(join(tmpdir(), "bearing-node-sync-benchmark-"));
const outputRoot = join(temporaryRoot, "built");
await mkdir(outputRoot);
try {
  const build = await Bun.build({
    entrypoints: [join(process.cwd(), "scripts/benchmark-sync.ts")],
    outdir: outputRoot,
    target: "node",
    format: "esm",
    minify: false,
    sourcemap: "none",
    external: ["node:*"],
  });
  if (!build.success) throw new AggregateError(build.logs, "Node Sync benchmark build failed.");
  const artifact = build.outputs.find((output) => output.path.endsWith("benchmark-sync.js"));
  if (artifact === undefined) throw new Error("Node Sync benchmark artifact is unavailable.");
  const child = Bun.spawn(["node", artifact.path, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
