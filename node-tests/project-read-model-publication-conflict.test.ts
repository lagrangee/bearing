import assert from "node:assert/strict";
import fileSystem, { appendFile, cp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import {
  captureProjectProviderScopes,
  rebuildProjectReadModel,
  reconcileProjectNative,
  verifyAllProjectProviderScopes,
} from "../src/project-read-model/provider-operations";
import {
  inspectProjectReadModel,
  readProjectProviderEvidence,
} from "../src/project-read-model/store";
import { defaultMattProviderFactory } from "../src/provider-acquisition";
import { targetedReconciliationBasis } from "../src/provider-evidence-contract";
import { createValidBearingRepo } from "../tests/helpers";

const addScope = async (root: string) => {
  await cp(`${root}/.scratch/work`, `${root}/.scratch/other`, { recursive: true });
  const effort = await readFile(`${root}/.bearing/state/efforts/test.md`, "utf8");
  await writeFile(
    `${root}/.bearing/state/efforts/other.md`,
    effort
      .replace("ID: effort:test", "ID: effort:other")
      .replace("Native scope: .scratch/work", "Native scope: .scratch/other"),
  );
};

test("a stale disjoint capture preserves the winner and records only its eligible failed attempt", async () => {
  const root = await createValidBearingRepo();
  const acquired = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  try {
    await addScope(root);
    assert.equal((await verifyAllProjectProviderScopes(root)).outcome, "complete");
    const prior = (await readProjectProviderEvidence(root, "bound")).find(
      (row) => row.selection.nativeScope === ".scratch/work",
    );
    assert.ok(prior);
    await appendFile(
      `${root}/.scratch/work/issues/01-finish.md`,
      "\nA newly acquired work detail.\n",
    );
    const pending = captureProjectProviderScopes(root, [".scratch/work"], {
      providerFactory: (input) => {
        const provider = defaultMattProviderFactory(input);
        return {
          ...provider,
          capture: async (binding) => {
            const result = await provider.capture(binding);
            acquired.resolve();
            await resume.promise;
            return result;
          },
        };
      },
    });
    await Promise.race([
      acquired.promise,
      pending.then(() => {
        throw new Error("Capture missed its barrier.");
      }),
    ]);
    await appendFile(`${root}/.scratch/other/issues/01-finish.md`, "\nThe winning scope detail.\n");
    assert.equal(
      (await captureProjectProviderScopes(root, [".scratch/other"])).outcome,
      "complete",
    );
    const winner = (await readProjectProviderEvidence(root, "bound")).find(
      (row) => row.selection.nativeScope === ".scratch/other",
    );
    const winnerState = await inspectProjectReadModel(root);
    resume.resolve();
    const loser = await pending;
    assert.equal(loser.outcome, "unfulfilled");
    assert.equal(loser.result.acquisitionCount, 1);
    assert.deepEqual(loser.result.scopes, [{ scope: ".scratch/work", disposition: "unpublished" }]);
    assert.equal(loser.result.generationFingerprint, undefined);
    assert.ok(
      loser.diagnostics.some((item) => item.code === "project-read-model-publication-conflict"),
    );
    const after = await readProjectProviderEvidence(root, "bound");
    assert.deepEqual(
      after.find((row) => row.selection.nativeScope === ".scratch/other"),
      winner,
    );
    const retained = after.find((row) => row.selection.nativeScope === ".scratch/work");
    assert.ok(retained);
    assert.deepEqual(retained.observation, prior.observation);
    assert.equal(retained.selection.effectiveFreshness, prior.selection.effectiveFreshness);
    assert.equal(retained.selection.latestAttempt?.outcome, "failed");
    assert.deepEqual(targetedReconciliationBasis(retained.selection, retained.observation), {
      state: "capture-required",
      reason: "latest-attempt-failed",
    });
    assert.deepEqual(await inspectProjectReadModel(root), winnerState);
  } finally {
    resume.resolve();
    await rm(root, { recursive: true, force: true });
  }
});

for (const scenario of [
  { intent: "capture", winnerScope: ".scratch/work" },
  { intent: "reconcile", winnerScope: ".scratch/work" },
  { intent: "reconcile", winnerScope: ".scratch/other" },
] as const) {
  test(`stale ${scenario.intent} keeps ${scenario.winnerScope} winner evidence and its own unpublished result`, async () => {
    const root = await createValidBearingRepo();
    const acquired = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let acquisitionCount = 0;
    try {
      await addScope(root);
      assert.equal((await verifyAllProjectProviderScopes(root)).outcome, "complete");
      await appendFile(`${root}/.scratch/work/issues/01-finish.md`, "\nThe losing native write.\n");
      const dependencies = {
        providerFactory: (input: Parameters<typeof defaultMattProviderFactory>[0]) => {
          const provider = defaultMattProviderFactory(input);
          return {
            ...provider,
            capture: async (binding: Parameters<typeof provider.capture>[0]) => {
              acquisitionCount += 1;
              const observation = await provider.capture(binding);
              acquired.resolve();
              await resume.promise;
              return observation;
            },
            reconcile: async (request: Parameters<NonNullable<typeof provider.reconcile>>[0]) => {
              assert.ok(provider.reconcile);
              acquisitionCount += 1;
              const observation = await provider.reconcile(request);
              acquired.resolve();
              await resume.promise;
              return observation;
            },
          };
        },
      };
      const pending =
        scenario.intent === "capture"
          ? captureProjectProviderScopes(root, [".scratch/work"], dependencies)
          : reconcileProjectNative(
              root,
              {
                binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
                subjects: [".scratch/work/issues/01-finish.md"],
              },
              dependencies,
            );
      await Promise.race([
        acquired.promise,
        pending.then(() => {
          throw new Error("Acquisition missed its barrier.");
        }),
      ]);
      await appendFile(
        `${root}/${scenario.winnerScope}/issues/01-finish.md`,
        "\nThe winner's current native write.\n",
      );
      const winner = await captureProjectProviderScopes(root, [scenario.winnerScope]);
      assert.equal(winner.outcome, "complete");
      const winnerEvidence = (await readProjectProviderEvidence(root, "bound")).find(
        (row) => row.selection.nativeScope === scenario.winnerScope,
      );
      const winnerState = await inspectProjectReadModel(root);
      resume.resolve();
      const loser = await pending;
      assert.equal(loser.outcome, "unfulfilled");
      assert.equal(loser.result.acquisitionCount, 1);
      assert.equal(acquisitionCount, 1);
      assert.ok(
        loser.diagnostics.some(
          (diagnostic) => diagnostic.code === "project-read-model-publication-conflict",
        ),
      );
      if ("readback" in loser.result) {
        assert.deepEqual(loser.result.readback, []);
        assert.deepEqual(loser.result.relationDispositions, []);
        assert.deepEqual(loser.result.dispositions, [
          { reference: ".scratch/work/issues/01-finish.md", disposition: "unpublished" },
        ]);
        assert.equal(loser.result.generationFingerprint, null);
      } else {
        assert.deepEqual(loser.result.scopes, [
          { scope: ".scratch/work", disposition: "unpublished" },
        ]);
        assert.equal(loser.result.generationFingerprint, undefined);
      }
      assert.deepEqual(
        (await readProjectProviderEvidence(root, "bound")).find(
          (row) => row.selection.nativeScope === scenario.winnerScope,
        ),
        winnerEvidence,
      );
      assert.deepEqual(await inspectProjectReadModel(root), winnerState);
      const originalLoser = JSON.stringify(loser);
      assert.equal(
        (await captureProjectProviderScopes(root, [".scratch/work"])).outcome,
        "complete",
      );
      assert.equal(JSON.stringify(loser), originalLoser);
    } finally {
      resume.resolve();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("a healthy local rebuild cannot overwrite a provider publication acquired during its compilation", async (context) => {
  const root = await realpath(await createValidBearingRepo());
  const reading = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const originalOpen = fileSystem.open;
  let holdNextCanonicalRead = false;
  const opened = context.mock.method(
    fileSystem,
    "open",
    async (...args: Parameters<typeof originalOpen>) => {
      if (holdNextCanonicalRead && String(args[0]).startsWith(`${root}/.bearing/state/`)) {
        holdNextCanonicalRead = false;
        reading.resolve();
        await resume.promise;
      }
      return originalOpen(...args);
    },
  );
  syncBuiltinESMExports();
  try {
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    holdNextCanonicalRead = true;
    const rebuilding = rebuildProjectReadModel(root);
    await Promise.race([
      reading.promise,
      rebuilding.then(() => {
        throw new Error("Rebuild missed its canonical read barrier.");
      }),
    ]);
    await appendFile(
      `${root}/.scratch/work/issues/01-finish.md`,
      "\nProvider evidence committed during local rebuild.\n",
    );
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    const winner = await readProjectProviderEvidence(root, "bound");
    const winnerState = await inspectProjectReadModel(root);
    resume.resolve();
    const loser = await rebuilding;
    assert.equal(loser.outcome, "unfulfilled");
    assert.equal(loser.result.acquisitionCount, 0);
    assert.equal(loser.result.generationFingerprint, undefined);
    assert.ok(
      loser.diagnostics.some((item) => item.code === "project-read-model-publication-conflict"),
    );
    assert.deepEqual(await readProjectProviderEvidence(root, "bound"), winner);
    assert.deepEqual(await inspectProjectReadModel(root), winnerState);
  } finally {
    resume.resolve();
    opened.mock.restore();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});
