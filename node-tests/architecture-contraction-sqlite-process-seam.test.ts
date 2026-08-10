import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { readCatalogDocument, upsertCatalogEntry } from "../src/catalog/store";
import { resolveRepositoryRoot } from "../src/path-boundary";
import { PROJECT_READ_MODEL_PROJECTION_VERSION } from "../src/project-read-model/contract";
import {
  currentBasisFingerprint,
  inspectProject,
  materializeProjectReadModelCandidate,
  queryCommittedProject,
} from "../src/project-read-model/inspect";
import {
  captureProjectProviderScopes,
  rebuildProjectReadModel,
} from "../src/project-read-model/provider-operations";
import {
  inspectProjectReadModel,
  projectReadModelPath,
  publishProjectReadModel,
} from "../src/project-read-model/store";
import { createRepresentativeProject } from "../tests/fixtures/representative-project";
import { createValidBearingRepo } from "../tests/helpers";
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
  } else if (mode === "read-model") {
    if (repoRoot === undefined) throw new Error("Read Model reader arguments missing.");
    const result = await inspectProject(repoRoot, { kind: "project" });
    process.stdout.write(
      `${JSON.stringify({
        role: "read-model-reader",
        outcome: result.outcome,
        basisFingerprint: result.generation?.basisFingerprint,
        generationPublicationCount: result.generation?.publicationCount ?? 0,
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

test("Project Read Model publishes atomically, preserves last-good, and stays isolated from Catalog", async () => {
  const fixture = await createRepresentativeProject("representative");
  const homeDir = await mkdtemp(join(tmpdir(), "bearing-read-model-catalog-"));
  try {
    await upsertCatalogEntry({
      homeDir,
      repoRoot: fixture.root,
      createEntryId: () => "catalog-entry",
    });
    const catalogBefore = await readFile(join(homeDir, ".bearing/catalog.sqlite"));
    const firstCandidate = await materializeProjectReadModelCandidate(fixture.root);
    assert.equal(
      firstCandidate.basisObservations.some(
        (observation) => observation.key === "provider-detail-selection-selection",
      ),
      false,
    );
    const firstReceipt = await publishProjectReadModel(fixture.root, firstCandidate, {
      now: () => "2026-08-08T00:00:00.000Z",
    });
    assert.equal(firstReceipt.publicationCount, 1);
    const evidenceAfterFirst = new DatabaseSync(projectReadModelPath(fixture.root), {
      readOnly: true,
    });
    assert.equal(
      evidenceAfterFirst.prepare("SELECT count(*) AS count FROM provider_evidence").get()?.[
        "count"
      ],
      9,
    );
    evidenceAfterFirst.close();

    const summaryPath = join(fixture.root, fixture.summaryLocator);
    await writeFile(
      summaryPath,
      (await readFile(summaryPath, "utf8")).replace(
        "variant A",
        "variant B after one changed canonical basis",
      ),
    );
    const secondCandidate = await materializeProjectReadModelCandidate(fixture.root);
    await assert.rejects(
      publishProjectReadModel(fixture.root, secondCandidate, {
        faultAt: "before-commit",
      }),
      /Injected publication failure/u,
    );
    const afterFailure = await inspectProjectReadModel(fixture.root);
    assert.equal(afterFailure.state, "ready");
    if (afterFailure.state !== "ready") throw new Error("Expected last-good generation.");
    assert.equal(afterFailure.metadata.receipt.publicationCount, 1);
    assert.equal(afterFailure.metadata.basisFingerprint, firstCandidate.basisFingerprint);

    const changedInspection = await inspectProject(fixture.root, { kind: "project" });
    assert.equal(changedInspection.generation?.publicationCount, 2);
    assert.equal(changedInspection.generation?.basisFingerprint, secondCandidate.basisFingerprint);
    const evidenceAfterSecond = new DatabaseSync(projectReadModelPath(fixture.root), {
      readOnly: true,
    });
    assert.equal(
      evidenceAfterSecond.prepare("SELECT count(*) AS count FROM provider_evidence").get()?.[
        "count"
      ],
      9,
    );
    evidenceAfterSecond.close();
    const afterSecond = await inspectProjectReadModel(fixture.root);
    assert.equal(afterSecond.state, "ready");
    if (afterSecond.state !== "ready") throw new Error("Expected second generation.");
    assert.equal(
      await currentBasisFingerprint(
        await resolveRepositoryRoot(fixture.root),
        afterSecond.metadata,
      ),
      secondCandidate.basisFingerprint,
    );
    assert.equal(
      Buffer.compare(catalogBefore, await readFile(join(homeDir, ".bearing/catalog.sqlite"))),
      0,
    );

    const entrypoint = new URL(import.meta.url).pathname;
    const readers = await runNodeProcessGroup([
      [entrypoint, "--sqlite-product-worker", "read-model", homeDir, fixture.root],
      [entrypoint, "--sqlite-product-worker", "read-model", homeDir, fixture.root],
    ]);
    assert.ok(readers.every((reader) => reader.value.publicationCount === 0));
    assert.deepEqual(
      readers.map((reader) => reader.value["generationPublicationCount"]),
      [2, 2],
    );
    assert.ok(
      readers.every(
        (reader) => reader.value["outcome"] === "complete" || reader.value["outcome"] === "partial",
      ),
    );
    assert.ok(
      readers.every(
        (reader) => reader.value["basisFingerprint"] === secondCandidate.basisFingerprint,
      ),
    );

    await writeFile(
      summaryPath,
      (await readFile(summaryPath, "utf8")).replace(
        "variant B after one changed canonical basis",
        "variant C for concurrent Ensure Current",
      ),
    );
    const thirdCandidate = await materializeProjectReadModelCandidate(fixture.root);
    const concurrentReaders = await runNodeProcessGroup([
      [entrypoint, "--sqlite-product-worker", "read-model", homeDir, fixture.root],
      [entrypoint, "--sqlite-product-worker", "read-model", homeDir, fixture.root],
    ]);
    assert.deepEqual(
      concurrentReaders.map((reader) => reader.value["generationPublicationCount"]),
      [3, 3],
    );
    assert.ok(
      concurrentReaders.every(
        (reader) => reader.value["basisFingerprint"] === thirdCandidate.basisFingerprint,
      ),
    );

    for (let index = 0; index < 5; index += 1) {
      await queryCommittedProject(fixture.root, {
        kind: "planning-reference",
        reference: "effort:e001",
      });
    }
    const querySamples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      const inspected = await queryCommittedProject(fixture.root, {
        kind: "planning-reference",
        reference: "effort:e001",
      });
      querySamples.push(performance.now() - started);
      assert.ok(inspected.outcome === "complete" || inspected.outcome === "partial");
      assert.equal(inspected.generation?.publicationCount, 3);
    }
    querySamples.sort((left, right) => left - right);
    const queryP95 = querySamples[Math.ceil(querySamples.length * 0.95) - 1] ?? Infinity;
    assert.ok(queryP95 < 100, `Typed query p95 was ${queryP95.toFixed(3)} ms.`);

    const basisSamples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      const unchanged = await inspectProject(fixture.root, {
        kind: "planning-reference",
        reference: "effort:e001",
      });
      basisSamples.push(performance.now() - started);
      assert.ok(unchanged.outcome === "complete" || unchanged.outcome === "partial");
      assert.equal(unchanged.generation?.publicationCount, 3);
    }
    const basisMaximum = Math.max(...basisSamples);
    assert.ok(basisMaximum < 500, `Unchanged basis max was ${basisMaximum.toFixed(3)} ms.`);
    assert.ok((await readFile(projectReadModelPath(fixture.root))).length > 0);

    await rm(summaryPath);
    const afterDeletedInput = await inspectProject(fixture.root, { kind: "project" });
    assert.equal(afterDeletedInput.generation?.publicationCount, 4);
    const afterDeletedResult = afterDeletedInput.result;
    assert.ok(afterDeletedResult !== undefined && "summary" in afterDeletedResult);
    assert.deepEqual(afterDeletedResult.summary, { validity: "absent" });
  } finally {
    await Promise.all([
      rm(fixture.root, { recursive: true, force: true }),
      rm(homeDir, { recursive: true, force: true }),
    ]);
  }
});

test("Project Read Model classifies missing, incompatible, older, newer, corrupt, and unsafe stores", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    assert.deepEqual(await inspectProjectReadModel(fixture.root), { state: "missing" });
    const candidate = await materializeProjectReadModelCandidate(fixture.root);
    await publishProjectReadModel(fixture.root, candidate);
    const path = projectReadModelPath(fixture.root);

    const database = new DatabaseSync(path);
    const summaryPayload = database
      .prepare(
        "SELECT payload_json FROM project_objects WHERE reference = 'project-summary:current'",
      )
      .get()?.["payload_json"];
    if (typeof summaryPayload !== "string") throw new Error("Expected Summary payload.");
    database
      .prepare(
        "UPDATE project_objects SET payload_json = '{}' WHERE reference = 'project-summary:current'",
      )
      .run();
    assert.equal((await inspectProjectReadModel(fixture.root)).state, "recovery-required");
    database
      .prepare(
        "UPDATE project_objects SET payload_json = ? WHERE reference = 'project-summary:current'",
      )
      .run(summaryPayload);
    database
      .prepare("UPDATE provider_evidence SET observation_id = 'tampered' WHERE rowid = 1")
      .run();
    assert.equal((await inspectProjectReadModel(fixture.root)).state, "recovery-required");
    database
      .prepare(
        "UPDATE provider_evidence SET observation_id = NULL WHERE observation_id = 'tampered'",
      )
      .run();
    database.exec("UPDATE read_model_metadata SET projection_version = 0 WHERE singleton = 1");
    database.close();
    assert.equal((await inspectProjectReadModel(fixture.root)).state, "recovery-required");

    const newerProjection = new DatabaseSync(path);
    newerProjection.exec(
      `UPDATE read_model_metadata SET projection_version = ${PROJECT_READ_MODEL_PROJECTION_VERSION + 1} WHERE singleton = 1`,
    );
    newerProjection.exec(
      "UPDATE project_objects SET payload_json = '{\"futureField\":true}' WHERE reference = 'project-summary:current'",
    );
    newerProjection.close();
    assert.deepEqual(await inspectProjectReadModel(fixture.root), {
      state: "need-update",
      storageVersion: 1,
      projectionVersion: PROJECT_READ_MODEL_PROJECTION_VERSION + 1,
    });

    const currentProjection = new DatabaseSync(path);
    currentProjection.exec(
      `UPDATE read_model_metadata SET projection_version = ${PROJECT_READ_MODEL_PROJECTION_VERSION} WHERE singleton = 1`,
    );
    currentProjection
      .prepare(
        "UPDATE project_objects SET payload_json = ? WHERE reference = 'project-summary:current'",
      )
      .run(summaryPayload);
    currentProjection.close();

    const newer = new DatabaseSync(path);
    newer.exec("PRAGMA user_version = 2");
    newer.close();
    assert.deepEqual(await inspectProjectReadModel(fixture.root), {
      state: "need-update",
      storageVersion: 2,
    });

    const older = new DatabaseSync(path);
    older.exec("PRAGMA user_version = 0");
    older.close();
    assert.equal((await inspectProjectReadModel(fixture.root)).state, "recovery-required");

    const bytes = await readFile(path);
    await writeFile(path, "not a sqlite database\n");
    assert.equal((await inspectProjectReadModel(fixture.root)).state, "recovery-required");
    await writeFile(path, bytes);
    assert.equal((await inspectProjectReadModel(fixture.root)).state, "recovery-required");
    await rm(path);
    await mkdir(path);
    assert.equal((await inspectProjectReadModel(fixture.root)).state, "recovery-required");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a v20 projection is incompatible and rebuild does not reacquire Provider evidence", async () => {
  const root = await createValidBearingRepo();
  try {
    assert.equal(PROJECT_READ_MODEL_PROJECTION_VERSION, 9);
    assert.equal((await rebuildProjectReadModel(root)).outcome, "complete");
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    const database = new DatabaseSync(projectReadModelPath(root));
    try {
      assert.ok(
        Number(
          database
            .prepare(
              "SELECT COUNT(*) AS count FROM provider_evidence WHERE observation_json IS NOT NULL",
            )
            .get()?.["count"],
        ) > 0,
      );
      database.exec("UPDATE read_model_metadata SET projection_version = 8 WHERE singleton = 1");
    } finally {
      database.close();
    }

    assert.equal((await inspectProjectReadModel(root)).state, "recovery-required");
    assert.equal((await rebuildProjectReadModel(root)).outcome, "complete");
    const current = await inspectProjectReadModel(root);
    assert.equal(current.state, "ready");
    const rebuilt = new DatabaseSync(projectReadModelPath(root), { readOnly: true });
    try {
      assert.equal(
        Number(
          rebuilt
            .prepare(
              "SELECT COUNT(*) AS count FROM provider_evidence WHERE observation_json IS NOT NULL",
            )
            .get()?.["count"],
        ),
        0,
      );
    } finally {
      rebuilt.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
