import { expect, test } from "bun:test";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProviderScopeObservation } from "../src/native-work-provider";
import type { MattProviderFactory } from "../src/provider-observation-acquisition";
import { assessSelectedProviderObservationEvidence } from "../src/provider-observation-contract";
import { ProviderObservationAcquisitionUnavailableError } from "../src/provider-observation-store";
import { commitSyncPlan, prepareSync } from "../src/sync-plan";
import { createMattReferenceProjection } from "./fixtures/matt-reference-scenario";
import { createValidBearingRepo, writeFixture } from "./helpers";

const factoryAt =
  (observedAt: string, calls: { count: number }): MattProviderFactory =>
  () => ({
    id: "matt-skills/v1",
    capture: async (binding) => {
      calls.count += 1;
      return createProviderScopeObservation({
        provider: "matt-skills/v1",
        binding,
        observedAt,
        sourceRevision: "fixture-revision",
        validators: [{ kind: "fixture-etag", value: '"fixture"' }],
        state: "available",
        freshness: {
          assessment: "current",
          evidence: [{ kind: "fixture", value: "provider-observation" }],
        },
        coverage: {
          assessment: "complete",
          dimensions: [{ key: "scope-membership", state: "covered" }],
        },
        completion: "incomplete",
        diagnostics: [],
        projection: createMattReferenceProjection("local"),
      });
    },
  });

test("ordinary Sync never acquires a missing initial observation baseline", async () => {
  const root = await createValidBearingRepo();
  const calls = { count: 0 };
  const ordinary = await prepareSync(root, {
    providerFactory: factoryAt("2026-07-31T00:00:00.000Z", calls),
  });

  expect(calls.count).toBe(0);
  expect(ordinary.providerObservationOperation).toEqual({
    intent: "ordinary-sync",
    outcome: "unavailable",
    acquisitionCount: 0,
  });
  expect(ordinary.providerObservations).toEqual([]);
  expect(ordinary.providerObservationSelections).toEqual([
    expect.objectContaining({
      nativeScope: ".scratch/work",
      observationId: null,
      effectiveFreshness: "undetermined",
    }),
  ]);
  expect(ordinary.diagnostics).toContainEqual(
    expect.objectContaining({ code: "provider-observation-store-unavailable" }),
  );
});

test("initial baseline publishes immutable observations that ordinary Sync reuses", async () => {
  const root = await createValidBearingRepo();
  const baselineCalls = { count: 0 };
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: factoryAt("2026-07-31T01:00:00.000Z", baselineCalls),
  });

  expect(baseline.providerObservationOperation).toMatchObject({
    intent: "initial-baseline",
    outcome: "acquired",
    acquisitionCount: 1,
  });
  expect(baseline.providerObservations).toHaveLength(1);
  expect(baseline.providerObservations[0]).toMatchObject({
    id: expect.stringMatching(/^provider-observation:sha256:[a-f0-9]{64}$/),
    observedAt: "2026-07-31T01:00:00.000Z",
    sourceRevision: "fixture-revision",
    validators: [{ kind: "fixture-etag", value: '"fixture"' }],
  });
  expect(baseline.providerObservations[0]).not.toHaveProperty("generation");
  expect(baselineCalls.count).toBe(1);
  await commitSyncPlan(baseline);

  const observationBytes = await readFile(
    join(root, ".bearing/cache/provider-observations.json"),
    "utf8",
  );
  const baselineObservation = baseline.providerObservations[0];
  if (baselineObservation === undefined) throw new Error("Expected one baseline observation.");
  const persisted = JSON.parse(String(observationBytes)) as {
    observations: readonly { id: string }[];
  };
  expect(persisted.observations.map((observation) => observation.id)).toEqual([
    baselineObservation.id,
  ]);

  const ordinaryCalls = { count: 0 };
  const ordinary = await prepareSync(root, {
    providerFactory: factoryAt("2026-07-31T02:00:00.000Z", ordinaryCalls),
  });
  expect(ordinary.providerObservationOperation).toMatchObject({
    intent: "ordinary-sync",
    outcome: "reused",
    acquisitionCount: 0,
  });
  expect(ordinary.providerObservations).toEqual(baseline.providerObservations);
  expect(ordinary.fingerprint).toBe(baseline.fingerprint);
  expect(ordinaryCalls.count).toBe(0);
});

test("canonical-only Sync changes the Snapshot fingerprint without rewriting observation time", async () => {
  const root = await createValidBearingRepo();
  const calls = { count: 0 };
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: factoryAt("2026-07-31T03:00:00.000Z", calls),
  });
  await commitSyncPlan(baseline);
  const selected = baseline.providerObservations[0];
  if (selected === undefined) throw new Error("Expected one baseline observation.");

  await writeFixture(root, "CONTEXT.md", "# Canonical-only change\n");
  const changed = await prepareSync(root);

  expect(changed.fingerprint).not.toBe(baseline.fingerprint);
  expect(changed.providerObservations[0]).toEqual(selected);
  expect(changed.providerObservations[0]?.observedAt).toBe("2026-07-31T03:00:00.000Z");
  expect(changed.metrics.providerAcquisitionCount).toBe(0);
});

