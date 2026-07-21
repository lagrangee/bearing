import { expect, test } from "bun:test";
import type { ProjectView } from "../src/portal/project-contract";
import { projectLocationChangedFailure } from "../src/portal/project-location-change";

const entry = { entryId: "project-1", displayName: "Fixture", repoRoot: "/internal/repo" };
const view: ProjectView = {
  project: { entryId: "project-1", displayName: "Fixture", availability: "available" },
  cache: {
    snapshot: {
      state: "malformed",
      diagnostic: { code: "snapshot-malformed", message: "Latest cache is malformed." },
    },
    receipt: null,
    retained: false,
  },
  diagnosticCounts: null,
};

test("replaces stale identity with the latest cache-only view after a location change", async () => {
  expect(await projectLocationChangedFailure(entry, async () => view)).toEqual({
    error: {
      code: "input-validation-failed",
      message:
        "The registered project location changed while this operation was in flight. Retry against the current repository.",
    },
    view,
  });
});

test("requires stale views to be discarded when the latest cache cannot be read", async () => {
  expect(
    await projectLocationChangedFailure(entry, async () => {
      throw new Error("cache read failed");
    }),
  ).toMatchObject({
    error: { code: "input-validation-failed" },
    viewDisposition: "discard",
  });
});
