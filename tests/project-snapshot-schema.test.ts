import { expect, test } from "bun:test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import type { AssetProjection } from "../src/project-snapshot/contract";
import { buildMattNativeSourceRecords } from "../src/project-snapshot/native-work-sources";
import { buildPlanningLineageProjection } from "../src/project-snapshot/planning-lineage";
import {
  assetProjectionSchema,
  gateSchema,
  projectBriefSchema,
  projectSnapshotSchema,
  projectSummarySchema,
} from "../src/project-snapshot/schema";
import {
  createSourceReference,
  type SourceBindingRole,
  type SourceKind,
} from "../src/project-snapshot/source-reference";
import { displayAssetLocatorSchema } from "../src/reference-schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const BASIS = `sha256:${"a".repeat(64)}`;
const boundRecord = (
  kind: SourceKind,
  displayLocator: string,
  role: SourceBindingRole,
  identity: string,
  fragment?: string,
) => {
  const binding = { role, identity } as const;
  return {
    reference: createSourceReference({
      basisFingerprint: BASIS,
      kind,
      displayLocator,
      binding,
      ...(fragment === undefined ? {} : { fragment }),
    }),
    kind,
    displayLocator,
    binding,
    ...(fragment === undefined ? {} : { fragment }),
  };
};
const summaryRecord = boundRecord(
  "canonical",
  ".bearing/state/project-summary.md",
  "project-summary",
  "project-summary:current",
);
const roadmapRecord = boundRecord(
  "canonical",
  ".bearing/state/roadmaps/test.md",
  "roadmap",
  "roadmap:test",
);
const auditRecord = boundRecord(
  "canonical",
  ".bearing/state/planning-audit.md",
  "planning-audit",
  "planning-audit:current",
);
const guidanceRecord = boundRecord(
  "canonical",
  ".bearing/state/next-work-guidance.md",
  "next-work-guidance",
  "next-work-guidance:current",
);
const guidanceItemRecord = (fragment: string) =>
  boundRecord(
    "canonical",
    ".bearing/state/next-work-guidance.md",
    "guidance-item",
    `next-work-guidance:current#${fragment}`,
    fragment,
  );
const primaryRecord = guidanceItemRecord("primary");
const firstAlternativeRecord = guidanceItemRecord("alternative-1");
const secondAlternativeRecord = guidanceItemRecord("alternative-2");
const assetRecord = boundRecord(
  "asset",
  ".bearing/state/assets.md",
  "asset",
  "asset:evidence",
  "asset:evidence",
);
const source = summaryRecord.reference;
const availableItems = { validity: "available", items: [] } as const;
const validSnapshot = {
  schemaVersion: 14,
  producer: { packageVersion: "0.0.0-test" },
  basis: { sitemapVersion: 1, sitemapFingerprint: BASIS },
  summary: { validity: "absent" },
  brief: { validity: "absent" },
  roadmapIndex: { validity: "absent" },
  roadmaps: availableItems,
  gates: availableItems,
  efforts: availableItems,
  authorities: availableItems,
  assets: availableItems,
  checks: availableItems,
  reviews: availableItems,
  lineage: { subjects: [] },
  audit: { validity: "absent" },
  guidance: { validity: "absent" },
  providerObservations: [],
  providerObservationSelections: [],
  nativeScopeDiscovery: { state: "never-run" },
  nativeScopeInspections: { observations: [], selections: [] },
  diagnostics: [],
  attention: [],
  sources: [
    summaryRecord,
    roadmapRecord,
    auditRecord,
    guidanceRecord,
    primaryRecord,
    firstAlternativeRecord,
    secondAlternativeRecord,
    assetRecord,
  ],
};
const providerCapture = createProviderScopeObservation({
  provider: "matt-skills/v1",
  binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
  observedAt: "2026-07-28T12:00:00.000Z",
  sourceRevision: `sha256:${"b".repeat(64)}`,
  validators: [],
  state: "available",
  freshness: {
    assessment: "current",
    evidence: [{ kind: "local-scope", value: ".scratch/work" }],
  },
  coverage: {
    assessment: "complete",
    dimensions: [{ key: "scope-membership", state: "covered" }],
  },
  completion: "incomplete",
  diagnostics: [],
  projection: {
    wayfinderTickets: [],
    deliveryTickets: [],
    incomingIssues: [],
    structuralOrder: [],
    graph: { parentChild: [], blockedBy: [] },
  },
});
const providerSelection = {
  provider: providerCapture.provider,
  nativeScope: providerCapture.binding.nativeScope,
  observationId: providerCapture.id,
  effectiveFreshness: providerCapture.freshness.assessment,
  latestAttempt: null,
} as const;
const guidanceItem = {
  title: "Complete Snapshot",
  rationale: "Unlock every reading path.",
  supportingReferences: ["gate:overview"],
  source: primaryRecord.reference,
};
const guidance = {
  validity: "available",
  value: {
    id: "next-work-guidance:current",
    generatedAt: "2026-07-13T20:00:00+0800",
    semanticFreshness: "current",
    semanticCoverage: "complete",
    basedOnAuditId: "planning-audit:current",
    primary: guidanceItem,
    alternatives: [
      { ...guidanceItem, source: firstAlternativeRecord.reference },
      { ...guidanceItem, title: "Inspect Assets", source: secondAlternativeRecord.reference },
    ],
    source: guidanceRecord.reference,
  },
};
const audit = {
  validity: "available",
  value: {
    id: "planning-audit:current",
    generatedAt: "2026-07-13T19:59:00+0800",
    semanticFreshness: "current",
    coverage: "complete",
    skippedTargets: [],
    findings: [],
    source: auditRecord.reference,
  },
};

