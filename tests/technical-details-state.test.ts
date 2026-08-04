import { expect, test } from "bun:test";
import type { TechnicalDetailsSelection } from "../src/portal-ui/technical-details";
import {
  captureTechnicalDetailsSelection,
  currentTechnicalDetailsSelection,
} from "../src/portal-ui/technical-details-state";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const selection: TechnicalDetailsSelection = {
  title: "Model ready",
  facts: [{ label: "Lifecycle", value: "active" }],
  sections: [],
};

test("fails closed when Technical Details outlives its route or Snapshot view", () => {
  const snapshot = createProjectOverviewFixture();
  const context = {
    entryId: "bearing",
    section: "roadmaps" as const,
    snapshotFingerprint: snapshot.basis.sitemapFingerprint,
  };
  const captured = captureTechnicalDetailsSelection(selection, context);

  expect(currentTechnicalDetailsSelection(captured, context)).toBe(selection);
  expect(
    currentTechnicalDetailsSelection(captured, { ...context, routeIdentity: "roadmap:second" }),
  ).toBeNull();
  expect(
    currentTechnicalDetailsSelection(captured, { ...context, section: "overview" }),
  ).toBeNull();
  expect(
    currentTechnicalDetailsSelection(captured, {
      ...context,
      snapshotFingerprint: `sha256:${"f".repeat(64)}`,
    }),
  ).toBeNull();
  expect(
    currentTechnicalDetailsSelection(captured, { ...context, entryId: "other-project" }),
  ).toBeNull();
});