test("explicit full verification is distinguishable and may replace the selected observation", async () => {
  const root = await createValidBearingRepo();
  const baselineCalls = { count: 0 };
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: factoryAt("2026-07-31T04:00:00.000Z", baselineCalls),
  });
  await commitSyncPlan(baseline);

  const verificationCalls = { count: 0 };
  const verified = await prepareSync(root, {
    providerObservationIntent: "full-verification",
    providerFactory: factoryAt("2026-07-31T05:00:00.000Z", verificationCalls),
  });

  expect(verified.providerObservationOperation).toMatchObject({
    intent: "full-verification",
    outcome: "acquired",
    acquisitionCount: 1,
  });
  expect(verificationCalls.count).toBe(1);
  expect(verified.providerObservations[0]?.observedAt).toBe("2026-07-31T05:00:00.000Z");
  expect(verified.providerObservations[0]?.id).not.toBe(baseline.providerObservations[0]?.id);
});

test("failed verification preserves prior evidence and records an undetermined latest attempt", async () => {
  const root = await createValidBearingRepo();
  const baselineCalls = { count: 0 };
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: factoryAt("2026-07-31T06:00:00.000Z", baselineCalls),
  });
  await commitSyncPlan(baseline);
  const prior = baseline.providerObservations[0];
  if (prior === undefined) throw new Error("Expected one baseline observation.");

  const failed = await prepareSync(root, {
    providerObservationIntent: "full-verification",
    providerObservationNow: () => "2026-07-31T07:00:00.000Z",
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async () => {
        throw new ProviderObservationAcquisitionUnavailableError("fixture acquisition unavailable");
      },
    }),
  });

  expect(failed.providerObservationOperation).toEqual({
    intent: "full-verification",
    outcome: "retained-after-failure",
    acquisitionCount: 0,
  });
  expect(failed.providerObservations).toEqual([prior]);
  expect(failed.providerObservationSelections[0]).toMatchObject({
    observationId: prior.id,
    effectiveFreshness: "undetermined",
    latestAttempt: {
      intent: "full-verification",
      attemptedAt: "2026-07-31T07:00:00.000Z",
      outcome: "failed",
    },
  });
  expect(failed.diagnostics).toContainEqual(
    expect.objectContaining({ code: "provider-observation-acquisition-failed" }),
  );
  await commitSyncPlan(failed);

  const ordinary = await prepareSync(root);
  expect(ordinary.providerObservationOperation).toMatchObject({
    intent: "ordinary-sync",
    outcome: "unavailable",
    acquisitionCount: 0,
  });
  expect(ordinary.providerObservationSelections).toEqual(failed.providerObservationSelections);
  expect(ordinary.fingerprint).toBe(failed.fingerprint);
});

test("a production missing-configuration result retains prior evidence as a failed attempt", async () => {
  const root = await createValidBearingRepo();
  const baselineCalls = { count: 0 };
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: factoryAt("2026-07-31T07:30:00.000Z", baselineCalls),
  });
  await commitSyncPlan(baseline);
  const prior = baseline.providerObservations[0];
  if (prior === undefined) throw new Error("Expected one baseline observation.");
  await unlink(join(root, ".bearing/provider.json"));

  const failed = await prepareSync(root, {
    providerObservationIntent: "full-verification",
    providerObservationNow: () => "2026-07-31T07:45:00.000Z",
  });

  expect(failed.providerObservationOperation).toEqual({
    intent: "full-verification",
    outcome: "retained-after-failure",
    acquisitionCount: 0,
  });
  expect(failed.providerObservations).toEqual([prior]);
  expect(failed.providerObservationSelections[0]).toMatchObject({
    observationId: prior.id,
    effectiveFreshness: "undetermined",
    latestAttempt: {
      intent: "full-verification",
      outcome: "failed",
    },
  });
  expect(failed.diagnostics).toContainEqual(
    expect.objectContaining({ code: "missing-provider-configuration" }),
  );
});

test("failed recovery without prior evidence preserves its latest attempt in the selection", async () => {
  const root = await createValidBearingRepo();
  await unlink(join(root, ".bearing/provider.json"));

  const failed = await prepareSync(root, {
    providerObservationIntent: "recovery",
    providerObservationNow: () => "2026-07-31T07:50:00.000Z",
  });

  expect(failed.providerObservationOperation).toEqual({
    intent: "recovery",
    outcome: "unavailable",
    acquisitionCount: 0,
  });
  expect(failed.providerObservations).toEqual([]);
  expect(failed.providerObservationSelections[0]).toMatchObject({
    observationId: null,
    effectiveFreshness: "undetermined",
    latestAttempt: {
      intent: "recovery",
      attemptedAt: "2026-07-31T07:50:00.000Z",
      outcome: "failed",
      diagnostics: [
        expect.objectContaining({ code: "missing-provider-configuration" }),
        expect.objectContaining({ code: "provider-observation-acquisition-incomplete" }),
      ],
    },
  });
});