test("parses a repository-scoped Snapshot with the complete domain breadth", () => {
  const parsed = projectSnapshotSchema.safeParse(validSnapshot);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  expect(Object.keys(parsed.data)).toEqual([
    "schemaVersion",
    "producer",
    "basis",
    "summary",
    "brief",
    "roadmapIndex",
    "roadmaps",
    "gates",
    "efforts",
    "authorities",
    "assets",
    "checks",
    "reviews",
    "lineage",
    "audit",
    "guidance",
    "providerObservations",
    "providerObservationSelections",
    "nativeScopeDiscovery",
    "nativeScopeInspections",
    "diagnostics",
    "attention",
    "sources",
  ]);
});

test("requires generation-bound native scope reading state and rejects obsolete vocabulary", () => {
  const snapshot = createProjectOverviewFixture();
  const missing = {
    ...snapshot,
    lineage: {
      subjects: snapshot.lineage.subjects.map((subject) => {
        if (subject.identity.kind !== "native-scope") return subject;
        const { nativeWorkReadingState: _readingState, ...withoutReadingState } = subject;
        return withoutReadingState;
      }),
    },
  };
  expect(projectSnapshotSchema.safeParse(missing).success).toBe(false);

  const obsolete = {
    ...snapshot,
    lineage: {
      subjects: snapshot.lineage.subjects.map((subject) =>
        subject.identity.kind === "native-scope" && subject.nativeWorkReadingState !== undefined
          ? {
              ...subject,
              nativeWorkReadingState: {
                ...subject.nativeWorkReadingState,
                conclusion: "Needs refresh",
              },
            }
          : subject,
      ),
    },
  };
  expect(projectSnapshotSchema.safeParse(obsolete).success).toBe(false);

  const forged = {
    ...snapshot,
    lineage: {
      subjects: snapshot.lineage.subjects.map((subject) =>
        subject.identity.kind === "native-scope" &&
        subject.identity.id === ".scratch/portal" &&
        subject.nativeWorkReadingState !== undefined
          ? {
              ...subject,
              nativeWorkReadingState: {
                ...subject.nativeWorkReadingState,
                conclusion: "Complete" as const,
              },
            }
          : subject,
      ),
    },
  };
  expect(projectSnapshotSchema.safeParse(forged).success).toBe(false);
});

