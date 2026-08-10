import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(projectRoot, "node-tests");
const sqliteProcessSeamArtifact = "architecture-contraction-sqlite-process-seam.test.js";

const runNodeTestGroup = async (label: string, artifacts: readonly string[]): Promise<void> => {
  if (artifacts.length === 0) return;
  const child = Bun.spawn(["node", "--test", ...artifacts], {
    cwd: projectRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.`);
  }
};

const selectEntrypoints = async (): Promise<string[]> => {
  const requested = process.argv.slice(2);
  if (requested.length === 0) {
    return (await readdir(sourceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
      .map((entry) => join(sourceRoot, entry.name))
      .sort();
  }
  const available = new Set(
    (await readdir(sourceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
      .map((entry) => join(sourceRoot, entry.name)),
  );
  const selected = requested.map((entrypoint) => resolve(projectRoot, entrypoint));
  for (const entrypoint of selected) {
    if (!available.has(entrypoint)) {
      throw new Error(`Node Catalog test entrypoint is not available: ${entrypoint}`);
    }
  }
  return [...new Set(selected)].sort();
};

const run = async (): Promise<void> => {
  const entrypoints = await selectEntrypoints();
  if (entrypoints.length === 0) throw new Error("Node Catalog test lane has no entrypoints.");

  const temporaryRoot = await mkdtemp(join(tmpdir(), "bearing-node-catalog-tests-"));
  const outputRoot = join(temporaryRoot, "built");
  await mkdir(outputRoot);
  try {
    const build = await Bun.build({
      entrypoints,
      outdir: outputRoot,
      target: "node",
      format: "esm",
      minify: false,
      sourcemap: "none",
      external: ["node:*"],
    });
    if (!build.success) throw new AggregateError(build.logs, "Node Catalog test build failed.");

    const artifacts = build.outputs
      .map((output) => output.path)
      .filter((path) => path.endsWith(".js"))
      .sort();
    if (artifacts.length !== entrypoints.length) {
      throw new Error(
        `Node Catalog test build produced ${artifacts.length} artifacts for ${entrypoints.length} entrypoints.`,
      );
    }

    const sqliteProcessSeam = artifacts.filter(
      (artifact) => basename(artifact) === sqliteProcessSeamArtifact,
    );
    const portableCorrectness = artifacts.filter(
      (artifact) => basename(artifact) !== sqliteProcessSeamArtifact,
    );
    await runNodeTestGroup("SQLite process/performance seam", sqliteProcessSeam);
    await runNodeTestGroup("Portable Node correctness lane", portableCorrectness);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

await run();
