import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readCatalogDocument, upsertCatalogEntry } from "../src/catalog/store";
import { processEvidence, runNodeProcessGroup } from "./product-seams/sqlite-process-harness";

const makeRepository = async (root: string): Promise<void> => {
  await mkdir(join(root, ".bearing"), { recursive: true });
  await writeFile(
    join(root, ".bearing/manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: "0.1.0",
      status: "active",
      surfaces: ["agent-skills"],
      executorProfiles: [],
    })}\n`,
  );
};

if (process.argv[2] === "--sqlite-product-worker") {
  const [, , , mode, homeDir, repoRoot, entryId] = process.argv;
  if (mode === undefined || homeDir === undefined) throw new Error("Worker arguments are missing.");
  if (mode === "write") {
    if (repoRoot === undefined || entryId === undefined)
      throw new Error("Writer arguments missing.");
    const result = await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => entryId });
    process.stdout.write(
      `${JSON.stringify({
        role: "writer",
        outcome: result.outcome,
        ...processEvidence(result.outcome === "applied" ? 1 : 0),
      })}\n`,
    );
  } else if (mode === "read") {
    const document = await readCatalogDocument({ homeDir });
    process.stdout.write(
      `${JSON.stringify({
        role: "reader",
        entryIds: document.entries.map((entry) => entry.entryId).sort(),
        ...processEvidence(0),
      })}\n`,
    );
  } else {
    throw new Error(`Unknown worker mode: ${mode}`);
  }
  process.exit(0);
}

test("real SQLite process seam records committed publications and peak RSS", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-sqlite-product-seam-"));
  const homeDir = join(root, "home");
  const firstRoot = join(root, "first");
  const secondRoot = join(root, "second");
  await Promise.all([makeRepository(firstRoot), makeRepository(secondRoot)]);
  try {
    const entrypoint = new URL(import.meta.url).pathname;
    const writers = await runNodeProcessGroup([
      [entrypoint, "--sqlite-product-worker", "write", homeDir, firstRoot, "entry-a"],
      [entrypoint, "--sqlite-product-worker", "write", homeDir, secondRoot, "entry-b"],
    ]);
    assert.deepEqual(
      writers.map((worker) => worker.value.publicationCount),
      [1, 1],
    );
    assert.ok(writers.every((worker) => worker.value.peakRssBytes > 0));

    const [reader] = await runNodeProcessGroup([
      [entrypoint, "--sqlite-product-worker", "read", homeDir],
    ]);
    assert.deepEqual(reader?.value["entryIds"], ["entry-a", "entry-b"]);
    assert.equal(reader?.value.publicationCount, 0);
    assert.ok((reader?.value.peakRssBytes ?? 0) > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
