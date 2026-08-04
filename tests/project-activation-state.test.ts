import { expect, test } from "bun:test";
import {
  interactionNeedsActivation,
  PROJECT_INACTIVITY_MS,
  visibilityReturnNeedsActivation,
} from "../src/portal-ui/project-activation-events";
import {
  type ActivationState,
  activationStateForEntry,
  projectActivationReducer,
  transitionForSyncResult,
} from "../src/portal-ui/project-activation-state";
import type { ProjectSyncEnvelope, ProjectView } from "../src/portal-ui/project-contract";
import { projectSyncEnvelopeSchema } from "../src/portal-ui/project-contract";

const view: ProjectView = {
  project: { entryId: "project-1", displayName: "Fixture", availability: "available" },
  cache: { snapshot: { state: "missing" }, receipt: null, retained: false },
  diagnosticCounts: null,
};
const validation = { due: false, cooldownRemainingMs: 30_000, inFlight: false };
const completed = (
  outcome: "checked" | "materialized" | "synced" | "applied" | "no-op",
): ProjectSyncEnvelope =>
  outcome === "applied" || outcome === "no-op"
    ? {
        version: 1,
        state: "completed",
        mode: "force",
        outcome,
        snapshotDisposition: "reused",
        view,
        validation,
      }
    : {
        version: 1,
        state: "completed",
        mode: "ensure-current",
        outcome,
        ...(outcome === "synced" ? { reconciliation: "applied" as const } : {}),
        snapshotDisposition: outcome === "materialized" ? "materialized" : "reused",
        view,
        validation,
      };

test("keeps cache visible while automatic validation is checking", () => {
  const state = projectActivationReducer(
    { kind: "settled", confirmation: "up-to-date", view },
    { type: "checking", view },
  );
  expect(state).toEqual({ kind: "checking", view });
});

test("maps checked and cooldown to truthful confirmations without animation states", () => {
  expect(transitionForSyncResult(completed("checked"))).toMatchObject({
    action: { type: "settled", confirmation: "up-to-date", view },
  });
  const cooldown: ProjectSyncEnvelope = {
    version: 1,
    state: "cooldown",
    mode: "ensure-current",
    outcome: "cooldown",
    view,
    validation,
  };
  expect(transitionForSyncResult(cooldown)).toMatchObject({
    action: { type: "settled", confirmation: "checked-recently", view },
  });
});

test("reports Snapshot refresh and real reconciliation before their confirmations", () => {
  expect(transitionForSyncResult(completed("materialized"))).toEqual({
    action: { type: "refreshing", view },
    confirmation: { value: "up-to-date", delayMs: 650 },
  });
  expect(transitionForSyncResult(completed("synced"))).toEqual({
    action: { type: "syncing", view },
    confirmation: { value: "updated", delayMs: 650 },
  });
  expect(transitionForSyncResult(completed("applied"))).toMatchObject({
    action: { type: "syncing", view },
    confirmation: { value: "updated" },
  });
});

test("reports a joined forced no-op as up to date without an Updated transition", () => {
  // Given: an ensure-current caller joined a force operation whose reconciliation changed no bytes.
  const joinedForce: ProjectSyncEnvelope = {
    version: 1,
    state: "completed",
    mode: "ensure-current",
    outcome: "synced",
    reconciliation: "no-op",
    snapshotDisposition: "reused",
    view,
    validation,
  };

  // When: the completed result is mapped to its activation transition.
  const transition = transitionForSyncResult(joinedForce);

  // Then: the UI confirms current truth without claiming an update occurred.
  expect(transition).toEqual({
    action: { type: "settled", confirmation: "up-to-date", view },
  });
});

test("retains trustworthy cache and exposes explicit Retry after failure", () => {
  const failed = projectSyncEnvelopeSchema.parse({
    version: 1,
    state: "failed",
    mode: "ensure-current",
    outcome: "failed",
    error: { code: "snapshot-write-failed", message: "Project cache could not be saved." },
    view: { ...view, cache: { ...view.cache, retained: true } },
    validation,
  });
  expect(transitionForSyncResult(failed)).toMatchObject({
    action: {
      type: "failed",
      operation: "check",
      view: { cache: { retained: true } },
    },
  });
});

test("retains the displayed GET cache when a typed failure omits its optional view", () => {
  // Given: Project Activation is checking after a trustworthy GET cache became visible.
  const current = { kind: "checking", view } as const;
  const failed = projectSyncEnvelopeSchema.parse({
    version: 1,
    state: "failed",
    mode: "ensure-current",
    outcome: "failed",
    error: { code: "snapshot-write-failed", message: "Project cache could not be saved." },
    validation,
  });
  if (failed.state !== "failed") throw new Error("Expected a failed response.");

  // When: the schema-valid Sync failure omits its optional replacement view.
  const transition = transitionForSyncResult(failed);
  const state = projectActivationReducer(current, transition.action);

  // Then: the already displayed trustworthy cache remains available for Retry recovery.
  expect(state).toEqual({
    kind: "failed",
    operation: "check",
    error: failed.error,
    view,
  });
});

