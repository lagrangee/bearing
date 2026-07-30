import { expect, test } from "bun:test";
import type { AssetProjection, ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceReference } from "../src/project-snapshot/source-reference";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { withRebuiltPlanningLineage } from "./planning-lineage-fixture";

const BASIS = `sha256:${"b".repeat(64)}`;
const relationIssue = {
  code: "isolated-relation-source",
  target: ".bearing/state/isolated.md",
  message: "One relation source is isolated.",
};

const onlyAsset = (snapshot: ProjectSnapshot): AssetProjection => {
  if (snapshot.assets.validity === "invalid") throw new Error("Expected a trustworthy Asset.");
  const asset = snapshot.assets.items[0];
  if (asset === undefined) throw new Error("Expected one Asset.");
  return asset;
};

const replaceOnlyAsset = (
  snapshot: ProjectSnapshot,
  patch: Readonly<Record<string, unknown>>,
): unknown => ({
  ...snapshot,
  assets: { validity: "available", items: [{ ...onlyAsset(snapshot), ...patch }] },
});

const authorityFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.reviews.validity === "invalid") throw new Error("Expected Reviews.");
  const authoritySource = createSourceReference({
    basisFingerprint: BASIS,
    kind: "canonical",
    displayLocator: ".bearing/state/authorities/design.md",
    binding: { role: "authority", identity: "authority:design" },
  });
  const reviewSource = createSourceReference({
    basisFingerprint: BASIS,
    kind: "canonical",
    displayLocator: ".bearing/state/planning-reviews/adopt-design.md",
    binding: { role: "planning-review", identity: "planning-review:adopt-design" },
  });
  return projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      authorities: {
        validity: "available",
        items: [
          {
            id: "authority:design",
            title: "Product Design",
            source: authoritySource,
            citations: [],
            scope: "Govern the accepted Portal direction.",
            baselineAssetIds: ["asset:planning-model-evidence"],
            adoptions: [
              {
                assetId: "asset:planning-model-evidence",
                decisionReference: "planning-review:adopt-design",
              },
            ],
          },
        ],
      },
      reviews: {
        ...snapshot.reviews,
        items: [
          ...snapshot.reviews.items,
          {
            id: "planning-review:adopt-design",
            title: "Adopt design",
            source: reviewSource,
            citations: [],
            status: "completed",
            scope: "Adopt the design baseline.",
            resolution: {
              acceptedDecision: "Adopt the design.",
              acceptedAt: { availability: "unavailable" },
              rationale: "The design governs the baseline.",
              changedReferences: ["authority:design"],
            },
          },
        ],
      },
      assets: {
        validity: "available",
        items: [{ ...onlyAsset(snapshot), adoptedByAuthorityIds: ["authority:design"] }],
      },
      sources: [
        ...snapshot.sources,
        {
          reference: authoritySource,
          kind: "canonical",
          displayLocator: ".bearing/state/authorities/design.md",
          binding: { role: "authority", identity: "authority:design" },
        },
        {
          reference: reviewSource,
          kind: "canonical",
          displayLocator: ".bearing/state/planning-reviews/adopt-design.md",
          binding: {
            role: "planning-review",
            identity: "planning-review:adopt-design",
          },
        },
      ],
    }),
  );
};

const twoAuthorityFixture = (): ProjectSnapshot => {
  const snapshot = authorityFixture();
  if (snapshot.authorities.validity === "invalid") {
    throw new Error("Expected trustworthy Authorities.");
  }
  const designAuthority = snapshot.authorities.items[0];
  if (designAuthority === undefined) throw new Error("Expected one Authority.");
  const architectureSource = createSourceReference({
    basisFingerprint: BASIS,
    kind: "canonical",
    displayLocator: ".bearing/state/authorities/architecture.md",
    binding: { role: "authority", identity: "authority:architecture" },
  });
  return projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      authorities: {
        validity: "available",
        items: [
          designAuthority,
          {
            ...designAuthority,
            id: "authority:architecture",
            title: "Architecture",
            source: architectureSource,
          },
        ],
      },
      assets: {
        validity: "available",
        items: [
          {
            ...onlyAsset(snapshot),
            adoptedByAuthorityIds: ["authority:design", "authority:architecture"],
          },
        ],
      },
      sources: [
        ...snapshot.sources,
        {
          reference: architectureSource,
          kind: "canonical",
          displayLocator: ".bearing/state/authorities/architecture.md",
          binding: { role: "authority", identity: "authority:architecture" },
        },
      ],
    }),
  );
};

test("accepts exact Citation, Authority adoption, and Gate Passage Asset relations", () => {
  expect(projectSnapshotSchema.safeParse(createProjectOverviewFixture()).success).toBe(true);
  expect(projectSnapshotSchema.safeParse(authorityFixture()).success).toBe(true);
});

