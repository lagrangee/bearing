import { expect, test } from "bun:test";
import { buildDecisionProjection } from "../src/project-snapshot/decisions";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { captureDecodedSourceInputs } from "./project-snapshot-fixture";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;

const projectReview = (overrides = "") => `---
Type: planning-review
ID: planning-review:balance
Title: Review balance
Status: pending
Question: Should the project rebalance the current work?
Scope: project
Inputs: []
Input fingerprint: ${FINGERPRINT}
${overrides}---

# Planning Review
`;

const project = async (review: string) => {
  const root = await createValidBearingRepo();
  await writeFixture(root, ".bearing/state/planning-reviews/balance.md", review);
  const sync = await runSync(root);
  const records = await captureDecodedSourceInputs({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
  return buildDecisionProjection({ records, sitemapFingerprint: sync.fingerprint });
};

test("projects one project-wide pending Review into Attention", async () => {
  const projected = await project(projectReview());

  expect(projected.reviews).toMatchObject({
    validity: "available",
    items: [
      {
        id: "planning-review:balance",
        question: "Should the project rebalance the current work?",
        scope: { kind: "project" },
        status: "pending",
      },
    ],
  });
  expect(projected.attention).toMatchObject([
    { kind: "planning-review", id: "planning-review:balance" },
  ]);
});

test("projects one exact-target Review through the same lifecycle", async () => {
  const review = projectReview().replace(
    "Scope: project",
    "Scope: exact-target\nTarget: effort:test",
  );
  const projected = await project(review);

  expect(projected.reviews).toMatchObject({
    validity: "available",
    items: [{ scope: { kind: "exact-target", target: "effort:test" } }],
  });
});

test("completed Review remains immutable history and leaves Attention", async () => {
  const completed = projectReview(
    `Resolution:\n  Accepted decision: Continue.\n  Accepted at: 2026-08-08T00:00:00.000Z\n  Rationale: The balance is accepted.\n  Changed references:\n    - effort:test\n`,
  ).replace("Status: pending", "Status: completed");
  const projected = await project(completed);

  expect(projected.reviews).toMatchObject({
    validity: "available",
    items: [
      {
        status: "completed",
        resolution: {
          acceptedDecision: "Continue.",
          acceptedAt: {
            availability: "available",
            precision: "fractional-second",
            value: "2026-08-08T00:00:00.000Z",
          },
        },
      },
    ],
  });
  expect(projected.attention).toEqual([]);
});

test("rejects removed Alignment Check records instead of projecting compatibility state", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/legacy.md",
    `---\nType: alignment-check\nID: alignment-check:legacy\nTitle: Legacy check\nStatus: open\nTarget: effort:test\nInputs: []\nInput fingerprint: ${FINGERPRINT}\n---\n`,
  );
  const sync = await runSync(root);
  const records = await captureDecodedSourceInputs({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
  const projected = buildDecisionProjection({ records, sitemapFingerprint: sync.fingerprint });

  expect(projected.reviews).toEqual({ validity: "available", items: [] });
  expect(projected.attention).toEqual([]);
  expect(records.some((record) => record.locator.includes("/alignment-checks/"))).toBe(false);
});