test("rejects unsupported versions and Catalog or repository identity", () => {
  expect(projectSnapshotSchema.safeParse({ ...validSnapshot, schemaVersion: 1 }).success).toBe(
    false,
  );
  expect(
    projectSnapshotSchema.safeParse({ ...validSnapshot, entryId: "catalog-entry" }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({ ...validSnapshot, repoRoot: "/private/repo" }).success,
  ).toBe(false);
});

test("rejects extras and impossible projection variants at nested boundaries", () => {
  const extraProducer = { ...validSnapshot, producer: { packageVersion: "x", extra: true } };
  const impossibleAbsent = { ...validSnapshot, summary: { validity: "absent", value: {} } };
  const emptyPartial = {
    ...validSnapshot,
    roadmaps: { validity: "partial", items: [], issues: [] },
  };
  expect(projectSnapshotSchema.safeParse(extraProducer).success).toBe(false);
  expect(projectSnapshotSchema.safeParse(impossibleAbsent).success).toBe(false);
  expect(projectSnapshotSchema.safeParse(emptyPartial).success).toBe(false);
});

test("rejects false-complete, content-tampered, or unresolved provider observations", () => {
  const falseCompleteCaptures = [
    { ...providerCapture, state: "partial", completion: "complete" },
    {
      ...providerCapture,
      completion: "complete",
      freshness: { ...providerCapture.freshness, assessment: "stale" },
    },
    {
      ...providerCapture,
      completion: "complete",
      coverage: {
        assessment: "complete",
        dimensions: [{ key: "scope-membership", state: "gap" }],
      },
    },
    {
      ...providerCapture,
      completion: "complete",
      diagnostics: [
        {
          code: "matt.local.capture.blocked",
          class: "source",
          impact: "blocking",
          target: ".scratch/work",
          message: "The capture is blocked.",
        },
      ],
    },
  ];
  for (const capture of falseCompleteCaptures) {
    expect(
      projectSnapshotSchema.safeParse({
        ...validSnapshot,
        providerObservations: [capture],
        providerObservationSelections: [providerSelection],
      }).success,
    ).toBe(false);
  }
  expect(
    projectSnapshotSchema.safeParse({
      ...validSnapshot,
      providerObservations: [
        {
          ...providerCapture,
          sourceRevision: `sha256:${"c".repeat(64)}`,
        },
      ],
      providerObservationSelections: [providerSelection],
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...validSnapshot,
      providerObservations: [providerCapture],
      providerObservationSelections: [
        { ...providerSelection, observationId: `provider-observation:sha256:${"c".repeat(64)}` },
      ],
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse(
      (() => {
        const sources = [
          ...validSnapshot.sources,
          ...buildMattNativeSourceRecords([providerCapture], BASIS),
        ];
        const candidate = {
          ...validSnapshot,
          providerObservations: [providerCapture],
          providerObservationSelections: [providerSelection],
          sources,
        };
        return { ...candidate, lineage: buildPlanningLineageProjection(candidate) };
      })(),
    ).success,
  ).toBe(true);
});

test("accepts only explicit BCP-47 metadata for Project Summary parts", () => {
  // Given: one normalized Summary with declared per-part language metadata.
  const summary = {
    validity: "available",
    value: {
      id: "project-summary:current",
      title: "Language contract",
      purpose: "让用户看见 whole picture。",
      currentDesign: "One read-oriented surface.",
      languages: { purpose: "zh-CN" },
      boundaries: [],
      futureCandidates: [],
      materialRevisions: [],
      source,
    },
  };

  // When: valid and invalid language metadata cross the Snapshot schema.
  const valid = projectSnapshotSchema.safeParse({ ...validSnapshot, summary });
  const invalid = projectSnapshotSchema.safeParse({
    ...validSnapshot,
    summary: {
      ...summary,
      value: { ...summary.value, languages: { purpose: "zh_CN" } },
    },
  });

  // Then: only the explicit valid BCP-47 tag is accepted.
  expect(valid.success).toBe(true);
  expect(invalid.success).toBe(false);
});

test("keeps Summary and Brief time provenance UTC and independently optional", () => {
  const summary = {
    id: "project-summary:current",
    title: "Project Summary",
    source,
    purpose: "Keep the project oriented.",
    currentDesign: "Use explicit governance boundaries.",
    boundaries: [],
    futureCandidates: [],
    materialRevisions: [],
  };
  const brief = {
    id: "project-brief:current",
    title: "Project Brief",
    source,
    generatedAt: "2026-08-03T02:03:04Z",
    projectPurpose: "Keep the project oriented.",
    currentStage: "Validate the revised reading contract.",
    materialAchievedState: "The typed planning boundary is established.",
  };

  expect(projectSummarySchema.safeParse(summary).success).toBe(true);
  expect(
    projectSummarySchema.safeParse({ ...summary, updatedAt: "2026-08-03T01:02:03Z" }).success,
  ).toBe(true);
  expect(
    projectSummarySchema.safeParse({ ...summary, updatedAt: "2026-08-03T09:02:03+08:00" }).success,
  ).toBe(false);
  expect(projectBriefSchema.safeParse(brief).success).toBe(true);
  expect(
    projectBriefSchema.safeParse({ ...brief, generatedAt: "2026-08-03T10:03:04+08:00" }).success,
  ).toBe(false);
});

test("requires one primary and permits zero to two Guidance alternatives", () => {
  expect(projectSnapshotSchema.safeParse({ ...validSnapshot, audit, guidance }).success).toBe(true);
  const noAlternatives = {
    ...guidance,
    value: { ...guidance.value, alternatives: [] },
  };
  const oneAlternative = {
    ...guidance,
    value: {
      ...guidance.value,
      alternatives: [{ ...guidanceItem, source: firstAlternativeRecord.reference }],
    },
  };
  expect(
    projectSnapshotSchema.safeParse({ ...validSnapshot, audit, guidance: noAlternatives }).success,
  ).toBe(true);
  expect(
    projectSnapshotSchema.safeParse({ ...validSnapshot, audit, guidance: oneAlternative }).success,
  ).toBe(true);
  const threeAlternatives = {
    ...guidance,
    value: {
      ...guidance.value,
      alternatives: [guidanceItem, guidanceItem, guidanceItem],
    },
  };
  expect(
    projectSnapshotSchema.safeParse({
      ...validSnapshot,
      audit,
      guidance: threeAlternatives,
    }).success,
  ).toBe(false);
});

test("keeps Guidance coverage and Audit basis structurally consistent", () => {
  // Given: a valid complete Guidance projection and two impossible cache variants.
  const withoutAuditBasis = {
    ...guidance,
    value: { ...guidance.value, basedOnAuditId: undefined },
  };
  const absentWithAuditBasis = {
    ...guidance,
    value: { ...guidance.value, semanticCoverage: "absent" },
  };

  // When / Then: the normalized cache schema enforces the same invariant as canonical source.
  expect(
    projectSnapshotSchema.safeParse({ ...validSnapshot, audit, guidance: withoutAuditBasis })
      .success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({ ...validSnapshot, audit, guidance: absentWithAuditBasis })
      .success,
  ).toBe(false);
});

test("keeps execution evidence provenance self-contained in cached Assets", () => {
  // Given: an execution-evidence Asset with valid structural metadata.
  const asset = {
    id: "asset:evidence",
    title: "Execution Evidence",
    source: assetRecord.reference,
    citations: [],
    kind: "execution-evidence",
    owner: "effort:test",
    producer: { kind: "executor-profile", name: "generic-agent" },
    lifecycleSource: "native",
    registeredAt: { availability: "unavailable" },
    producedFor: ".scratch/work/issues/01-work.md",
    displayLocation: "evidence/report.md",
    contentAvailability: "available",
    evidenceRoles: ["execution-evidence"],
    authorityAdoptions: [],
    passageEvidence: [],
  };
  const withAsset = (value: object) => ({
    ...validSnapshot,
    assets: { validity: "available", items: [value] },
    lineage: buildPlanningLineageProjection({
      ...validSnapshot,
      assets: { validity: "available", items: [value as AssetProjection] },
    }),
  });

  // When / Then: missing work provenance or the wrong Producer kind is rejected from cache.
  expect(projectSnapshotSchema.safeParse(withAsset(asset)).success).toBe(true);
  expect(
    projectSnapshotSchema.safeParse(withAsset({ ...asset, producedFor: undefined })).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse(
      withAsset({ ...asset, producer: { kind: "agent", name: "fixture" } }),
    ).success,
  ).toBe(false);
});

test("keeps Asset lifecycle source, disposition, and supersession consistent", () => {
  const asset = {
    id: "asset:evidence",
    title: "Historical evidence",
    source: assetRecord.reference,
    citations: [],
    kind: "verification-report",
    owner: "effort:test",
    producer: { kind: "agent", name: "fixture" },
    lifecycleSource: "registry",
    registeredAt: { availability: "unavailable" },
    disposition: "superseded",
    supersededBy: "asset:replacement",
    supersededAt: { availability: "unavailable" },
    displayLocation: "evidence/report.md",
    contentAvailability: "available",
    evidenceRoles: [],
    authorityAdoptions: [],
    passageEvidence: [],
  };

  expect(assetProjectionSchema.safeParse(asset).success).toBe(true);
  for (const inconsistent of [
    { ...asset, disposition: undefined, supersededBy: undefined },
    { ...asset, lifecycleSource: "native", disposition: "available", supersededBy: undefined },
    { ...asset, supersededBy: undefined },
    { ...asset, disposition: "available" },
    { ...asset, supersededBy: asset.id },
  ]) {
    expect(assetProjectionSchema.safeParse(inconsistent).success).toBe(false);
  }
});

test("rejects duplicate Gate Passage identities in an Asset reverse relation cache", () => {
  const asset = {
    id: "asset:evidence",
    title: "Execution Evidence",
    source: assetRecord.reference,
    citations: [],
    kind: "execution-evidence",
    owner: "effort:test",
    producer: { kind: "executor-profile", name: "generic-agent" },
    lifecycleSource: "native",
    registeredAt: { availability: "unavailable" },
    producedFor: ".scratch/work/issues/01-work.md",
    displayLocation: "evidence/report.md",
    contentAvailability: "available",
    evidenceRoles: ["execution-evidence", "passage-evidence"],
    authorityAdoptions: [],
    passageEvidence: [
      { gateId: "gate:one", source: assetRecord.reference },
      { gateId: "gate:one", source: assetRecord.reference },
    ],
  };

  expect(assetProjectionSchema.safeParse(asset).success).toBe(false);
});

test("rejects absolute and traversing display locators", () => {
  const withLocator = (displayLocator: string) => ({
    ...validSnapshot,
    sources: [{ reference: source, kind: "canonical", displayLocator }],
  });
  expect(projectSnapshotSchema.safeParse(withLocator("/private/repo/secret.md")).success).toBe(
    false,
  );
  expect(projectSnapshotSchema.safeParse(withLocator("../secret.md")).success).toBe(false);
});

test("accepts only repository-relative local Asset Locations", () => {
  const baseAsset = {
    id: "asset:local",
    title: "Local context",
    source: assetRecord.reference,
    evidenceRoles: [],
    citations: [],
    authorityAdoptions: [],
    passageEvidence: [],
    kind: "project-context",
    owner: "effort:test",
    producer: { kind: "planning-skill", name: "fixture" },
    lifecycleSource: "registry",
    registeredAt: { availability: "unavailable" },
    disposition: "available",
    displayLocation: "evidence/report.md",
    contentAvailability: "available",
  };

  expect(assetProjectionSchema.safeParse(baseAsset).success).toBe(true);
  expect(
    assetProjectionSchema.safeParse({ ...baseAsset, displayLocation: "evidence/reports" }).success,
  ).toBe(true);
  for (const displayLocation of [
    "/tmp/report.md",
    "../report.md",
    "https://example.test/report.md",
    "source:0123456789abcdef",
  ]) {
    expect(assetProjectionSchema.safeParse({ ...baseAsset, displayLocation }).success).toBe(false);
  }
});

test("keeps Asset Evidence roles explicit, independent, and coexisting", () => {
  const contextualAsset = {
    id: "asset:context",
    title: "Context without evidence",
    source: assetRecord.reference,
    evidenceRoles: [],
    citations: [],
    authorityAdoptions: [],
    passageEvidence: [],
    kind: "project-context",
    owner: "gate:one",
    producer: {
      kind: "planning-skill",
      name: "fixture",
      reference: "planning-review:context",
    },
    lifecycleSource: "registry",
    registeredAt: { availability: "unavailable" },
    disposition: "available",
    producedFor: "effort:test",
    displayLocation: "docs/context",
    contentAvailability: "available",
  };
  expect(assetProjectionSchema.safeParse(contextualAsset).success).toBe(true);

  const allRoles = {
    ...contextualAsset,
    kind: "execution-evidence",
    producer: {
      kind: "executor-profile",
      name: "generic-agent",
      reference: "executor:generic",
    },
    evidenceRoles: [
      "execution-evidence",
      "planning-citation",
      "authority-adoption",
      "passage-evidence",
    ],
    citations: [
      {
        assetId: "asset:context",
        note: "Direct planning use.",
        citingReference: "effort:test",
        source: assetRecord.reference,
      },
    ],
    authorityAdoptions: [
      {
        authorityId: "authority:design",
        decisionReference: "planning-review:adopt-design",
        source: assetRecord.reference,
      },
    ],
    passageEvidence: [{ gateId: "gate:one", source: assetRecord.reference }],
  };
  expect(assetProjectionSchema.safeParse(allRoles).success).toBe(true);
  expect(
    assetProjectionSchema.safeParse({
      ...contextualAsset,
      evidenceRoles: ["planning-citation"],
    }).success,
  ).toBe(false);
  expect(
    assetProjectionSchema.safeParse({
      ...allRoles,
      evidenceRoles: ["execution-evidence", "planning-citation", "passage-evidence"],
    }).success,
  ).toBe(false);
});

test("rejects a NUL byte in Source and Asset display locators", () => {
  expect(() =>
    createSourceReference({
      basisFingerprint: BASIS,
      kind: "canonical",
      displayLocator: ".bearing/state/project-summary.md\0suffix",
    }),
  ).toThrow();
  expect(displayAssetLocatorSchema.safeParse("https://evidence.invalid/item\0suffix").success).toBe(
    false,
  );
});

test("creates deterministic opaque references scoped by Snapshot basis", () => {
  const seed = {
    basisFingerprint: BASIS,
    kind: "tracker" as const,
    displayLocator: ".scratch/portal/map.md",
    fragment: "frontier",
    binding: { role: "map" as const, identity: ".scratch/portal/map.md" },
  };
  const first = createSourceReference(seed);
  const second = createSourceReference(seed);
  const nextBasis = createSourceReference({
    ...seed,
    basisFingerprint: `sha256:${"d".repeat(64)}`,
  });
  expect(first).toBe(second);
  expect(first).not.toBe(nextBasis);
  expect(first).toMatch(/^source:[0-9a-f]{64}$/u);
  expect(first).not.toContain(seed.displayLocator);
  expect(first).not.toContain(seed.binding.identity);
});

test("requires a partial collection to retain at least one trustworthy member", () => {
  const issue = { code: "invalid-roadmap", target: "roadmaps", message: "One item is invalid." };
  const emptyPartial = {
    ...validSnapshot,
    roadmaps: { validity: "partial", items: [], issues: [issue] },
  };
  const retainedPartial = {
    ...validSnapshot,
    roadmaps: {
      validity: "partial" as const,
      items: [
        {
          id: "roadmap:test",
          title: "Trusted Roadmap",
          source: roadmapRecord.reference,
          citations: [],
          intent: "Retain the trustworthy horizon.",
          lifecycle: "active" as const,
          startedAt: { availability: "unavailable" as const },
          focusedGateId: null,
          gateOrder: [],
          horizon: "unknown" as const,
          effortIds: [],
        },
      ],
      issues: [issue],
    },
  };
  const retainedPartialWithLineage = {
    ...retainedPartial,
    lineage: buildPlanningLineageProjection(retainedPartial),
  };

  expect(projectSnapshotSchema.safeParse(emptyPartial).success).toBe(false);
  expect(projectSnapshotSchema.safeParse(retainedPartialWithLineage).success).toBe(true);
});

test("preserves the complete accepted Gate Passage decision", () => {
  const gate = {
    id: "gate:overview",
    title: "Overview ready",
    source,
    citations: [],
    intent: "Prove the reading path.",
    exitCriteria: ["The reading path is proven."],
    roadmapId: "roadmap:portal",
    lifecycle: "passed",
    plannedAt: { availability: "unavailable" },
    activatedAt: { availability: "unavailable" },
    readiness: "ready-for-review",
    horizonState: "passed",
    effortIds: [],
    passage: {
      acceptedDecision: "Pass the Gate.",
      acceptedAt: { availability: "unavailable" },
      rationale: "The accepted evidence is complete.",
      evidenceAssetIds: [],
      exceptions: [],
    },
  };
  expect(gateSchema.safeParse(gate).success).toBe(true);
  const withoutDecision = {
    ...gate,
    passage: { ...gate.passage, acceptedDecision: undefined },
  };
  expect(gateSchema.safeParse(withoutDecision).success).toBe(false);
});

test("rejects formatting in semantic Snapshot text without treating structural strings as prose", () => {
  // Given: one otherwise-valid Summary and one scoped projection issue.
  const summary = {
    validity: "available",
    value: {
      id: "project-summary:current",
      title: "Project Summary",
      purpose: "Keep the whole picture visible.",
      currentDesign: "One read-oriented surface.",
      boundaries: ["Keep native work native."],
      futureCandidates: [],
      materialRevisions: [],
      source,
    },
  };
  const structuralMarkers = {
    ...validSnapshot,
    producer: { packageVersion: "build:<opaque>" },
    roadmaps: {
      validity: "invalid",
      issues: [{ code: "invalid-**code**", target: "[opaque-target]", message: "Plain issue." }],
    },
  };

  // When / Then: semantic formatting is rejected while opaque structural strings remain valid.
  expect(
    projectSnapshotSchema.safeParse({
      ...validSnapshot,
      summary: { ...summary, value: { ...summary.value, title: "**Marked title**" } },
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...validSnapshot,
      summary: { ...summary, value: { ...summary.value, title: "<div\nclass=note>" } },
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...validSnapshot,
      summary: { ...summary, value: { ...summary.value, title: "**Split\nSummary**" } },
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...validSnapshot,
      summary: {
        ...summary,
        value: { ...summary.value, futureCandidates: ["Repeated", "Repeated"] },
      },
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...validSnapshot,
      summary: { ...summary, value: { ...summary.value, boundaries: ["> Marked boundary"] } },
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...structuralMarkers,
      roadmaps: {
        validity: "invalid",
        issues: [
          {
            code: "invalid-**code**",
            target: "[opaque-target]",
            message: "Issue with `formatted` text.",
          },
        ],
      },
    }).success,
  ).toBe(false);
  expect(projectSnapshotSchema.safeParse(structuralMarkers).success).toBe(true);
});
