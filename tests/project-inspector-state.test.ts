import { expect, test } from "bun:test";
import type { ProjectInspectorSelection } from "../src/portal-ui/project-inspector";
import {
  captureProjectInspectorSelection,
  currentProjectInspectorSelection,
} from "../src/portal-ui/project-inspector-state";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const selection: ProjectInspectorSelection = {
  eyebrow: "Milestone Gate",
  title: "Model ready",
  detail: "Current Snapshot detail.",
};

test("fails closed when a project inspector outlives its route or Snapshot view", () => {
  const snapshot = createProjectOverviewFixture();
  const context = {
    entryId: "bearing",
    section: "roadmaps" as const,
    snapshotFingerprint: snapshot.basis.sitemapFingerprint,
  };
  const captured = captureProjectInspectorSelection(selection, context);

  expect(currentProjectInspectorSelection(captured, context)).toBe(selection);
  expect(
    currentProjectInspectorSelection(captured, {
      ...context,
      routeIdentity: "roadmap:second",
    }),
  ).toBeNull();
  expect(
    currentProjectInspectorSelection(captured, {
      ...context,
      section: "overview",
    }),
  ).toBeNull();
  expect(
    currentProjectInspectorSelection(captured, {
      ...context,
      snapshotFingerprint: `sha256:${"f".repeat(64)}`,
    }),
  ).toBeNull();
  expect(
    currentProjectInspectorSelection(captured, {
      ...context,
      entryId: "other-project",
    }),
  ).toBeNull();
});
