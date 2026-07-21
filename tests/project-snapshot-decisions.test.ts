import { expect, test } from "bun:test";
import { buildDecisionProjection } from "../src/project-snapshot/decisions";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { captureDecodedSourceInputs } from "./project-snapshot-fixture";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;

test("projects open Checks and pending Reviews into typed Attention", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/design.md",
    `---
Type: alignment-check
ID: alignment-check:design
Title: Confirm design
Status: open
Target: effort:test
Inputs: []
Input fingerprint: ${FINGERPRINT}
---

# Alignment Check
`,
  );
  await writeFixture(
    root,
    ".bearing/state/planning-reviews/balance.md",
    `---
Type: planning-review
ID: planning-review:balance
Title: Review balance
Status: pending
Scope: project
Inputs: []
Input fingerprint: ${FINGERPRINT}
---

# Planning Review
`,
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
  expect(projected.checks).toMatchObject({
    validity: "available",
    items: [{ id: "alignment-check:design", status: "open", target: "effort:test" }],
  });
  expect(projected.reviews).toMatchObject({
    validity: "available",
    items: [{ id: "planning-review:balance", status: "pending", scope: "project" }],
  });
  expect(projected.attention.map((item) => item.kind)).toEqual([
    "alignment-check",
    "planning-review",
  ]);
});

test("completed decisions remain readable without occupying Attention", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/planning-reviews/done.md",
    `---
Type: planning-review
ID: planning-review:done
Title: Completed review
Status: completed
Scope: project
Inputs: []
Input fingerprint: ${FINGERPRINT}
Resolution:
  Accepted decision: Continue.
  Rationale: The balance is accepted.
  Changed references: []
---

# Planning Review
`,
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
  expect(projected.reviews).toMatchObject({
    validity: "available",
    items: [{ status: "completed", resolution: { acceptedDecision: "Continue." } }],
  });
  expect(projected.attention).toEqual([]);
});

test("isolates a formatted Check without hiding an independent pending Review", async () => {
  // Given: one open Check has a formatted title and one pending Review is trustworthy.
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/formatted.md",
    `---
Type: alignment-check
ID: alignment-check:formatted
Title: "**Confirm alignment**"
Status: open
Target: effort:test
Inputs: []
Input fingerprint: ${FINGERPRINT}
---

# Alignment Check
`,
  );
  await writeFixture(
    root,
    ".bearing/state/planning-reviews/trustworthy.md",
    `---
Type: planning-review
ID: planning-review:trustworthy
Title: Review sequence
Status: pending
Scope: Entire project
Inputs: []
Input fingerprint: ${FINGERPRINT}
---

# Planning Review
`,
  );

  // When: decisions are projected into their scoped collections and Attention.
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

  // Then: the Check is invalid, the Review remains available, and only it reaches Attention.
  expect(projected.checks.validity).toBe("invalid");
  expect(projected.reviews.validity).toBe("available");
  expect(projected.attention).toMatchObject([
    { kind: "planning-review", id: "planning-review:trustworthy" },
  ]);
});

test("isolates structurally invalid Check and Review references per record", async () => {
  // Given: each collection has one healthy decision and one invalid projected reference.
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/healthy.md",
    `---
Type: alignment-check
ID: alignment-check:healthy
Title: Confirm healthy alignment
Status: open
Target: effort:test
Inputs: []
Input fingerprint: ${FINGERPRINT}
---

# Alignment Check
`,
  );
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/outside.md",
    `---
Type: alignment-check
ID: alignment-check:outside
Title: Confirm outside alignment
Status: open
Target: ../outside.md
Inputs: []
Input fingerprint: ${FINGERPRINT}
---

# Alignment Check
`,
  );
  await writeFixture(
    root,
    ".bearing/state/planning-reviews/healthy.md",
    `---
Type: planning-review
ID: planning-review:healthy
Title: Review healthy sequence
Status: pending
Scope: Entire project
Inputs: []
Input fingerprint: ${FINGERPRINT}
---

# Planning Review
`,
  );
  await writeFixture(
    root,
    ".bearing/state/planning-reviews/outside.md",
    `---
Type: planning-review
ID: planning-review:outside
Title: Review outside change
Status: completed
Scope: Entire project
Inputs: []
Input fingerprint: ${FINGERPRINT}
Resolution:
  Accepted decision: Keep the project boundary.
  Rationale: The outside reference is not trustworthy.
  Changed references:
    - ../outside.md
---

# Planning Review
`,
  );

  // When: the records cross their collection projection boundaries.
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

  // Then: each collection remains partial and only trustworthy open decisions reach Attention.
  expect(projected.checks).toMatchObject({
    validity: "partial",
    items: [{ id: "alignment-check:healthy" }],
    issues: [{ code: "invalid-bearing-schema" }],
  });
  expect(projected.reviews).toMatchObject({
    validity: "partial",
    items: [{ id: "planning-review:healthy" }],
    issues: [{ code: "invalid-bearing-schema" }],
  });
  expect(projected.attention).toMatchObject([
    { kind: "alignment-check", id: "alignment-check:healthy" },
    { kind: "planning-review", id: "planning-review:healthy" },
  ]);
});
