import { expect, test } from "bun:test";
import { findPlanningLineageSubjectProjection } from "../src/project-snapshot/planning-lineage";
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

const authority = (
  id: string,
  citationNote: string,
  body: string,
  adoptionDecision?: string,
): string => `---
Type: authority
ID: ${id}
Title: ${id}
Baseline:
  - asset:design
${
  adoptionDecision === undefined
    ? ""
    : `Adoptions:
  - Asset: asset:design
    Decision: ${adoptionDecision}
`
}
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
      "planning-review:adopt-isolated",
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
  const trustedSource = snapshot.authorities.items[0]?.source;
  const isolatedSource = snapshot.sources.find(
    (source) => source.binding?.identity === "authority:isolated",
  )?.reference;
  if (trustedSource === undefined || isolatedSource === undefined) {
    throw new Error("Expected both Authority Source References.");
  }
  expect(snapshot.assets).toMatchObject({
    validity: "available",
    items: [
      {
        id: "asset:design",
        citations: [
          {
            assetId: "asset:design",
            note: "Isolated authority citation.",
            citingReference: "authority:isolated",
            source: isolatedSource,
          },
          {
            assetId: "asset:design",
            note: "Trusted authority citation.",
            citingReference: "authority:trusted",
            source: trustedSource,
          },
        ],
        evidenceRoles: ["planning-citation", "authority-adoption"],
        authorityAdoptions: [
          {
            authorityId: "authority:isolated",
            decisionReference: "planning-review:adopt-isolated",
            source: isolatedSource,
          },
        ],
        passageEvidence: [],
      },
    ],
  });
  const assetLineage = findPlanningLineageSubjectProjection(snapshot.lineage, {
    kind: "asset",
    id: "asset:design",
  });
  expect(
    assetLineage?.relations.find((relation) => relation.key === "adoption.used-by"),
  ).toMatchObject({
    state: "present",
    targets: [
      {
        reference: "authority:isolated",
        availability: "unavailable",
        note: expect.stringContaining("Referenced subject unavailable"),
      },
    ],
  });
});

test("retains direct Citation and Passage evidence when its Gate projection is isolated", async () => {
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
  const gateSource = snapshot.sources.find(
    (source) => source.binding?.identity === "gate:test",
  )?.reference;
  if (gateSource === undefined) throw new Error("Expected the isolated Gate Source Reference.");
  expect(snapshot.assets).toMatchObject({
    validity: "available",
    items: [
      {
        id: "asset:gate",
        citations: [
          {
            assetId: "asset:gate",
            note: "Isolated Gate citation.",
            citingReference: "gate:test",
            source: gateSource,
          },
        ],
        evidenceRoles: ["planning-citation", "passage-evidence"],
        authorityAdoptions: [],
        passageEvidence: [{ gateId: "gate:test", source: gateSource }],
      },
    ],
  });
  const assetLineage = findPlanningLineageSubjectProjection(snapshot.lineage, {
    kind: "asset",
    id: "asset:gate",
  });
  for (const key of ["planning-use.cited-by", "passage.used-by"] as const) {
    expect(assetLineage?.relations.find((relation) => relation.key === key)).toMatchObject({
      state: "present",
      targets: [
        {
          reference: "gate:test",
          availability: "unavailable",
          note: expect.stringContaining("Referenced subject unavailable"),
        },
      ],
    });
  }
});
