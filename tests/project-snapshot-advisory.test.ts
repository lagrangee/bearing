import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fingerprintFiles } from "../src/fingerprint";
import { buildAdvisoryProjection } from "../src/project-snapshot/advisory";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { captureDecodedSourceInputs } from "./project-snapshot-fixture";

const writeGuidance = async (root: string): Promise<void> => {
  const fingerprint = await fingerprintFiles(root, [".bearing/state/project-summary.md"]);
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    `---
Type: next-work-guidance
ID: next-work-guidance:current
Generated at: 2026-07-13T20:00:00+0800
Inputs:
  - .bearing/state/project-summary.md
Input fingerprint: ${fingerprint.fingerprint}
Semantic coverage: absent
---

# Guidance

## Primary Recommendation

### Build the Snapshot seam

Expose one trusted semantic cache.

#### Supporting References

- \`gate:test\`

## Alternatives

### Inspect the Roadmap

Confirm the current horizon.

#### Supporting References

- \`roadmap:test\`

### Run an Audit later

Review the whole project after the seam is ready.

#### Supporting References

- \`.scratch/work/map.md\`
`,
  );
};

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
  return {
    sync,
    projected: buildAdvisoryProjection({
      records,
      sitemapFingerprint: sync.fingerprint,
      advisoryFreshness: sync.advisoryFreshness,
      checks: { validity: "available", items: [] },
      reviews: { validity: "available", items: [] },
    }),
  };
};

test("projects exact Guidance items with Sync-owned freshness", async () => {
  const root = await createValidBearingRepo();
  await writeGuidance(root);
  const { projected } = await project(root);
  expect(projected.audit).toEqual({ validity: "absent" });
  expect(projected.guidance).toMatchObject({
    validity: "available",
    value: {
      semanticFreshness: "current",
      primary: { title: "Build the Snapshot seam", supportingReferences: ["gate:test"] },
      alternatives: [{ title: "Inspect the Roadmap" }, { title: "Run an Audit later" }],
    },
  });
  expect(projected.sources).toHaveLength(4);

  await writeFixture(root, ".bearing/state/project-summary.md", "changed after Guidance\n");
  const stale = await project(root);
  expect(stale.projected.guidance).toMatchObject({
    validity: "available",
    value: { semanticFreshness: "stale" },
  });
});

test("projects Guidance with zero or one meaningful Alternative", async () => {
  const root = await createValidBearingRepo();
  await writeGuidance(root);
  const path = join(root, ".bearing/state/next-work-guidance.md");
  const guidance = await readFile(path, "utf8");
  const secondAlternative = `
### Run an Audit later

Review the whole project after the seam is ready.

#### Supporting References

- \`.scratch/work/map.md\`
`;

  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    guidance.replace(secondAlternative, ""),
  );
  const oneAlternative = await project(root);
  expect(oneAlternative.projected.guidance).toMatchObject({
    validity: "available",
    value: { alternatives: [{ title: "Inspect the Roadmap" }] },
  });
  expect(oneAlternative.projected.sources).toHaveLength(3);

  const firstAlternative = `
### Inspect the Roadmap

Confirm the current horizon.

#### Supporting References

- \`roadmap:test\`
`;
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    guidance.replace(firstAlternative, "").replace(secondAlternative, ""),
  );
  const zeroAlternatives = await project(root);
  expect(zeroAlternatives.projected.guidance).toMatchObject({
    validity: "available",
    value: { alternatives: [] },
  });
  expect(zeroAlternatives.projected.sources).toHaveLength(2);
});

test("keeps Audit and malformed Guidance validity independent", async () => {
  const root = await createValidBearingRepo();
  const fingerprint = `sha256:${"a".repeat(64)}`;
  await writeFixture(
    root,
    ".bearing/state/planning-audit.md",
    `---
Type: planning-audit
ID: planning-audit:current
Generated at: 2026-07-13T20:00:00+0800
Inputs: []
Input fingerprint: ${fingerprint}
Coverage: complete
Skipped targets: []
---

# Planning Audit

## Findings

No material findings.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    `---
Type: next-work-guidance
ID: next-work-guidance:current
Generated at: 2026-07-13T20:01:00+0800
Inputs: []
Input fingerprint: ${fingerprint}
Semantic coverage: absent
---

# Legacy prose only
`,
  );
  const { projected } = await project(root);
  expect(projected.audit).toMatchObject({ validity: "available", value: { findings: [] } });
  expect(projected.guidance.validity).toBe("invalid");
});

test("isolates Guidance when multiline rationale forms formatting syntax", async () => {
  // Given: the structural Guidance shape hides emphasis delimiters across authored lines.
  const root = await createValidBearingRepo();
  await writeGuidance(root);
  const path = join(root, ".bearing/state/next-work-guidance.md");
  const guidance = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    guidance.replace(
      "Expose one trusted semantic cache.",
      "Expose **one trusted\nsemantic cache**.",
    ),
  );

  // When: the advisory crosses the normalized projection boundary.
  const { projected } = await project(root);

  // Then: Guidance is scoped invalid and the independent Audit remains absent.
  expect(projected.guidance).toMatchObject({
    validity: "invalid",
    issues: [{ code: "invalid-next-work-body" }],
  });
  expect(projected.audit).toEqual({ validity: "absent" });
});

test("isolates an Audit with a traversing skipped target", async () => {
  // Given: an otherwise-valid Audit carries one unsafe normalized planning reference.
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

  // When: the advisory crosses the normalized projection boundary.
  const { projected } = await project(root);

  // Then: the Audit is scoped invalid and independent Guidance remains absent.
  expect(projected.audit).toMatchObject({
    validity: "invalid",
    issues: [{ code: "invalid-bearing-schema" }],
  });
  expect(projected.guidance).toEqual({ validity: "absent" });
});

test("isolates Guidance with a traversing supporting reference", async () => {
  // Given: exact Guidance structure contains one reference outside the planning boundary.
  const root = await createValidBearingRepo();
  await writeGuidance(root);
  const path = join(root, ".bearing/state/next-work-guidance.md");
  const guidance = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    guidance.replace("- `gate:test`", "- `../outside.md`"),
  );

  // When: the advisory crosses the normalized projection boundary.
  const { projected } = await project(root);

  // Then: Guidance is scoped invalid and independent Audit remains absent.
  expect(projected.guidance).toMatchObject({
    validity: "invalid",
    issues: [{ code: "invalid-next-work-body" }],
  });
  expect(projected.audit).toEqual({ validity: "absent" });
});

test("isolates Guidance with a blank generated timestamp", async () => {
  // Given: Guidance body is exact but its structural timestamp is blank.
  const root = await createValidBearingRepo();
  await writeGuidance(root);
  const path = join(root, ".bearing/state/next-work-guidance.md");
  const guidance = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    guidance.replace("Generated at: 2026-07-13T20:00:00+0800", 'Generated at: " "'),
  );

  // When: the advisory crosses its owning singleton boundary.
  const { projected } = await project(root);

  // Then: Guidance is scoped invalid rather than failing the whole Snapshot.
  expect(projected.guidance).toMatchObject({
    validity: "invalid",
    issues: [{ code: "invalid-bearing-schema" }],
  });
  expect(projected.audit).toEqual({ validity: "absent" });
});
