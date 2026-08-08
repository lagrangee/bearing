import { expect, test } from "bun:test";
import { buildAdvisoryProjection } from "../src/project-snapshot/advisory";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { captureDecodedSourceInputs } from "./project-snapshot-fixture";

const project = async (root: string) => {
  const sync = await runSync(root);
  const records = await captureDecodedSourceInputs({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
  return buildAdvisoryProjection({
    records,
    sitemapFingerprint: sync.fingerprint,
    advisoryFreshness: sync.advisoryFreshness,
    reviews: { validity: "available", items: [] },
  });
};

test("keeps Next Work generation outside the Portal advisory read model", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    `---
Type: next-work-guidance
ID: next-work-guidance:current
Generated at: 2026-07-13T20:00:00+0800
Inputs: []
Input fingerprint: sha256:${"a".repeat(64)}
Semantic coverage: absent
---

# Guidance

## Primary Recommendation

### Continue

Continue current work.

#### Supporting References

- \`gate:test\`

## Alternatives
`,
  );

  const projected = await project(root);

  expect(projected).toEqual({ audit: { validity: "absent" }, sources: [] });
  expect("guidance" in projected).toBe(false);
});

test("keeps malformed Audit scoped to the Audit projection", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/planning-audit.md",
    `---
Type: planning-audit
ID: planning-audit:current
Generated at: 2026-07-13T20:00:00+0800
Inputs: []
Input fingerprint: sha256:${"a".repeat(64)}
Coverage: incomplete
Skipped targets:
  - ../outside.md
---

# Audit
`,
  );

  expect((await project(root)).audit).toMatchObject({
    validity: "invalid",
    issues: [{ code: "invalid-bearing-schema" }],
  });
});
