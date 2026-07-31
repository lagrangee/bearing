import { expect, test } from "bun:test";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

const materialize = async (root: string) => {
  const sync = await runSync(root);
  return buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
};

const authority = (id: string, citationNote: string, body: string): string => `---
Type: authority
ID: ${id}
Title: ${id}
Baseline:
  - asset:design
Citations:
  - Asset: asset:design
    Note: ${citationNote}
---

# Authority

${body}
`;

test("builds Asset reverse relations without substituting baseline membership for Adoption", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(root, "evidence/design.md", "accepted design\n");
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:design
    Title: Design baseline
    Kind: design
    Location: evidence/design.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: registry
    Disposition: available
---

# Assets
`,
  );
  await writeFixture(
    root,
    ".bearing/state/authorities/trusted.md",
    authority(
      "authority:trusted",
      "Trusted authority citation.",
      `## Scope

Project design.

## Current Baseline

The registered design.`,
    ),
  );
  await writeFixture(
    root,
    ".bearing/state/authorities/isolated.md",
    authority(
      "authority:isolated",
      "Isolated authority citation.",
      `## Current Baseline

This body omits the required Scope section.`,
    ),
  );

  const snapshot = await materialize(root);

  expect(snapshot.authorities).toMatchObject({
    validity: "partial",
    items: [{ id: "authority:trusted" }],
  });
  if (snapshot.authorities.validity === "invalid") {
    throw new Error("Expected the trustworthy Authority member.");
  }
  const authoritySource = snapshot.authorities.items[0]?.source;
  if (authoritySource === undefined) throw new Error("Expected the Authority Source Reference.");
  expect(snapshot.assets).toMatchObject({
    validity: "available",
    items: [
      {
        id: "asset:design",
        citations: [
          {
            assetId: "asset:design",
            note: "Trusted authority citation.",
            citingReference: "authority:trusted",
            source: authoritySource,
          },
        ],
        citationCount: 1,
        adoptedByAuthorityIds: [],
        gatePassageEvidenceFor: [],
      },
    ],
  });
});

test("excludes Citation and Passage caches from an isolated Gate", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(root, "evidence/gate.md", "gate evidence\n");
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:gate
    Title: Gate evidence
    Kind: verification-report
    Location: evidence/gate.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Assets
`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    `---
Type: milestone-gate
ID: gate:test
Title: Test Gate
Roadmap: roadmap:test
Status: active
Effort order:
  - effort:test
Citations:
  - Asset: asset:gate
    Note: Isolated Gate citation.
Passage:
  Accepted decision: Keep the evidence attached.
  Rationale: It demonstrates the relation.
  Evidence:
    - asset:gate
  Exceptions: []
---

# Gate

## Exit Criteria

- Resolve the fixture.
`,
  );

  const snapshot = await materialize(root);

  expect(snapshot.gates.validity).toBe("invalid");
  expect(snapshot.assets).toMatchObject({
    validity: "available",
    items: [
      {
        id: "asset:gate",
        citations: [],
        citationCount: 0,
        adoptedByAuthorityIds: [],
        gatePassageEvidenceFor: [],
      },
    ],
  });
});