test("adopts a typed failure replacement view when the response provides one", () => {
  // Given: the server returns a newer retained-cache view with its typed failure.
  const replacement = {
    ...view,
    project: { ...view.project, displayName: "Updated fixture" },
    cache: { ...view.cache, retained: true },
  };
  const failed: ProjectSyncEnvelope = {
    version: 1,
    state: "failed",
    mode: "ensure-current",
    outcome: "failed",
    error: { code: "snapshot-write-failed", message: "Project cache could not be saved." },
    view: replacement,
    validation,
  };

  // When: the failure transition replaces a previously displayed GET cache.
  const state = projectActivationReducer(
    { kind: "checking", view },
    transitionForSyncResult(failed).action,
  );

  // Then: the response view is adopted instead of the older cache.
  expect(state).toMatchObject({ kind: "failed", view: replacement });
});

test("replaces an old-root view with the latest cache-only view after relink", () => {
  const latestView: ProjectView = {
    ...view,
    project: { ...view.project, displayName: "Relinked fixture" },
    cache: {
      ...view.cache,
      snapshot: {
        state: "malformed",
        diagnostic: { code: "snapshot-malformed", message: "Latest cache is malformed." },
      },
    },
  };
  const failed = projectSyncEnvelopeSchema.parse({
    version: 1,
    state: "failed",
    mode: "ensure-current",
    outcome: "failed",
    error: { code: "input-validation-failed", message: "Project location changed." },
    view: latestView,
    validation,
  });

  const state = projectActivationReducer(
    { kind: "checking", view },
    transitionForSyncResult(failed).action,
  );

  expect(state).toMatchObject({
    kind: "failed",
    view: {
      project: { displayName: "Relinked fixture" },
      cache: { snapshot: { state: "malformed" } },
    },
  });
});

test("discards an old-root view only when a typed failure explicitly requires it", () => {
  const input = {
    version: 1,
    state: "failed",
    mode: "ensure-current",
    outcome: "failed",
    error: { code: "input-validation-failed", message: "Project location changed." },
    viewDisposition: "discard",
    validation,
  } as const;
  const parsed = projectSyncEnvelopeSchema.safeParse(input);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Expected a valid discard response.");

  const state = projectActivationReducer(
    { kind: "checking", view },
    transitionForSyncResult(parsed.data).action,
  );

  expect(state).toEqual({
    kind: "failed",
    operation: "check",
    error: input.error,
  });
  expect(
    projectSyncEnvelopeSchema.safeParse({ ...input, viewDisposition: "unknown" }).success,
  ).toBe(false);
  expect(projectSyncEnvelopeSchema.safeParse({ ...input, view }).success).toBe(false);
});

test("only the first interaction after prolonged inactivity activates validation", () => {
  expect(interactionNeedsActivation(1_000, 1_000 + PROJECT_INACTIVITY_MS - 1)).toBe(false);
  expect(interactionNeedsActivation(1_000, 1_000 + PROJECT_INACTIVITY_MS)).toBe(true);
  expect(
    interactionNeedsActivation(1_000 + PROJECT_INACTIVITY_MS, 1_001 + PROJECT_INACTIVITY_MS),
  ).toBe(false);
});

test("only a hidden-to-visible return after inactivity activates visibility validation", () => {
  const hiddenAt = 1_000;
  expect(
    visibilityReturnNeedsActivation(
      "hidden",
      "visible",
      hiddenAt,
      hiddenAt + PROJECT_INACTIVITY_MS,
    ),
  ).toBe(true);
  expect(
    visibilityReturnNeedsActivation(
      "hidden",
      "visible",
      hiddenAt,
      hiddenAt + PROJECT_INACTIVITY_MS - 1,
    ),
  ).toBe(false);
  expect(visibilityReturnNeedsActivation("visible", "visible", undefined, hiddenAt)).toBe(false);
  expect(visibilityReturnNeedsActivation("visible", "hidden", undefined, hiddenAt)).toBe(false);
  expect(visibilityReturnNeedsActivation("hidden", "hidden", hiddenAt, hiddenAt)).toBe(false);
});

test("entry switches hide stale pending, unavailable, and viewless failure state", () => {
  const staleStates: readonly ActivationState[] = [
    { kind: "checking" },
    { kind: "syncing" },
    {
      kind: "unavailable",
      project: { entryId: "project-1", displayName: "First", availability: "missing" },
      diagnostic: { code: "project-unavailable", message: "First project is unavailable." },
    },
    {
      kind: "failed",
      operation: "check",
      error: { code: "input-validation-failed", message: "First project check failed." },
    },
  ];

  for (const state of staleStates) {
    expect(activationStateForEntry(state, "project-1", "project-2")).toEqual({
      kind: "loading-cache",
    });
    expect(activationStateForEntry(state, "project-1", "project-1")).toBe(state);
  }
});