test("ordinary Sync rejects tampered observation content without fallback acquisition", async () => {
  const root = await createValidBearingRepo();
  const baselineCalls = { count: 0 };
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: factoryAt("2026-07-31T08:00:00.000Z", baselineCalls),
  });
  await commitSyncPlan(baseline);
  const storePath = join(root, ".bearing/cache/provider-observations.json");
  const store = JSON.parse(await readFile(storePath, "utf8")) as {
    observations: { diagnostics: unknown[] }[];
  };
  const observation = store.observations[0];
  if (observation === undefined) throw new Error("Expected one persisted observation.");
  observation.diagnostics = [
    {
      code: "tampered",
      class: "identity",
      impact: "blocking",
      target: ".scratch/work",
      message: "Content changed without updating the immutable identity.",
    },
  ];
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  const ordinaryCalls = { count: 0 };
  const ordinary = await prepareSync(root, {
    providerFactory: factoryAt("2026-07-31T09:00:00.000Z", ordinaryCalls),
  });

  expect(ordinary.providerObservationOperation).toEqual({
    intent: "ordinary-sync",
    outcome: "unavailable",
    acquisitionCount: 0,
  });
  expect(ordinary.providerObservations).toEqual([]);
  expect(ordinary.diagnostics).toContainEqual(
    expect.objectContaining({ code: "provider-observation-store-unavailable" }),
  );
  expect(ordinaryCalls.count).toBe(0);
});

test("a failed latest attempt cannot remain current or trustworthy after store tampering", async () => {
  const root = await createValidBearingRepo();
  const calls = { count: 0 };
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: factoryAt("2026-07-31T08:30:00.000Z", calls),
  });
  await commitSyncPlan(baseline);
  const observation = baseline.providerObservations[0];
  const selection = baseline.providerObservationSelections[0];
  if (observation === undefined || selection === undefined) {
    throw new Error("Expected one selected baseline observation.");
  }
  const failedSelection = {
    ...selection,
    effectiveFreshness: "current" as const,
    latestAttempt: {
      intent: "full-verification" as const,
      attemptedAt: "2026-07-31T08:45:00.000Z",
      outcome: "failed" as const,
      diagnostics: [
        {
          code: "fixture-latest-attempt-failed",
          impact: "blocking" as const,
          target: ".scratch/work",
          message: "The latest provider attempt failed.",
        },
      ],
    },
  };
  expect(
    assessSelectedProviderObservationEvidence(observation, failedSelection).frontierEvidence,
  ).toBe("withheld");

  const storePath = join(root, ".bearing/cache/provider-observations.json");
  const store = JSON.parse(await readFile(storePath, "utf8")) as {
    selections: unknown[];
  };
  store.selections = [failedSelection];
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  const ordinaryCalls = { count: 0 };
  const ordinary = await prepareSync(root, {
    providerFactory: factoryAt("2026-07-31T09:00:00.000Z", ordinaryCalls),
  });

  expect(ordinary.providerObservationOperation).toEqual({
    intent: "ordinary-sync",
    outcome: "unavailable",
    acquisitionCount: 0,
  });
  expect(ordinary.providerObservations).toEqual([]);
  expect(ordinary.providerObservationSelections).toEqual([
    expect.objectContaining({
      observationId: null,
      effectiveFreshness: "undetermined",
      latestAttempt: null,
    }),
  ]);
  expect(ordinary.diagnostics).toContainEqual(
    expect.objectContaining({ code: "provider-observation-store-unavailable" }),
  );
  expect(ordinaryCalls.count).toBe(0);
});

test("ordinary Sync rejects a cross-scope observation selection without fallback acquisition", async () => {
  const root = await createValidBearingRepo();
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: factoryAt("2026-07-31T10:00:00.000Z", { count: 0 }),
  });
  await commitSyncPlan(baseline);
  const storePath = join(root, ".bearing/cache/provider-observations.json");
  const store = JSON.parse(await readFile(storePath, "utf8")) as {
    selections: { nativeScope: string }[];
  };
  const selection = store.selections[0];
  if (selection === undefined) throw new Error("Expected one persisted selection.");
  selection.nativeScope = ".scratch/other";
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  const calls = { count: 0 };

  const ordinary = await prepareSync(root, {
    providerFactory: factoryAt("2026-07-31T10:30:00.000Z", calls),
  });

  expect(calls.count).toBe(0);
  expect(ordinary.providerObservationOperation).toMatchObject({
    intent: "ordinary-sync",
    outcome: "unavailable",
    acquisitionCount: 0,
  });
  expect(ordinary.diagnostics).toContainEqual(
    expect.objectContaining({ code: "provider-observation-store-unavailable" }),
  );
});