test("rejects complete Assets when a Citation or Passage reference no longer resolves", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.gates.validity === "invalid" || snapshot.efforts.validity === "invalid") {
    throw new Error("Expected trustworthy Gate and Effort projections.");
  }
  const citationOnly = {
    ...snapshot,
    gates: {
      validity: "available",
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:one" && gate.passage !== undefined
          ? { ...gate, passage: { ...gate.passage, evidenceAssetIds: [] } }
          : gate,
      ),
    },
    assets: { validity: "available", items: [] },
  };
  const passageOnly = {
    ...snapshot,
    efforts: {
      validity: "available",
      items: snapshot.efforts.items.map((effort) => ({ ...effort, citations: [] })),
    },
    assets: { validity: "available", items: [] },
  };
  for (const variant of [citationOnly, passageOnly]) {
    expect(projectSnapshotSchema.safeParse(variant).success).toBe(false);
  }
  expect(
    projectSnapshotSchema.safeParse({
      ...snapshot,
      assets: { validity: "available", items: [] },
    }).success,
  ).toBe(false);
});

test("rejects forged Asset Citation reverse caches and counts", () => {
  const snapshot = createProjectOverviewFixture();
  const asset = onlyAsset(snapshot);
  const citation = asset.citations[0];
  if (citation === undefined || snapshot.efforts.validity === "invalid") {
    throw new Error("Expected one reverse Citation and trustworthy Efforts.");
  }
  const otherEffort = snapshot.efforts.items.find((effort) => effort.id === "effort:portal");
  if (otherEffort === undefined) throw new Error("Expected the other Effort Source Reference.");
  const variants = [
    replaceOnlyAsset(snapshot, { citations: [], citationCount: 0 }),
    replaceOnlyAsset(snapshot, {
      citations: [{ ...citation, note: "Forged citation note." }],
      citationCount: 1,
    }),
    replaceOnlyAsset(snapshot, { citationCount: 0 }),
    replaceOnlyAsset(snapshot, {
      citations: [{ ...citation, assetId: "asset:forged" }],
      citationCount: 1,
    }),
    replaceOnlyAsset(snapshot, {
      citations: [{ ...citation, citingReference: "effort:portal" }],
      citationCount: 1,
    }),
    replaceOnlyAsset(snapshot, {
      citations: [{ ...citation, source: otherEffort.source }],
      citationCount: 1,
    }),
  ];
  for (const variant of variants) {
    expect(projectSnapshotSchema.safeParse(variant).success).toBe(false);
  }
});

test("rejects missing or forged Asset Gate Passage reverse relations", () => {
  const snapshot = createProjectOverviewFixture();
  for (const gatePassageEvidenceFor of [[], ["gate:two"]]) {
    expect(
      projectSnapshotSchema.safeParse(replaceOnlyAsset(snapshot, { gatePassageEvidenceFor }))
        .success,
    ).toBe(false);
  }
});

test("requires superseded Assets to resolve their replacement in a complete Asset collection", () => {
  const snapshot = createProjectOverviewFixture();
  const replacementSource = createSourceReference({
    basisFingerprint: BASIS,
    kind: "asset",
    displayLocator: ".bearing/state/assets.md",
    fragment: "asset:replacement",
    binding: { role: "asset", identity: "asset:replacement" },
  });
  const historical = {
    ...onlyAsset(snapshot),
    lifecycleSource: "registry" as const,
    disposition: "superseded" as const,
    supersededBy: "asset:replacement",
    supersededAt: { availability: "unavailable" as const },
  };
  const replacement = {
    ...onlyAsset(snapshot),
    id: "asset:replacement",
    title: "Replacement evidence",
    source: replacementSource,
    citations: [],
    adoptedByAuthorityIds: [],
    gatePassageEvidenceFor: [],
    citationCount: 0,
  };
  const sources = [
    ...snapshot.sources,
    {
      reference: replacementSource,
      kind: "asset" as const,
      displayLocator: ".bearing/state/assets.md",
      fragment: "asset:replacement",
      binding: { role: "asset" as const, identity: "asset:replacement" },
    },
  ];

  expect(
    projectSnapshotSchema.safeParse(
      withRebuiltPlanningLineage({
        ...snapshot,
        assets: { validity: "available", items: [historical, replacement] },
        sources,
      }),
    ).success,
  ).toBe(true);
  expect(
    projectSnapshotSchema.safeParse({
      ...snapshot,
      assets: { validity: "available", items: [historical] },
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...snapshot,
      assets: {
        validity: "available",
        items: [
          historical,
          {
            ...replacement,
            lifecycleSource: "registry",
            disposition: "superseded",
            supersededBy: historical.id,
            supersededAt: { availability: "unavailable" },
          },
        ],
      },
      sources,
    }).success,
  ).toBe(false);
});

test("rejects missing, forged, or unresolved Authority adoption relations", () => {
  const snapshot = authorityFixture();
  if (snapshot.authorities.validity === "invalid") {
    throw new Error("Expected a trustworthy Authority.");
  }
  const authority = snapshot.authorities.items[0];
  if (authority === undefined) throw new Error("Expected one Authority.");
  const reverseVariants = [[], ["authority:missing"]];
  for (const adoptedByAuthorityIds of reverseVariants) {
    expect(
      projectSnapshotSchema.safeParse(replaceOnlyAsset(snapshot, { adoptedByAuthorityIds }))
        .success,
    ).toBe(false);
  }
  expect(
    projectSnapshotSchema.safeParse({
      ...snapshot,
      authorities: {
        validity: "available",
        items: [
          {
            ...authority,
            baselineAssetIds: ["asset:missing"],
            adoptions: [],
          },
        ],
      },
      assets: {
        validity: "available",
        items: [{ ...onlyAsset(snapshot), adoptedByAuthorityIds: [] }],
      },
    }).success,
  ).toBe(false);
});

