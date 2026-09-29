import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { PROJECT_READ_MODEL_PROJECTION_VERSION } from "../src/project-read-model/contract";
import {
  PortalProjectReadModelUnavailableError,
  searchPortalProjectRows,
} from "../src/project-read-model/portal";
import {
  captureProjectProviderScopes,
  rebuildProjectReadModel,
} from "../src/project-read-model/provider-operations";
import {
  inspectProjectReadModel,
  projectReadModelPath,
  readProjectProviderEvidence,
} from "../src/project-read-model/store";
import { defaultMattProviderFactory } from "../src/provider-acquisition";
import { readRepositorySourceBytes } from "../tests/fixtures/repository-fixture";
import { createValidBearingRepo } from "../tests/helpers";

test("title-only projection refuses legacy Find, rebuilds without acquisition, and recovers through independent exact capture", async () => {
  const root = await createValidBearingRepo();
  const acquisitions: string[] = [];
  const providerFactory: typeof defaultMattProviderFactory = (input) => {
    const provider = defaultMattProviderFactory(input);
    return {
      ...provider,
      capture: async (binding) => {
        acquisitions.push(binding.nativeScope);
        return provider.capture(binding);
      },
    };
  };
  try {
    const sourceBytes = await readRepositorySourceBytes(root);
    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      providerFactory,
    });
    assert.equal(captured.outcome, "complete");
    const results = await searchPortalProjectRows(root, "fixture", "Finish");
    assert.equal(results.results.length, 1);
    assert.ok(results.results[0] !== undefined);
    assert.equal("excerpt" in results.results[0], false);
    assert.equal(results.results[0]?.href.includes("#"), false);
    for (const query of [".scratch/work", "roadmap:main", "Can the fixture finish?"]) {
      assert.deepEqual((await searchPortalProjectRows(root, "fixture", query)).results, []);
    }
    const old = new DatabaseSync(projectReadModelPath(root));
    try {
      old
        .prepare("UPDATE read_model_metadata SET projection_version = 12 WHERE singleton = 1")
        .run();
    } finally {
      old.close();
    }
    await assert.rejects(searchPortalProjectRows(root, "fixture", "Finish"), (error) => {
      assert.ok(error instanceof PortalProjectReadModelUnavailableError);
      assert.equal(error.reason, "need-rebuild");
      return true;
    });
    const rejectedCapture = await captureProjectProviderScopes(root, [".scratch/work"], {
      providerFactory,
    });
    assert.equal(rejectedCapture.outcome, "recovery-required");
    assert.equal(rejectedCapture.result.acquisitionCount, 0);
    const rebuilt = await rebuildProjectReadModel(root);
    assert.equal(rebuilt.outcome, "complete");
    assert.equal(rebuilt.result.acquisitionCount, 0);
    assert.ok(rebuilt.result.missingEvidenceScopes.includes(".scratch/work"));
    assert.deepEqual(acquisitions, [".scratch/work"]);
    assert.deepEqual((await searchPortalProjectRows(root, "fixture", "Finish")).results, []);
    const state = await inspectProjectReadModel(root);
    assert.equal(state.state, "ready");
    if (state.state !== "ready") throw new Error("Rebuilt store is unavailable.");
    assert.equal(state.metadata.projectionVersion, PROJECT_READ_MODEL_PROJECTION_VERSION);
    const recovery = await captureProjectProviderScopes(root, [".scratch/work"], {
      providerFactory,
    });
    assert.equal(recovery.outcome, "complete");
    assert.equal(recovery.result.acquisitionCount, 1);
    assert.deepEqual(acquisitions, [".scratch/work", ".scratch/work"]);
    assert.equal((await searchPortalProjectRows(root, "fixture", "Finish")).results.length, 1);
    const recoveredEvidence = await readProjectProviderEvidence(root);
    const compatible = await rebuildProjectReadModel(root);
    assert.equal(compatible.result.acquisitionCount, 0);
    assert.deepEqual(await readProjectProviderEvidence(root), recoveredEvidence);
    assert.deepEqual(await readRepositorySourceBytes(root), sourceBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
