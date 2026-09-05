import assert from "node:assert/strict";
import fileSystem, { appendFile, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { providerObservationIdentityFor } from "../src/native-work-provider";
import {
  inspectProject,
  prepareProjectReadModelCandidate,
} from "../src/project-read-model/inspect";
import { captureProjectProviderScopes } from "../src/project-read-model/provider-operations";
import {
  type ProjectProviderEvidence,
  projectProviderEvidenceBindingKey,
  publishProjectReadModel,
  readProjectProviderEvidence,
  readProjectReadModelOperationBasis,
  replaceProjectProviderEvidence,
} from "../src/project-read-model/store";
import { createValidBearingRepo } from "../tests/helpers";

const operationBasis = async (root: string) => {
  const state = await readProjectReadModelOperationBasis(root);
  assert.equal(state.state, "available");
  if (state.state !== "available") throw new Error("Expected an available operation basis.");
  return state.basis;
};

const attemptedEvidence = (
  prior: ProjectProviderEvidence,
  attemptedAt = "2026-09-05T07:00:00.000Z",
): ProjectProviderEvidence => ({
  ...prior,
  selection: {
    ...prior.selection,
    latestAttempt: {
      intent: "exact-scope-capture",
      attemptedAt,
      outcome: prior.observation === undefined ? "failed" : "succeeded",
      diagnostics: [],
    },
  },
});

test("a latest-attempt-only winner invalidates a pending publication despite the same fingerprint", async () => {
  const root = await createValidBearingRepo();
  try {
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    const startingBasis = await operationBasis(root);
    const prior = startingBasis.evidence[0];
    assert.ok(prior?.observation);
    const prepared = await prepareProjectReadModelCandidate(root, { startingBasis });
    assert.equal(prepared.candidate.basisFingerprint, startingBasis.metadata?.basisFingerprint);
    const winner = attemptedEvidence(prior, "2026-09-05T08:00:00.000Z");
    await replaceProjectProviderEvidence(root, winner);
    assert.deepEqual((await operationBasis(root)).metadata, startingBasis.metadata);

    const publication = await publishProjectReadModel(root, prepared.candidate, {
      operation: { startingBasis, attempts: [attemptedEvidence(prior)], publishGeneration: false },
    });

    assert.equal(publication.state, "conflict");
    if (publication.state !== "conflict") throw new Error("Expected a publication conflict.");
    assert.equal(publication.diagnostic.code, "project-read-model-publication-conflict");
    assert.deepEqual(await readProjectProviderEvidence(root), [winner]);
    assert.deepEqual((await operationBasis(root)).metadata, startingBasis.metadata);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a selection-only winner is retained when the pending candidate has the same fingerprint", async () => {
  const root = await createValidBearingRepo();
  try {
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    const startingBasis = await operationBasis(root);
    const prior = startingBasis.evidence[0];
    assert.ok(prior?.observation);
    const prepared = await prepareProjectReadModelCandidate(root, { startingBasis });
    assert.equal(prepared.candidate.basisFingerprint, startingBasis.metadata?.basisFingerprint);
    const winner: ProjectProviderEvidence = {
      ...prior,
      selection: { ...prior.selection, effectiveFreshness: "stale" },
    };
    await replaceProjectProviderEvidence(root, winner);
    assert.deepEqual((await operationBasis(root)).metadata, startingBasis.metadata);

    const publication = await publishProjectReadModel(root, prepared.candidate, {
      operation: { startingBasis, attempts: [attemptedEvidence(prior)], publishGeneration: false },
    });

    assert.equal(publication.state, "conflict");
    assert.deepEqual(await readProjectProviderEvidence(root), [winner]);
    assert.deepEqual((await operationBasis(root)).metadata, startingBasis.metadata);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a same-semantic observation content winner cannot be overwritten by a pending publication", async () => {
  const root = await createValidBearingRepo();
  try {
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    const startingBasis = await operationBasis(root);
    const prior = startingBasis.evidence[0];
    assert.ok(prior?.observation?.state === "available");
    const map = prior.observation.projection.map;
    assert.ok(map?.native.kind === "local");
    const prepared = await prepareProjectReadModelCandidate(root, { startingBasis });
    assert.equal(prepared.candidate.basisFingerprint, startingBasis.metadata?.basisFingerprint);
    const { id: _id, ...content } = prior.observation;
    const changedContent = {
      ...content,
      projection: {
        ...content.projection,
        map: {
          ...map,
          native: {
            ...map.native,
            lastUpdated: {
              availability: "available" as const,
              basis: "inferred-source-metadata" as const,
              precision: "fractional-second" as const,
              value: "2026-09-05T08:00:00.000Z",
            },
          },
        },
      },
    };
    const observation = { ...changedContent, id: providerObservationIdentityFor(changedContent) };
    const winner: ProjectProviderEvidence = {
      ...prior,
      observation,
      selection: { ...prior.selection, observationId: observation.id },
    };
    await replaceProjectProviderEvidence(root, winner);
    assert.notEqual(winner.observation?.id, prior.observation.id);
    assert.deepEqual((await operationBasis(root)).metadata, startingBasis.metadata);

    const publication = await publishProjectReadModel(root, prepared.candidate, {
      operation: { startingBasis, attempts: [attemptedEvidence(prior)], publishGeneration: false },
    });

    assert.equal(publication.state, "conflict");
    assert.deepEqual(await readProjectProviderEvidence(root), [winner]);
    assert.deepEqual((await operationBasis(root)).metadata, startingBasis.metadata);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent detail replacement survives canonical publication without causing a conflict", async () => {
  const root = await createValidBearingRepo();
  try {
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    const bound = (await readProjectProviderEvidence(root, "bound"))[0];
    assert.ok(bound?.observation);
    await replaceProjectProviderEvidence(root, { ...bound, role: "detail" });
    const startingBasis = await operationBasis(root);
    assert.ok(startingBasis.metadata);
    await appendFile(`${root}/.bearing/state/project-summary.md`, "\nA changed project summary.\n");
    const prepared = await prepareProjectReadModelCandidate(root, {
      startingBasis,
      providerDetailEvidenceState: null,
    });
    const detail: ProjectProviderEvidence = {
      ...bound,
      role: "detail",
      selection: {
        ...bound.selection,
        latestAttempt: {
          intent: "provider-detail-selection",
          attemptedAt: "2026-09-05T08:00:00.000Z",
          outcome: "succeeded",
          diagnostics: [],
        },
      },
    };
    await replaceProjectProviderEvidence(root, detail);

    const publication = await publishProjectReadModel(root, prepared.candidate, {
      operation: { startingBasis, attempts: [], publishGeneration: true },
    });

    assert.equal(publication.state, "published");
    if (publication.state !== "published") throw new Error("Expected one canonical publication.");
    assert.equal(
      publication.receipt.publicationCount,
      startingBasis.metadata.receipt.publicationCount + 1,
    );
    assert.deepEqual(await readProjectProviderEvidence(root, "detail"), [detail]);
    assert.deepEqual(await readProjectProviderEvidence(root, "bound"), [bound]);
    assert.equal((await readProjectProviderEvidence(root)).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two equivalent Ensure Current operations publish once and return the same receipt", async (context) => {
  const root = await realpath(await createValidBearingRepo());
  const arrived = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const originalOpen = fileSystem.open;
  let readers = 0;
  const opened = context.mock.method(
    fileSystem,
    "open",
    async (...args: Parameters<typeof originalOpen>) => {
      if (String(args[0]) === `${root}/.bearing/state/project-summary.md` && ++readers <= 2) {
        if (readers === 2) arrived.resolve();
        await resume.promise;
      }
      return originalOpen(...args);
    },
  );
  syncBuiltinESMExports();
  let first: ReturnType<typeof inspectProject> | undefined;
  let second: ReturnType<typeof inspectProject> | undefined;
  try {
    const dependencies = {
      providerFactory: () => {
        throw new Error("Ensure Current must not acquire a Provider.");
      },
    };
    first = inspectProject(root, { kind: "project" }, dependencies);
    second = inspectProject(root, { kind: "project" }, dependencies);
    const pending = Promise.all([first, second]);
    await Promise.race([
      arrived.promise,
      pending.then(() => {
        throw new Error("Ensure Current did not reach both canonical capture barriers.");
      }),
    ]);
    resume.resolve();
    const results = await pending;

    assert.ok(
      results.every((result) => result.outcome === "complete" || result.outcome === "partial"),
    );
    assert.ok(results[0]?.generation);
    assert.deepEqual(results[1]?.generation, results[0].generation);
    assert.equal(results[0].generation.publicationCount, 1);
    assert.deepEqual((await operationBasis(root)).metadata?.receipt, results[0].generation);
  } finally {
    resume.resolve();
    await Promise.allSettled([first, second]);
    opened.mock.restore();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});

test("an unchanged existing null-observation row records the conflict attempt without a generation", async () => {
  const root = await createValidBearingRepo();
  try {
    await inspectProject(root, { kind: "project" });
    const startingBasis = await operationBasis(root);
    const prior = startingBasis.evidence[0];
    assert.ok(prior);
    assert.equal(prior.observation, undefined);
    assert.equal(prior.selection.observationId, null);
    const prepared = await prepareProjectReadModelCandidate(root, { startingBasis });
    await appendFile(
      `${root}/.bearing/state/project-summary.md`,
      "\nThe concurrent summary won.\n",
    );
    await inspectProject(root, { kind: "project" });
    const winnerBasis = await operationBasis(root);
    assert.deepEqual(winnerBasis.evidence, [prior]);

    const publication = await publishProjectReadModel(root, prepared.candidate, {
      operation: { startingBasis, attempts: [attemptedEvidence(prior)], publishGeneration: false },
    });

    assert.equal(publication.state, "conflict");
    const retained = await readProjectProviderEvidence(root);
    assert.equal(retained.length, 1);
    assert.equal(retained[0]?.observation, undefined);
    assert.equal(retained[0]?.selection.observationId, null);
    assert.equal(retained[0]?.selection.effectiveFreshness, prior.selection.effectiveFreshness);
    assert.equal(retained[0]?.selection.latestAttempt?.attemptedAt, "2026-09-05T07:00:00.000Z");
    assert.equal(retained[0]?.selection.latestAttempt?.outcome, "failed");
    assert.equal(
      retained[0]?.selection.latestAttempt?.diagnostics[0]?.code,
      "project-read-model-publication-conflict",
    );
    assert.deepEqual((await operationBasis(root)).metadata, winnerBasis.metadata);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale publication cannot restore a bound row deleted by the winning canonical operation", async () => {
  const root = await createValidBearingRepo();
  try {
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    const startingBasis = await operationBasis(root);
    const prior = startingBasis.evidence[0];
    assert.ok(prior?.observation);
    const prepared = await prepareProjectReadModelCandidate(root, { startingBasis });
    await rm(`${root}/.bearing/state/efforts/test.md`);
    await inspectProject(root, { kind: "project" });
    const winnerBasis = await operationBasis(root);
    assert.deepEqual(winnerBasis.evidence, []);

    const publication = await publishProjectReadModel(root, prepared.candidate, {
      operation: { startingBasis, attempts: [attemptedEvidence(prior)], publishGeneration: true },
    });

    assert.equal(publication.state, "conflict");
    assert.deepEqual(await readProjectProviderEvidence(root), []);
    assert.deepEqual((await operationBasis(root)).metadata, winnerBasis.metadata);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a conflicting acquisition cannot create a bound row absent from both starting and winning state", async () => {
  const root = await createValidBearingRepo();
  try {
    const effortPath = `${root}/.bearing/state/efforts/test.md`;
    const effort = await readFile(effortPath, "utf8");
    await rm(effortPath);
    await inspectProject(root, { kind: "project" });
    const startingBasis = await operationBasis(root);
    assert.deepEqual(startingBasis.evidence, []);
    await writeFile(effortPath, effort);
    const prepared = await prepareProjectReadModelCandidate(root, {
      startingBasis,
      providerObservationIntent: "exact-scope-capture",
      requestedProviderBindings: [{ provider: "matt-skills/v1", nativeScope: ".scratch/work" }],
      providerObservationNow: () => "2026-09-05T07:00:00.000Z",
    });
    const observation = prepared.plan.providerObservations[0];
    const selection = prepared.plan.providerObservationSelections[0];
    assert.ok(observation);
    assert.equal(selection?.latestAttempt?.outcome, "succeeded");
    assert.ok(selection);
    const acquired: ProjectProviderEvidence = {
      bindingKey: projectProviderEvidenceBindingKey(selection),
      role: "bound",
      observation,
      selection,
    };
    await rm(effortPath);
    await appendFile(
      `${root}/.bearing/state/project-summary.md`,
      "\nA newer summary without that Binding.\n",
    );
    await inspectProject(root, { kind: "project" });
    const winnerBasis = await operationBasis(root);
    assert.deepEqual(winnerBasis.evidence, []);

    const publication = await publishProjectReadModel(root, prepared.candidate, {
      operation: { startingBasis, attempts: [acquired], publishGeneration: true },
    });

    assert.equal(publication.state, "conflict");
    assert.deepEqual(await readProjectProviderEvidence(root), []);
    assert.deepEqual((await operationBasis(root)).metadata, winnerBasis.metadata);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