test("rejects duplicate Authority adoption IDs that mask a missing trusted relation", () => {
  const snapshot = twoAuthorityFixture();
  const result = projectSnapshotSchema.safeParse(
    replaceOnlyAsset(snapshot, {
      adoptedByAuthorityIds: ["authority:design", "authority:design"],
    }),
  );

  expect(result.success).toBe(false);
  if (result.success) return;
  expect(
    result.error.issues.some(
      (issue) =>
        issue.path.join(".") === "assets.items.0.adoptedByAuthorityIds" &&
        issue.message ===
          "Asset Authority adoption cache must exactly match trustworthy forward relations.",
    ),
  ).toBe(true);
});

test("allows unresolved forward references but requires exact reverse caches for trusted members", () => {
  const snapshot = createProjectOverviewFixture();
  const unrelatedSource = createSourceReference({
    basisFingerprint: BASIS,
    kind: "asset",
    displayLocator: ".bearing/state/assets.md",
    fragment: "asset:unrelated",
    binding: { role: "asset", identity: "asset:unrelated" },
  });
  const unrelatedAsset = {
    ...onlyAsset(snapshot),
    id: "asset:unrelated",
    title: "Unrelated Asset",
    source: unrelatedSource,
    citations: [],
    owner: "effort:portal",
    adoptedByAuthorityIds: [],
    gatePassageEvidenceFor: [],
    citationCount: 0,
  };
  const partialAssets = {
    ...snapshot,
    assets: { validity: "partial" as const, items: [unrelatedAsset], issues: [relationIssue] },
    sources: [
      ...snapshot.sources,
      {
        reference: unrelatedSource,
        kind: "asset" as const,
        displayLocator: ".bearing/state/assets.md",
        fragment: "asset:unrelated",
        binding: { role: "asset" as const, identity: "asset:unrelated" },
      },
    ],
  };
  expect(projectSnapshotSchema.safeParse(withRebuiltPlanningLineage(partialAssets)).success).toBe(
    true,
  );

  if (snapshot.efforts.validity === "invalid") throw new Error("Expected trustworthy Efforts.");
  const partialEfforts = {
    ...snapshot,
    gates:
      snapshot.gates.validity === "invalid"
        ? snapshot.gates
        : {
            ...snapshot.gates,
            items: snapshot.gates.items.map((gate) =>
              gate.id === "gate:one" ? { ...gate, readiness: "unknown" as const } : gate,
            ),
          },
    efforts: {
      validity: "partial" as const,
      items: snapshot.efforts.items.filter((effort) => effort.id === "effort:portal"),
      issues: [relationIssue],
    },
  };
  expect(projectSnapshotSchema.safeParse(partialEfforts).success).toBe(false);
  expect(
    projectSnapshotSchema.safeParse(
      withRebuiltPlanningLineage({
        ...partialEfforts,
        assets: {
          validity: "available",
          items: [{ ...onlyAsset(snapshot), citations: [], citationCount: 0 }],
        },
      }),
    ).success,
  ).toBe(true);

  if (snapshot.gates.validity === "invalid") throw new Error("Expected trustworthy Gates.");
  const knownGate = snapshot.gates.items.find((gate) => gate.id === "gate:two");
  if (knownGate === undefined) throw new Error("Expected the active Gate.");
  expect(
    projectSnapshotSchema.safeParse({
      ...snapshot,
      gates: { validity: "partial", items: [knownGate], issues: [relationIssue] },
      assets: {
        validity: "available",
        items: [{ ...onlyAsset(snapshot), gatePassageEvidenceFor: ["gate:forged"] }],
      },
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse(
      withRebuiltPlanningLineage({
        ...snapshot,
        gates: { validity: "partial", items: [knownGate], issues: [relationIssue] },
        assets: {
          validity: "available",
          items: [{ ...onlyAsset(snapshot), gatePassageEvidenceFor: [] }],
        },
      }),
    ).success,
  ).toBe(true);

  const adopted = authorityFixture();
  expect(
    projectSnapshotSchema.safeParse({
      ...adopted,
      authorities: { validity: "invalid", issues: [relationIssue] },
      assets: {
        validity: "available",
        items: [{ ...onlyAsset(adopted), adoptedByAuthorityIds: ["authority:forged"] }],
      },
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse(
      withRebuiltPlanningLineage({
        ...adopted,
        authorities: { validity: "invalid", issues: [relationIssue] },
        assets: {
          validity: "available",
          items: [{ ...onlyAsset(adopted), adoptedByAuthorityIds: [] }],
        },
      }),
    ).success,
  ).toBe(true);
});
