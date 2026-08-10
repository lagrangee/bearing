import { expect, test } from "bun:test";
import {
  type ActivationState,
  activationStateForEntry,
  projectActivationReducer,
} from "../src/portal-ui/project-activation-state";
import type { ProjectView } from "../src/portal-ui/project-contract";
import { createProjectAuditFixture } from "./fixtures/project-audit";

const snapshot = createProjectAuditFixture();
const { basis: _basis, producer: _producer, schemaVersion: _schemaVersion, ...fields } = snapshot;
const view: ProjectView = {
  project: { entryId: "project-1", displayName: "Fixture", availability: "available" },
  data: { ...fields, section: "audit", attentionCount: fields.attention.length },
  diagnosticCounts: { blocking: 0, nonBlocking: 0, total: 0 },
};

test("keeps typed project data visible while a read is in progress", () => {
  const state = projectActivationReducer(
    { kind: "settled", confirmation: "checked-recently", view },
    { type: "checking", view },
  );
  expect(state).toEqual({ kind: "checking", view });
});

test("retains the current typed view when a read fails without a replacement", () => {
  const state = projectActivationReducer(
    { kind: "checking", view },
    {
      type: "failed",
      operation: "check",
      error: { code: "project-read-failed", message: "Project data could not be read." },
    },
  );
  expect(state).toMatchObject({ kind: "failed", view });
});

test("discards a typed view only when the failure says it is unsafe", () => {
  const state = projectActivationReducer(
    { kind: "checking", view },
    {
      type: "failed",
      operation: "check",
      error: { code: "project-read-failed", message: "Project data could not be read." },
      viewDisposition: "discard",
    },
  );
  expect(state).toEqual({
    kind: "failed",
    operation: "check",
    error: { code: "project-read-failed", message: "Project data could not be read." },
  });
});

test("entry switches hide stale activation state", () => {
  const states: readonly ActivationState[] = [
    { kind: "checking" },
    { kind: "settled", confirmation: "checked-recently", view },
    {
      kind: "unavailable",
      project: { entryId: "project-1", displayName: "First", availability: "missing" },
      diagnostic: { code: "project-unavailable", message: "First project is unavailable." },
    },
  ];
  for (const state of states) {
    expect(activationStateForEntry(state, "project-1", "project-2")).toEqual({
      kind: "loading-cache",
    });
    expect(activationStateForEntry(state, "project-1", "project-1")).toBe(state);
  }
});
