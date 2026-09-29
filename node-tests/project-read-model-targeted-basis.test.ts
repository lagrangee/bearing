import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fileSystem, { appendFile, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { nativeReconciliationRequestFingerprint } from "../src/native-reconciliation-contract";
import { queryCommittedProject } from "../src/project-read-model/inspect";
import { queryPortalProjectRows } from "../src/project-read-model/portal";
import {
  captureProjectProviderScopes,
  rebuildProjectReadModel,
  reconcileProjectNative,
} from "../src/project-read-model/provider-operations";
import {
  inspectProjectReadModel,
  readProjectProviderEvidence,
  replaceProjectProviderEvidence,
} from "../src/project-read-model/store";
import { defaultMattProviderFactory } from "../src/provider-acquisition";
import { assessSelectedProviderObservationEvidence } from "../src/provider-evidence-contract";
import { ProviderObservationAcquisitionUnavailableError } from "../src/provider-evidence-selection";
import { createValidBearingRepo } from "../tests/helpers";

const nativeReference = ".scratch/work/issues/01-finish.md";
const request = {
  binding: { provider: "matt-skills/v1" as const, nativeScope: ".scratch/work" },
  subjects: [nativeReference],
};
const attemptedAt = "2026-09-30T00:00:00.000Z";
const noAcquisition = () => {
  throw new Error("Rejected targeted basis must not resolve or acquire a provider.");
};

test("the CLI returns a failing terminal receipt and durably records a rejected basis", async () => {
  const root = await createValidBearingRepo();
  try {
    await rebuildProjectReadModel(root);
    const before = await inspectProjectReadModel(root);
    const child = spawnSync(
      process.execPath,
      [
        `${process.cwd()}/dist/cli.js`,
        "reconcile-native",
        "--repo",
        root,
        "--scope",
        request.binding.nativeScope,
        "--ref",
        nativeReference,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.command, "reconcile-native");
    assert.equal(result.outcome, "unfulfilled");
    assert.equal(result.result.acquisitionCount, 0);
    assert.deepEqual(result.result.dispositions, [
      { reference: nativeReference, disposition: "missing" },
    ]);
    assert.deepEqual(await inspectProjectReadModel(root), before);
    const evidence = (await readProjectProviderEvidence(root, "bound"))[0];
    assert.equal(evidence?.selection.latestAttempt?.outcome, "failed");
    assert.deepEqual(evidence?.selection.latestAttempt?.diagnostics, result.diagnostics);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const reason of ["missing", "failed", "stale", "undetermined"] as const) {
  test(`targeted ${reason} basis retains truthful attempt without publishing a generation, then recovers explicitly`, async () => {
    const root = await createValidBearingRepo();
    try {
      if (reason === "missing") await rebuildProjectReadModel(root);
      else {
        await captureProjectProviderScopes(root, [request.binding.nativeScope]);
        if (reason === "failed") {
          const failure = await reconcileProjectNative(root, request, {
            providerFactory: (input) => ({
              ...defaultMattProviderFactory(input),
              reconcile: async () => {
                throw new ProviderObservationAcquisitionUnavailableError("fixture failure");
              },
            }),
          });
          assert.equal(failure.outcome, "unfulfilled");
          assert.equal(failure.result.acquisitionCount, 1);
        } else {
          const prior = (await readProjectProviderEvidence(root, "bound"))[0];
          assert.ok(prior?.observation);
          await replaceProjectProviderEvidence(root, {
            ...prior,
            selection: { ...prior.selection, effectiveFreshness: reason },
          });
        }
      }
      const before = await inspectProjectReadModel(root);
      const previous = (await readProjectProviderEvidence(root, "bound"))[0];
      const result = await reconcileProjectNative(root, request, {
        providerFactory: noAcquisition,
        now: () => attemptedAt,
      });
      assert.equal(result.outcome, "unfulfilled");
      assert.equal(result.result.acquisitionCount, 0);
      assert.deepEqual(
        result.diagnostics.map((item) => item.code),
        ["provider-targeted-reconciliation-basis-unavailable", "provider-acquisition-incomplete"],
      );
      assert.deepEqual(await inspectProjectReadModel(root), before);
      const retained = (await readProjectProviderEvidence(root, "bound"))[0];
      assert.deepEqual(retained?.observation, previous?.observation);
      assert.equal(retained?.selection.effectiveFreshness, previous?.selection.effectiveFreshness);
      assert.equal(retained?.selection.latestAttempt?.outcome, "failed");
      assert.equal(retained?.selection.latestAttempt?.attemptedAt, attemptedAt);
      assert.equal(
        retained?.selection.latestAttempt?.requestFingerprint,
        nativeReconciliationRequestFingerprint({ schemaVersion: 2, ...request }),
      );
      assert.deepEqual(retained?.selection.latestAttempt?.diagnostics, result.diagnostics);
      const inspected = await queryCommittedProject(root, {
        kind: "native-reference",
        reference: nativeReference,
      });
      assert.ok(inspected.result && "binding" in inspected.result);
      assert.equal(inspected.result.binding.state, "bound");
      if (inspected.result.binding.state !== "bound") throw new Error("Expected bound subject.");
      assert.equal(inspected.result.binding.targetedReconciliationBasis.state, "capture-required");
      assert.equal(
        inspected.result.binding.effectiveFreshness,
        previous?.selection.effectiveFreshness,
      );
      if (reason === "stale" || reason === "undetermined") {
        assert.deepEqual(inspected.result.binding.targetedReconciliationBasis, {
          state: "capture-required",
          reason: "freshness-not-current",
        });
        const portal = await queryPortalProjectRows(root, "lineage", {
          kind: "native-subject",
          id: nativeReference,
        });
        const evidence = portal.objects.find(
          (object) => object.kind === "portal-native-evidence" && object.value.role === "bound",
        );
        assert.ok(evidence?.kind === "portal-native-evidence");
        const assessment = assessSelectedProviderObservationEvidence(
          evidence.value.observation,
          evidence.value.selection,
        );
        assert.equal(assessment.freshness, reason);
        assert.equal(assessment.frontierEvidence, "withheld");
      }

      const failedReceipt = JSON.stringify(result);
      assert.equal(
        (await captureProjectProviderScopes(root, [request.binding.nativeScope])).outcome,
        "complete",
      );
      const recovered = await reconcileProjectNative(root, request);
      assert.equal(recovered.outcome, "complete");
      assert.equal(recovered.result.acquisitionCount, 1);
      assert.deepEqual(recovered.result.dispositions, [
        { reference: request.subjects[0], disposition: "read" },
      ]);
      assert.equal(JSON.stringify(result), failedReceipt);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("a missing whole store still initializes the generation required to retain its failed attempt", async () => {
  const root = await createValidBearingRepo();
  try {
    assert.equal((await inspectProjectReadModel(root)).state, "missing");
    const result = await reconcileProjectNative(root, request, {
      providerFactory: noAcquisition,
      now: () => attemptedAt,
    });
    assert.equal(result.outcome, "unfulfilled");
    assert.equal(result.result.acquisitionCount, 0);
    const state = await inspectProjectReadModel(root);
    assert.equal(state.state, "ready");
    if (state.state !== "ready") throw new Error("Expected initialized generation.");
    assert.equal(state.metadata.receipt.publicationCount, 1);
    const retained = (await readProjectProviderEvidence(root, "bound"))[0];
    assert.equal(retained?.observation, undefined);
    assert.equal(retained?.selection.latestAttempt?.outcome, "failed");
    assert.equal(retained?.selection.latestAttempt?.attemptedAt, attemptedAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a newly bound scope initializes its required projection while retaining a failed attempt", async () => {
  const root = await createValidBearingRepo();
  try {
    const effortPath = `${root}/.bearing/state/efforts/test.md`;
    const effort = await readFile(effortPath, "utf8");
    await rm(effortPath);
    await rebuildProjectReadModel(root);
    const before = await inspectProjectReadModel(root);
    assert.deepEqual(await readProjectProviderEvidence(root, "bound"), []);
    await writeFile(effortPath, effort);
    const result = await reconcileProjectNative(root, request, {
      providerFactory: noAcquisition,
      now: () => attemptedAt,
    });
    assert.equal(result.outcome, "unfulfilled");
    assert.equal(result.result.acquisitionCount, 0);
    const after = await inspectProjectReadModel(root);
    assert.ok(before.state === "ready" && after.state === "ready");
    assert.equal(
      after.metadata.receipt.publicationCount,
      before.metadata.receipt.publicationCount + 1,
    );
    const retained = (await readProjectProviderEvidence(root, "bound"))[0];
    assert.equal(retained?.selection.nativeScope, request.binding.nativeScope);
    assert.equal(retained?.observation, undefined);
    assert.equal(retained?.selection.latestAttempt?.outcome, "failed");
    assert.equal(retained?.selection.latestAttempt?.attemptedAt, attemptedAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const changed of ["removed", "replaced", "invalid", "conflicting"] as const) {
  test(`targeted admission checks a currently ${changed} Binding before trusting stored ready evidence`, async () => {
    const root = await createValidBearingRepo();
    try {
      await captureProjectProviderScopes(root, [request.binding.nativeScope]);
      const before = await readProjectProviderEvidence(root, "bound");
      const effortPath = `${root}/.bearing/state/efforts/test.md`;
      const effort = await readFile(effortPath, "utf8");
      if (changed === "removed") await rm(effortPath);
      else if (changed === "conflicting") {
        await writeFile(
          `${root}/.bearing/state/efforts/duplicate.md`,
          effort.replace("ID: effort:test", "ID: effort:duplicate"),
        );
      } else {
        await writeFile(
          effortPath,
          effort.replace(
            "Native scope: .scratch/work",
            changed === "replaced" ? "Native scope: .scratch/replacement" : "Native scope: null",
          ),
        );
      }
      const result = await reconcileProjectNative(root, request, {
        providerFactory: noAcquisition,
        now: () => attemptedAt,
      });
      assert.equal(result.outcome, "unfulfilled");
      assert.equal(result.result.acquisitionCount, 0);
      assert.ok(
        result.diagnostics.some(
          (diagnostic) =>
            diagnostic.code ===
            (changed === "conflicting"
              ? "provider-binding-conflict"
              : "provider-targeted-reconciliation-binding-unavailable"),
        ),
      );
      const after = await readProjectProviderEvidence(root, "bound");
      if (changed === "conflicting") {
        assert.equal(after[0]?.selection.latestAttempt?.outcome, "failed");
        assert.equal(after[0]?.selection.effectiveFreshness, "undetermined");
        assert.deepEqual(after[0]?.observation, before[0]?.observation);
      } else {
        assert.deepEqual(after, before);
        assert.deepEqual(result.result.readback, []);
        assert.equal(result.result.generationFingerprint, null);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const winner of ["capture", "attempt", "changed-binding"] as const) {
  test(`an early failure cannot overwrite the concurrent ${winner} winner`, async (context) => {
    const root = await realpath(await createValidBearingRepo());
    const arrived = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const originalOpen = fileSystem.open;
    let hold = false;
    const opened = context.mock.method(
      fileSystem,
      "open",
      async (...args: Parameters<typeof originalOpen>) => {
        if (hold && String(args[0]).startsWith(`${root}/.bearing/state/`)) {
          hold = false;
          arrived.resolve();
          await resume.promise;
        }
        return originalOpen(...args);
      },
    );
    syncBuiltinESMExports();
    let pending: ReturnType<typeof reconcileProjectNative> | undefined;
    try {
      await rebuildProjectReadModel(root);
      hold = true;
      pending = reconcileProjectNative(root, request, {
        providerFactory: noAcquisition,
        now: () => attemptedAt,
      });
      await Promise.race([
        arrived.promise,
        pending.then(() => {
          throw new Error("Expected the canonical input barrier.");
        }),
      ]);
      if (winner === "capture") {
        await appendFile(`${root}/${request.subjects[0]}`, "\nConcurrent evidence winner.\n");
        await captureProjectProviderScopes(root, [request.binding.nativeScope]);
      } else if (winner === "attempt") {
        await reconcileProjectNative(root, request, { now: () => "2026-09-30T01:00:00.000Z" });
      } else {
        const effortPath = `${root}/.bearing/state/efforts/test.md`;
        await writeFile(
          effortPath,
          (await readFile(effortPath, "utf8")).replace(
            "Native scope: .scratch/work",
            "Native scope: .scratch/replacement",
          ),
        );
        await rebuildProjectReadModel(root);
      }
      const winnerEvidence = await readProjectProviderEvidence(root, "bound");
      const winnerState = await inspectProjectReadModel(root);
      resume.resolve();
      const loser = await pending;
      assert.equal(loser.outcome, "unfulfilled");
      assert.equal(loser.result.acquisitionCount, 0);
      assert.equal(loser.result.generationFingerprint, null);
      assert.deepEqual(loser.result.readback, []);
      assert.ok(
        loser.diagnostics.some(
          (diagnostic) =>
            diagnostic.code ===
            (winner === "changed-binding"
              ? "provider-targeted-reconciliation-binding-unavailable"
              : "project-read-model-publication-conflict"),
        ),
      );
      assert.deepEqual(await readProjectProviderEvidence(root, "bound"), winnerEvidence);
      assert.deepEqual(await inspectProjectReadModel(root), winnerState);
    } finally {
      resume.resolve();
      await pending;
      opened.mock.restore();
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  });
}
