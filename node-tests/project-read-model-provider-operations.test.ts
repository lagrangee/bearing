import assert from "node:assert/strict";
import { readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { providerObservationIdentityFor } from "../src/native-work-provider";
import { renderProviderMarkdownSections } from "../src/portal/markdown-engine";
import { portalRowsToProjectData } from "../src/portal-ui/project-row-adapter";
import { PROJECT_READ_MODEL_PROJECTION_VERSION } from "../src/project-read-model/contract";
import {
  inspectProject,
  materializeProjectReadModelCandidate,
} from "../src/project-read-model/inspect";
import { queryPortalProjectRows } from "../src/project-read-model/portal";
import {
  captureProjectProviderScopes,
  rebuildProjectReadModel,
  reconcileProjectNative,
  refreshProjectProviderDetail,
  verifyAllProjectProviderScopes,
} from "../src/project-read-model/provider-operations";
import {
  inspectProjectReadModel,
  projectProviderEvidenceBindingKey,
  projectReadModelPath,
  publishProjectReadModel,
  readProjectProviderEvidence,
  replaceProjectProviderEvidence,
} from "../src/project-read-model/store";
import { defaultMattProviderFactory } from "../src/provider-acquisition";
import { ProviderObservationAcquisitionUnavailableError } from "../src/provider-evidence-selection";
import {
  decodeGitHubMattNativeScope,
  encodeGitHubMattNativeScope,
} from "../src/providers/matt-skills-v1/github-native-scope";
import { createLocalMarkdownMattProvider } from "../src/providers/matt-skills-v1/local-markdown";
import { mattProviderSemanticSections } from "../src/providers/matt-skills-v1/projection";
import { withRuntimeExecutionContext } from "../src/runtime-context";
import {
  createGitHubMattRepository,
  createReferenceGitHubFixtures,
  FixtureGitHubTransport,
  githubMattProviderFactoryFor,
  writeStandardGitHubMattProductRepository,
} from "../tests/fixtures/github-matt-api";
import { createRepresentativeProject } from "../tests/fixtures/representative-project";
import { createValidBearingRepo } from "../tests/helpers";

const developmentRuntimeContext = (
  repositoryRoot: string,
  runtimeDigest: string,
  legacyNamespace?: string,
  buildDigest = runtimeDigest,
) => ({
  repositoryRoot,
  homeDir: join(repositoryRoot, ".bearing", "local", "runtime-home"),
  projectReadModelPath:
    legacyNamespace === undefined
      ? join(repositoryRoot, ".bearing", "cache", "development", "project-read-model.sqlite")
      : join(
          repositoryRoot,
          ".bearing",
          "cache",
          "development",
          legacyNamespace,
          "project-read-model.sqlite",
        ),
  receipt: {
    schemaVersion: 1 as const,
    channel: "development" as const,
    runtimeIdentity: `sha256:${runtimeDigest}`,
    stateRootIdentity: `sha256:${"f".repeat(64)}`,
    buildIdentity: `sha256:${buildDigest}`,
  },
});

test("all-scope verification completes truthfully when the active project has no Work Bindings", async () => {
  const root = await createValidBearingRepo();
  try {
    const effortPath = `${root}/.bearing/state/efforts/test.md`;
    const effort = await readFile(effortPath, "utf8");
    await writeFile(
      effortPath,
      effort.replace(
        "Work binding:\n  Provider: matt-skills/v1\n  Native scope: .scratch/work\n",
        "",
      ),
    );
    assert.equal((await rebuildProjectReadModel(root)).outcome, "complete");
    assert.deepEqual(await verifyAllProjectProviderScopes(root), {
      schemaVersion: 1,
      command: "provider-verify",
      outcome: "complete",
      result: { acquisitionCount: 0, scopes: [], missingEvidenceScopes: [] },
      diagnostics: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("item refresh publishes detail evidence without changing bound evidence or generation", async () => {
  const root = await createValidBearingRepo();
  try {
    assert.equal((await rebuildProjectReadModel(root)).outcome, "complete");
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    const beforeState = await inspectProjectReadModel(root);
    assert.equal(beforeState.state, "ready");
    if (beforeState.state !== "ready") throw new Error("Expected a ready Project Read Model.");
    const beforeBound = await readProjectProviderEvidence(root, "bound");

    const refreshed = await refreshProjectProviderDetail(root, {
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
      subject: ".scratch/work/issues/01-finish.md",
    });

    assert.equal(refreshed.outcome, "complete");
    assert.equal(refreshed.result.acquisitionCount, 1);
    assert.deepEqual(refreshed.result.scopes, [
      { scope: ".scratch/work", disposition: "captured" },
    ]);
    assert.deepEqual(await readProjectProviderEvidence(root, "bound"), beforeBound);
    const detail = await readProjectProviderEvidence(root, "detail");
    assert.equal(detail.length, 1);
    assert.equal(detail[0]?.role, "detail");
    assert.equal(detail[0]?.selection.nativeScope, ".scratch/work");
    assert.equal(detail[0]?.selection.latestAttempt?.intent, "provider-detail-selection");
    assert.equal(detail[0]?.selection.latestAttempt?.outcome, "succeeded");
    const afterState = await inspectProjectReadModel(root);
    assert.equal(afterState.state, "ready");
    if (afterState.state !== "ready") throw new Error("Expected a ready Project Read Model.");
    assert.equal(afterState.metadata.basisFingerprint, beforeState.metadata.basisFingerprint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("metadata-only Local time refresh replaces display evidence without publishing a generation", async () => {
  const root = await createValidBearingRepo();
  const now = () => "2026-08-09T00:00:00.000Z";
  const providerFactory = (input: Parameters<typeof defaultMattProviderFactory>[0]) =>
    createLocalMarkdownMattProvider({
      repoRoot: input.repoRoot,
      contractLocator: input.configuration.contractLocator,
      capturedDocuments: input.capturedDocuments,
      clock: () => new Date(now()),
    });
  try {
    assert.equal((await rebuildProjectReadModel(root)).outcome, "complete");
    assert.equal(
      (await captureProjectProviderScopes(root, [".scratch/work"], { now, providerFactory }))
        .outcome,
      "complete",
    );
    const before = await inspectProjectReadModel(root);
    assert.equal(before.state, "ready");

    const metadataTime = new Date("2026-08-09T01:02:03.000Z");
    await utimes(`${root}/.scratch/work/issues/01-finish.md`, metadataTime, metadataTime);
    assert.equal(
      (await captureProjectProviderScopes(root, [".scratch/work"], { now, providerFactory }))
        .outcome,
      "complete",
    );

    const after = await inspectProjectReadModel(root);
    assert.equal(after.state, "ready");
    if (before.state !== "ready" || after.state !== "ready") {
      throw new Error("Expected a ready generation around metadata-only capture.");
    }
    assert.deepEqual(after.metadata.receipt, before.metadata.receipt);
    const evidence = (await readProjectProviderEvidence(root, "bound"))[0]?.observation;
    if (
      evidence === undefined ||
      (evidence.state !== "available" && evidence.state !== "partial")
    ) {
      throw new Error("Expected refreshed Local evidence.");
    }
    assert.deepEqual(evidence.projection.wayfinderTickets[0]?.native.lastUpdated, {
      availability: "available",
      value: metadataTime.toISOString(),
      precision: "fractional-second",
      basis: "inferred-source-metadata",
    });
    const portalRows = await queryPortalProjectRows(root, "lineage", {
      kind: "native-subject",
      id: ".scratch/work/issues/01-finish.md",
    });
    const portal = portalRowsToProjectData({
      ...portalRows,
      renderedMarkdown: renderProviderMarkdownSections(
        portalRows.objects
          .flatMap((object) =>
            object.kind === "portal-native-evidence" && object.value.observation !== undefined
              ? [object.value.observation]
              : [],
          )
          .flatMap(mattProviderSemanticSections),
      ),
    });
    if (portal.section !== "lineage") throw new Error("Expected lineage Portal data.");
    const portalObservation = portal.providerObservations[0];
    if (
      portalObservation === undefined ||
      (portalObservation.state !== "available" && portalObservation.state !== "partial")
    ) {
      throw new Error("Expected refreshed Portal evidence.");
    }
    assert.equal(
      portalObservation.projection.wayfinderTickets[0]?.native.lastUpdated.availability ===
        "available"
        ? portalObservation.projection.wayfinderTickets[0].native.lastUpdated.value
        : undefined,
      metadataTime.toISOString(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("physical rebuild is local-only and exact capture replaces current bound evidence", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    const rebuilt = await rebuildProjectReadModel(fixture.root);
    assert.equal(rebuilt.outcome, "complete");
    assert.equal(rebuilt.result.acquisitionCount, 0);
    assert.equal(rebuilt.result.missingEvidenceScopes.length, 9);
    assert.ok(rebuilt.result.missingEvidenceScopes.includes(".scratch/scope-001"));

    const incomplete = await captureProjectProviderScopes(fixture.root, [".scratch/scope-002"], {
      providerFactory: (input) => {
        const provider = defaultMattProviderFactory(input);
        return {
          ...provider,
          capture: async (binding) => {
            const observation = await provider.capture(binding);
            const { id: _id, ...content } = observation;
            const degraded = {
              ...content,
              coverage: { ...content.coverage, assessment: "incomplete" as const },
              completion: "incomplete" as const,
            };
            return { id: providerObservationIdentityFor(degraded), ...degraded };
          },
        };
      },
    });
    assert.equal(incomplete.outcome, "unfulfilled");
    assert.equal(incomplete.result.acquisitionCount, 1);
    assert.deepEqual(incomplete.result.scopes, [
      { scope: ".scratch/scope-002", disposition: "unavailable" },
    ]);
    const incompleteEvidence = (await readProjectProviderEvidence(fixture.root, "bound")).find(
      (entry) => entry.selection.nativeScope === ".scratch/scope-002",
    );
    assert.equal(incompleteEvidence?.observation, undefined);
    assert.equal(incompleteEvidence?.selection.observationId, null);
    assert.equal(incompleteEvidence?.selection.latestAttempt?.outcome, "failed");

    const captured = await captureProjectProviderScopes(fixture.root, [".scratch/scope-001"]);
    assert.equal(captured.outcome, "complete");
    assert.equal(captured.result.acquisitionCount, 1);
    assert.deepEqual(captured.result.scopes, [
      { scope: ".scratch/scope-001", disposition: "captured" },
    ]);
    assert.equal(captured.result.missingEvidenceScopes.length, 8);
    assert.ok(!captured.result.missingEvidenceScopes.includes(".scratch/scope-001"));

    const capturedEvidence = (await readProjectProviderEvidence(fixture.root, "bound")).find(
      (entry) => entry.selection.nativeScope === ".scratch/scope-001",
    );
    assert.ok(capturedEvidence?.observation !== undefined);
    const selectedObservation = capturedEvidence.observation;
    await replaceProjectProviderEvidence(fixture.root, {
      ...capturedEvidence,
      selection: {
        ...capturedEvidence.selection,
        latestAttempt: {
          intent: "all-scope-verification",
          attemptedAt: "2026-08-08T02:00:00.000Z",
          outcome: "succeeded",
          diagnostics: [],
        },
      },
    });
    const beforeSameObservation = await inspectProjectReadModel(fixture.root);
    assert.equal(beforeSameObservation.state, "ready");
    const sameObservation = await captureProjectProviderScopes(
      fixture.root,
      [".scratch/scope-001"],
      {
        providerFactory: () => ({
          id: "matt-skills/v1",
          capture: async () => selectedObservation,
        }),
      },
    );
    assert.equal(sameObservation.outcome, "complete");
    const afterSameObservation = await inspectProjectReadModel(fixture.root);
    assert.equal(afterSameObservation.state, "ready");
    if (beforeSameObservation.state !== "ready" || afterSameObservation.state !== "ready") {
      throw new Error("Expected ready generation around identical capture.");
    }
    assert.deepEqual(afterSameObservation.metadata.receipt, beforeSameObservation.metadata.receipt);
    assert.equal(
      (await readProjectProviderEvidence(fixture.root, "bound")).find(
        (entry) => entry.selection.nativeScope === ".scratch/scope-001",
      )?.selection.latestAttempt?.intent,
      "exact-scope-capture",
    );

    const beforeFailedCapture = await inspectProjectReadModel(fixture.root);
    assert.equal(beforeFailedCapture.state, "ready");
    const failedCapture = await captureProjectProviderScopes(fixture.root, [".scratch/scope-001"], {
      providerFactory: (input) => {
        const provider = defaultMattProviderFactory(input);
        return {
          ...provider,
          capture: async () => {
            throw new ProviderObservationAcquisitionUnavailableError("expected capture failure");
          },
        };
      },
    });
    assert.equal(failedCapture.outcome, "unfulfilled");
    assert.deepEqual(failedCapture.result.scopes, [
      { scope: ".scratch/scope-001", disposition: "retained-after-failure" },
    ]);
    const afterFailedCapture = await inspectProjectReadModel(fixture.root);
    assert.equal(afterFailedCapture.state, "ready");
    if (beforeFailedCapture.state !== "ready" || afterFailedCapture.state !== "ready") {
      throw new Error("Expected current generation around failed capture.");
    }
    assert.deepEqual(afterFailedCapture.metadata.receipt, beforeFailedCapture.metadata.receipt);
    assert.equal(
      (await readProjectProviderEvidence(fixture.root, "bound")).find(
        (entry) => entry.selection.nativeScope === ".scratch/scope-001",
      )?.selection.effectiveFreshness,
      "current",
    );
    const recaptured = await captureProjectProviderScopes(fixture.root, [".scratch/scope-001"]);
    assert.equal(recaptured.outcome, "complete");
    const database = new DatabaseSync(projectReadModelPath(fixture.root), { readOnly: true });
    assert.equal(
      database
        .prepare(
          "SELECT count(*) AS count FROM provider_evidence WHERE role = 'bound' AND binding_key = ?",
        )
        .get(
          projectProviderEvidenceBindingKey({
            provider: "matt-skills/v1",
            nativeScope: ".scratch/scope-001",
          }),
        )?.["count"],
      1,
    );
    database.close();

    const native = await inspectProject(fixture.root, {
      kind: "native-reference",
      reference: fixture.nativeLocator,
    });
    assert.equal(native.outcome, "complete");
    assert.deepEqual(native.request, {
      kind: "native-reference",
      reference: fixture.nativeLocator,
    });
    assert.ok(native.result !== undefined && "binding" in native.result);
    assert.equal(native.result.binding.state, "bound");
    if (native.result.binding.state !== "bound") throw new Error("Expected bound native result.");
    assert.deepEqual(native.result.binding, {
      state: "bound",
      provider: "matt-skills/v1",
      nativeScope: ".scratch/scope-001",
      role: "bound",
      observationId: native.result.binding.observationId,
      effectiveFreshness: "current",
      planningReferences: ["effort:e001"],
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("compatible Development build replacement keeps provider evidence current without acquisition", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    const repositoryRoot = await realpath(fixture.root);
    const digest = "a".repeat(64);
    const legacyContext = developmentRuntimeContext(repositoryRoot, digest, digest);
    await withRuntimeExecutionContext(legacyContext, async () => {
      await rebuildProjectReadModel(repositoryRoot);
      const captured = await captureProjectProviderScopes(repositoryRoot, [".scratch/scope-001"]);
      assert.equal(captured.outcome, "complete");
    });

    const currentContext = developmentRuntimeContext(repositoryRoot, "c".repeat(64));
    await withRuntimeExecutionContext(currentContext, async () => {
      const rebuilt = await rebuildProjectReadModel(repositoryRoot);
      assert.equal(rebuilt.outcome, "complete");
      assert.equal(rebuilt.result.acquisitionCount, 0);
      assert.ok(!rebuilt.result.missingEvidenceScopes.includes(".scratch/scope-001"));
      const retained = (await readProjectProviderEvidence(repositoryRoot, "bound")).find(
        (entry) => entry.selection.nativeScope === ".scratch/scope-001",
      );
      assert.equal(retained?.selection.effectiveFreshness, "current");
      assert.ok(retained?.observation !== undefined);
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Development namespace cutover rejects conflicting legacy evidence without acquisition", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    const repositoryRoot = await realpath(fixture.root);
    const firstDigest = "a".repeat(64);
    await withRuntimeExecutionContext(
      developmentRuntimeContext(repositoryRoot, firstDigest, firstDigest),
      async () => {
        await rebuildProjectReadModel(repositoryRoot);
        await captureProjectProviderScopes(repositoryRoot, [".scratch/scope-001"]);
      },
    );

    const nativePath = join(repositoryRoot, fixture.nativeLocator);
    const originalNative = await readFile(nativePath, "utf8");
    await writeFile(nativePath, originalNative.replace("Status: resolved", "Status: claimed"));
    const secondDigest = "b".repeat(64);
    await withRuntimeExecutionContext(
      developmentRuntimeContext(repositoryRoot, secondDigest, secondDigest),
      async () => {
        await rebuildProjectReadModel(repositoryRoot);
        await captureProjectProviderScopes(repositoryRoot, [".scratch/scope-001"]);
      },
    );
    await writeFile(nativePath, originalNative);

    await withRuntimeExecutionContext(
      developmentRuntimeContext(repositoryRoot, "c".repeat(64)),
      async () => {
        const rebuilt = await rebuildProjectReadModel(repositoryRoot);
        assert.equal(rebuilt.outcome, "complete");
        assert.equal(rebuilt.result.acquisitionCount, 0);
        assert.ok(rebuilt.result.missingEvidenceScopes.includes(".scratch/scope-001"));
        const rejected = (await readProjectProviderEvidence(repositoryRoot, "bound")).find(
          (entry) => entry.selection.nativeScope === ".scratch/scope-001",
        );
        assert.equal(rejected?.observation, undefined);
      },
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("exact reconciliation returns complete readback and never broadens a failed read", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    await rebuildProjectReadModel(fixture.root);
    await captureProjectProviderScopes(fixture.root, [".scratch/scope-001"]);
    await writeFile(
      `${fixture.root}/${fixture.nativeLocator}`,
      (await readFile(`${fixture.root}/${fixture.nativeLocator}`, "utf8")).replace(
        "Status: resolved",
        "Status: claimed",
      ),
    );
    const reconciled = await reconcileProjectNative(fixture.root, {
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
      subjects: [fixture.nativeLocator],
      relations: [],
    });
    assert.equal(reconciled.outcome, "complete");
    assert.equal(reconciled.result.acquisitionCount, 1);
    assert.match(reconciled.result.requestFingerprint, /^sha256:/u);
    assert.match(reconciled.result.generationFingerprint, /^sha256:/u);
    assert.deepEqual(reconciled.result.dispositions, [
      { reference: fixture.nativeLocator, disposition: "read" },
    ]);
    assert.equal(reconciled.result.readback.length, 1);
    assert.equal(reconciled.result.readback[0]?.nativeReference, fixture.nativeLocator);
    const entity = reconciled.result.readback[0]?.entity;
    assert.ok(entity !== undefined && entity.kind === "wayfinder-ticket");
    assert.equal(entity.claim.state, "claimed");

    let captureCount = 0;
    let reconcileCount = 0;
    const failed = await reconcileProjectNative(
      fixture.root,
      {
        binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
        subjects: [fixture.nativeLocator],
        relations: [],
      },
      {
        providerFactory: (input) => {
          const provider = defaultMattProviderFactory(input);
          return {
            ...provider,
            capture: async (binding) => {
              captureCount += 1;
              return provider.capture(binding);
            },
            reconcile: async () => {
              reconcileCount += 1;
              throw new ProviderObservationAcquisitionUnavailableError("expected failure");
            },
          };
        },
      },
    );
    assert.equal(failed.outcome, "unfulfilled");
    assert.equal(failed.result.acquisitionCount, 1);
    assert.equal(reconcileCount, 1);
    assert.equal(captureCount, 0);
    const afterFailure = await inspectProjectReadModel(fixture.root);
    assert.equal(afterFailure.state, "ready");
    if (afterFailure.state !== "ready") throw new Error("Expected retained generation.");
    assert.equal(afterFailure.metadata.receipt.publicationCount, 3);
    assert.equal(afterFailure.metadata.basisFingerprint, reconciled.result.generationFingerprint);
    const retained = (await readProjectProviderEvidence(fixture.root, "bound")).find(
      (entry) => entry.selection.nativeScope === ".scratch/scope-001",
    );
    assert.ok(retained?.observation !== undefined);
    assert.equal(retained.selection.effectiveFreshness, "current");
    assert.equal(retained.selection.latestAttempt?.outcome, "failed");

    const repeated = await reconcileProjectNative(fixture.root, {
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
      subjects: [fixture.nativeLocator],
      relations: [],
    });
    assert.equal(repeated.outcome, "unfulfilled");
    assert.equal(repeated.result.acquisitionCount, 0);
    const afterRepeatedRequest = (await readProjectProviderEvidence(fixture.root, "bound")).find(
      (entry) => entry.selection.nativeScope === ".scratch/scope-001",
    );
    assert.equal(afterRepeatedRequest?.selection.latestAttempt?.outcome, "failed");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("bound and detail roles retain one current row and detail replacement does not publish", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    await rebuildProjectReadModel(fixture.root);
    await captureProjectProviderScopes(fixture.root, [".scratch/scope-001"]);
    const bound = (await readProjectProviderEvidence(fixture.root, "bound")).find(
      (entry) => entry.selection.nativeScope === ".scratch/scope-001",
    );
    assert.ok(bound?.observation !== undefined);
    const before = await inspectProjectReadModel(fixture.root);
    assert.equal(before.state, "ready");
    if (before.state !== "ready") throw new Error("Expected current Project Read Model.");

    await replaceProjectProviderEvidence(fixture.root, {
      ...bound,
      role: "detail",
    });
    await replaceProjectProviderEvidence(fixture.root, {
      ...bound,
      role: "detail",
      selection: {
        ...bound.selection,
        latestAttempt: {
          intent: "provider-detail-selection",
          attemptedAt: "2026-08-08T00:00:00.000Z",
          outcome: "succeeded",
          diagnostics: [],
        },
      },
    });
    const after = await inspectProjectReadModel(fixture.root);
    assert.equal(after.state, "ready");
    if (after.state !== "ready") throw new Error("Expected current Project Read Model.");
    assert.deepEqual(after.metadata.receipt, before.metadata.receipt);
    await assert.rejects(
      replaceProjectProviderEvidence(fixture.root, {
        ...bound,
        observation: {
          ...bound.observation,
          sourceRevision: "changed-outside-generation-publication",
        },
      }),
      /cannot change the selected observation/u,
    );

    const summaryPath = `${fixture.root}/${fixture.summaryLocator}`;
    await writeFile(
      summaryPath,
      (await readFile(summaryPath, "utf8")).replace("variant A", "variant B"),
    );
    const currentBound = await readProjectProviderEvidence(fixture.root, "bound");
    const staleCandidate = await materializeProjectReadModelCandidate(fixture.root, {
      providerObservationStore: {
        schemaVersion: 1,
        observations: currentBound.flatMap((entry) =>
          entry.observation === undefined ? [] : [entry.observation],
        ),
        selections: currentBound.map((entry) => entry.selection),
      },
      providerDetailEvidenceState: null,
    });
    await replaceProjectProviderEvidence(fixture.root, {
      ...bound,
      role: "detail",
      selection: {
        ...bound.selection,
        latestAttempt: {
          intent: "provider-detail-selection",
          attemptedAt: "2026-08-08T01:00:00.000Z",
          outcome: "succeeded",
          diagnostics: [],
        },
      },
    });
    await publishProjectReadModel(fixture.root, staleCandidate);
    const afterCanonicalPublication = await readProjectProviderEvidence(fixture.root, "detail");
    assert.equal(afterCanonicalPublication.length, 1);
    assert.equal(
      afterCanonicalPublication[0]?.selection.latestAttempt?.intent,
      "provider-detail-selection",
    );
    assert.equal(
      afterCanonicalPublication[0]?.selection.latestAttempt?.attemptedAt,
      "2026-08-08T01:00:00.000Z",
    );
    assert.equal(
      (await readProjectProviderEvidence(fixture.root, "bound")).filter(
        (entry) => entry.bindingKey === bound.bindingKey,
      ).length,
      1,
    );
    const effortPath = `${fixture.root}/.bearing/state/efforts/e001.md`;
    await writeFile(
      effortPath,
      (await readFile(effortPath, "utf8")).replace(
        "Work binding:\n  Provider: matt-skills/v1\n  Native scope: .scratch/scope-001\n",
        "",
      ),
    );
    const afterBindingRemovalCandidate = await materializeProjectReadModelCandidate(fixture.root, {
      providerObservationStore: {
        schemaVersion: 1,
        observations: currentBound.flatMap((entry) =>
          entry.observation === undefined ? [] : [entry.observation],
        ),
        selections: currentBound.map((entry) => entry.selection),
      },
      providerDetailEvidenceState: null,
    });
    await publishProjectReadModel(fixture.root, afterBindingRemovalCandidate);
    assert.equal(
      (await readProjectProviderEvidence(fixture.root)).some(
        (entry) => entry.bindingKey === bound.bindingKey,
      ),
      false,
    );

    const database = new DatabaseSync(projectReadModelPath(fixture.root), { readOnly: true });
    assert.equal(
      database
        .prepare(
          "SELECT count(*) AS count FROM provider_evidence WHERE binding_key = ? AND role = 'bound'",
        )
        .get(bound.bindingKey)?.["count"],
      0,
    );
    assert.equal(
      database
        .prepare(
          "SELECT count(*) AS count FROM provider_evidence WHERE binding_key = ? AND role = 'detail'",
        )
        .get(bound.bindingKey)?.["count"],
      0,
    );
    database.close();
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("explicit rebuild recovers corrupt disposable bytes but never downgrades a newer store", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    await rebuildProjectReadModel(fixture.root);
    const path = projectReadModelPath(fixture.root);
    const futureProjection = new DatabaseSync(path);
    futureProjection
      .prepare("UPDATE read_model_metadata SET projection_version = ? WHERE singleton = 1")
      .run(PROJECT_READ_MODEL_PROJECTION_VERSION + 1);
    futureProjection.close();
    const futureProjectionBytes = await readFile(path);
    const projectionRefused = await rebuildProjectReadModel(fixture.root);
    assert.equal(projectionRefused.outcome, "need-update");
    assert.deepEqual(await readFile(path), futureProjectionBytes);

    const currentProjection = new DatabaseSync(path);
    currentProjection
      .prepare("UPDATE read_model_metadata SET projection_version = ? WHERE singleton = 1")
      .run(PROJECT_READ_MODEL_PROJECTION_VERSION);
    currentProjection.close();
    const newer = new DatabaseSync(path);
    newer.exec("PRAGMA user_version = 2");
    newer.close();
    const refused = await rebuildProjectReadModel(fixture.root);
    assert.equal(refused.outcome, "need-update");
    const retained = new DatabaseSync(path, { readOnly: true });
    assert.equal(retained.prepare("PRAGMA user_version").get()?.["user_version"], 2);
    retained.close();
    const captureRefused = await captureProjectProviderScopes(fixture.root, [".scratch/scope-001"]);
    assert.equal(captureRefused.outcome, "need-update");
    assert.equal(captureRefused.result.acquisitionCount, 0);
    const reconcileRefused = await reconcileProjectNative(fixture.root, {
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
      subjects: [fixture.nativeLocator],
      relations: [],
    });
    assert.equal(reconcileRefused.outcome, "need-update");
    assert.equal(reconcileRefused.result.generationFingerprint, null);

    const restorable = new DatabaseSync(path);
    restorable.exec("PRAGMA user_version = 1");
    restorable.close();
    await writeFile(path, "not a sqlite database\n");
    const corruptReconciliation = await reconcileProjectNative(fixture.root, {
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
      subjects: [fixture.nativeLocator],
      relations: [],
    });
    assert.equal(corruptReconciliation.outcome, "recovery-required");
    assert.equal(corruptReconciliation.result.acquisitionCount, 0);
    const rebuilt = await rebuildProjectReadModel(fixture.root);
    assert.equal(rebuilt.outcome, "complete");
    assert.equal(rebuilt.result.acquisitionCount, 0);
    assert.equal(rebuilt.result.missingEvidenceScopes.length, 9);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("all-scope verification is explicit and captures each current Work Binding once", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    await rebuildProjectReadModel(fixture.root);
    const verified = await verifyAllProjectProviderScopes(fixture.root);
    assert.equal(verified.outcome, "complete");
    assert.equal(verified.result.acquisitionCount, 9);
    assert.deepEqual(verified.result.missingEvidenceScopes, []);
    assert.equal(verified.result.scopes.length, 9);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("mixed all-scope verification publishes successful captures with failed attempts atomically", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    await rebuildProjectReadModel(fixture.root);
    const before = await inspectProjectReadModel(fixture.root);
    assert.equal(before.state, "ready");
    const verified = await verifyAllProjectProviderScopes(fixture.root, {
      providerFactory: (input) => {
        const provider = defaultMattProviderFactory(input);
        return {
          ...provider,
          capture: async (binding) => {
            if (binding.nativeScope === ".scratch/scope-005") {
              throw new ProviderObservationAcquisitionUnavailableError("expected mixed failure");
            }
            return provider.capture(binding);
          },
        };
      },
    });
    assert.equal(verified.outcome, "unfulfilled");
    assert.equal(verified.result.acquisitionCount, 9);
    assert.deepEqual(verified.result.missingEvidenceScopes, [".scratch/scope-005"]);
    assert.deepEqual(
      verified.result.scopes.find((entry) => entry.scope === ".scratch/scope-005"),
      { scope: ".scratch/scope-005", disposition: "unavailable" },
    );
    const after = await inspectProjectReadModel(fixture.root);
    assert.equal(after.state, "ready");
    if (before.state !== "ready" || after.state !== "ready") {
      throw new Error("Expected ready generations around mixed verification.");
    }
    assert.equal(
      after.metadata.receipt.publicationCount,
      before.metadata.receipt.publicationCount + 1,
    );
    const evidence = await readProjectProviderEvidence(fixture.root, "bound");
    const failed = evidence.find((entry) => entry.selection.nativeScope === ".scratch/scope-005");
    const captured = evidence.find((entry) => entry.selection.nativeScope === ".scratch/scope-002");
    assert.equal(failed?.observation, undefined);
    assert.equal(failed?.selection.effectiveFreshness, "undetermined");
    assert.equal(failed?.selection.latestAttempt?.outcome, "failed");
    assert.equal(captured?.selection.effectiveFreshness, "current");
    assert.equal(captured?.selection.latestAttempt?.outcome, "succeeded");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SQLite acquisition preserves complete GitHub Matt semantics through the same exact operations", async () => {
  const root = await createGitHubMattRepository();
  try {
    const repository = await writeStandardGitHubMattProductRepository(root, {
      title: "GitHub observation path",
      intent: "Preserve the complete Matt provider contract.",
      work: "- Capture and reconcile one exact GitHub scope.",
    });
    const transport = new FixtureGitHubTransport(createReferenceGitHubFixtures());
    const providerFactory = githubMattProviderFactoryFor(transport);
    await rebuildProjectReadModel(root);
    const captured = await captureProjectProviderScopes(root, [repository.nativeScope], {
      providerFactory,
    });
    assert.equal(captured.outcome, "complete");
    assert.equal(captured.result.acquisitionCount, 1);
    const evidence = (await readProjectProviderEvidence(root, "bound")).find(
      (entry) => entry.selection.nativeScope === repository.nativeScope,
    );
    assert.ok(evidence?.observation?.state === "available");
    assert.equal(evidence.observation.projection.map?.kind, "map");
    assert.equal(evidence.observation.projection.spec?.kind, "spec");
    assert.equal(evidence.observation.projection.wayfinderTickets.length, 1);
    assert.equal(evidence.observation.projection.deliveryTickets.length, 1);
    assert.equal(evidence.observation.projection.incomingIssues.length, 1);
    const delivery = evidence.observation.projection.deliveryTickets[0];
    assert.ok(delivery !== undefined);
    assert.equal(delivery.native.kind, "github");
    if (delivery.native.kind !== "github") throw new Error("Expected GitHub native evidence.");
    const inspectedUrl = await inspectProject(root, {
      kind: "native-reference",
      reference: delivery.native.identity.url,
    });
    assert.equal(inspectedUrl.outcome, "complete");
    assert.ok(inspectedUrl.result !== undefined && "binding" in inspectedUrl.result);
    assert.equal(inspectedUrl.result.binding.state, "bound");
    const reconciled = await reconcileProjectNative(
      root,
      {
        binding: { provider: "matt-skills/v1", nativeScope: repository.nativeScope },
        subjects: [delivery.ref],
        relations: [],
      },
      { providerFactory },
    );
    assert.equal(reconciled.outcome, "complete");
    assert.equal(reconciled.result.acquisitionCount, 1);
    assert.equal(reconciled.result.readback[0]?.entity.kind, "delivery-ticket");
    assert.ok(transport.requests.length > 0);

    const currentBound = await readProjectProviderEvidence(root, "bound");
    const current = currentBound.find(
      (entry) => entry.selection.nativeScope === repository.nativeScope,
    );
    assert.ok(current?.observation !== undefined);
    await replaceProjectProviderEvidence(root, { ...current, role: "detail" });
    const decodedScope = decodeGitHubMattNativeScope(repository.nativeScope);
    assert.ok(decodedScope !== undefined);
    const changedScope = encodeGitHubMattNativeScope({
      ...decodedScope,
      rootKind: "parent-issue",
    });
    const effortPath = `${root}/.bearing/state/efforts/test.md`;
    await writeFile(
      effortPath,
      (await readFile(effortPath, "utf8")).replace(repository.nativeScope, changedScope),
    );
    const changedCandidate = await materializeProjectReadModelCandidate(root, {
      providerObservationStore: {
        schemaVersion: 1,
        observations: currentBound.flatMap((entry) =>
          entry.observation === undefined ? [] : [entry.observation],
        ),
        selections: currentBound.map((entry) => entry.selection),
      },
      providerDetailEvidenceState: null,
    });
    await publishProjectReadModel(root, changedCandidate);
    assert.equal((await readProjectProviderEvidence(root, "detail")).length, 0);
    const mismatchedInterpretation = await reconcileProjectNative(
      root,
      {
        binding: { provider: "matt-skills/v1", nativeScope: repository.nativeScope },
        subjects: [delivery.ref],
        relations: [],
      },
      { providerFactory },
    );
    assert.equal(mismatchedInterpretation.outcome, "unfulfilled");
    assert.equal(mismatchedInterpretation.result.acquisitionCount, 0);
    assert.deepEqual(mismatchedInterpretation.result.readback, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
