import { expect, test } from "bun:test";
import { buildPlanningLineageProjection } from "../src/project-snapshot/planning-lineage";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import {
  createSourceReference,
  type SourceBindingRole,
} from "../src/project-snapshot/source-reference";

const BASIS = `sha256:${"c".repeat(64)}`;
const boundRecord = (
  locator: string,
  role: SourceBindingRole,
  identity: string,
  fragment?: string,
) => {
  const binding = { role, identity } as const;
  return {
    reference: createSourceReference({
      basisFingerprint: BASIS,
      kind: "canonical",
      displayLocator: locator,
      binding,
      ...(fragment === undefined ? {} : { fragment }),
    }),
    kind: "canonical" as const,
    displayLocator: locator,
    binding,
    ...(fragment === undefined ? {} : { fragment }),
  };
};
const source = createSourceReference({
  basisFingerprint: BASIS,
  kind: "canonical",
  displayLocator: ".bearing/state/project-summary.md",
});
const otherSource = createSourceReference({
  basisFingerprint: BASIS,
  kind: "canonical",
  displayLocator: ".bearing/state/other.md",
});
const openCheckRecord = boundRecord(
  ".bearing/state/alignment-checks/open-check.md",
  "alignment-check",
  "alignment-check:open-check",
);
const resolvedCheckRecord = boundRecord(
  ".bearing/state/alignment-checks/resolved-check.md",
  "alignment-check",
  "alignment-check:resolved-check",
);
const pendingReviewRecord = boundRecord(
  ".bearing/state/planning-reviews/pending-review.md",
  "planning-review",
  "planning-review:pending-review",
);
const completedReviewRecord = boundRecord(
  ".bearing/state/planning-reviews/completed-review.md",
  "planning-review",
  "planning-review:completed-review",
);
const roadmapIndexRecord = boundRecord(
  ".bearing/state/roadmap-index.md",
  "roadmap-index",
  "roadmap-index:current",
);
const activeRoadmapRecord = boundRecord(
  ".bearing/state/roadmaps/active.md",
  "roadmap",
  "roadmap:active",
);
const completedRoadmapRecord = boundRecord(
  ".bearing/state/roadmaps/completed.md",
  "roadmap",
  "roadmap:completed",
);
const supersededRoadmapRecord = boundRecord(
  ".bearing/state/roadmaps/superseded.md",
  "roadmap",
  "roadmap:superseded",
);
const emptyItems = { validity: "available", items: [] } as const;
const emptySnapshot = {
  schemaVersion: 18,
  producer: { packageVersion: "0.0.0-test" },
  basis: { sitemapVersion: 1, sitemapFingerprint: BASIS },
  summary: { validity: "absent" },
  brief: { validity: "absent" },
  roadmapIndex: { validity: "absent" },
  roadmaps: emptyItems,
  gates: emptyItems,
  efforts: emptyItems,
  authorities: emptyItems,
  assets: emptyItems,
  checks: emptyItems,
  reviews: emptyItems,
  lineage: { subjects: [] },
  audit: { validity: "absent" },
  providerObservations: [],
  providerObservationSelections: [],
  nativeScopeInspections: { observations: [], selections: [] },
  diagnostics: [],
  attention: [],
  sources: [
    {
      reference: source,
      kind: "canonical" as const,
      displayLocator: ".bearing/state/project-summary.md",
    },
    {
      reference: otherSource,
      kind: "canonical" as const,
      displayLocator: ".bearing/state/other.md",
    },
    openCheckRecord,
    resolvedCheckRecord,
    pendingReviewRecord,
    completedReviewRecord,
    roadmapIndexRecord,
    activeRoadmapRecord,
    completedRoadmapRecord,
    supersededRoadmapRecord,
  ],
};

const blockingReference = `diagnostic:${"a".repeat(64)}`;
const nonBlockingReference = `diagnostic:${"b".repeat(64)}`;
const openCheck = {
  id: "alignment-check:open-check",
  title: "Open alignment check",
  source: openCheckRecord.reference,
  citations: [],
  status: "open" as const,
  target: "roadmap:active",
};
const resolvedCheck = {
  ...openCheck,
  id: "alignment-check:resolved-check",
  source: resolvedCheckRecord.reference,
  status: "resolved" as const,
};
const pendingReview = {
  id: "planning-review:pending-review",
  title: "Pending planning review",
  source: pendingReviewRecord.reference,
  citations: [],
  status: "pending" as const,
  scope: "Review the whole project.",
};
const completedReview = {
  ...pendingReview,
  id: "planning-review:completed-review",
  source: completedReviewRecord.reference,
  status: "completed" as const,
};
const exactAttention = [
  { kind: "structural-diagnostic", diagnosticReference: blockingReference },
  {
    kind: "alignment-check",
    id: openCheck.id,
    title: openCheck.title,
    source: openCheck.source,
  },
  {
    kind: "planning-review",
    id: pendingReview.id,
    title: pendingReview.title,
    source: pendingReview.source,
  },
];
const attentionSnapshotCandidate = {
  ...emptySnapshot,
  checks: { validity: "available" as const, items: [openCheck, resolvedCheck] },
  reviews: { validity: "available" as const, items: [pendingReview, completedReview] },
  diagnostics: [
    {
      reference: blockingReference,
      code: "blocking-test",
      impact: "blocking",
      target: "roadmap:active",
      message: "Blocking diagnostic.",
      source,
    },
    {
      reference: nonBlockingReference,
      code: "non-blocking-test",
      impact: "non-blocking",
      target: "roadmap:active",
      message: "Non-blocking diagnostic.",
      source,
    },
  ],
  attention: exactAttention,
};
const attentionSnapshot = {
  ...attentionSnapshotCandidate,
  lineage: buildPlanningLineageProjection(attentionSnapshotCandidate),
};

test("accepts Attention derived exactly from trustworthy unresolved inputs", () => {
  expect(projectSnapshotSchema.safeParse(attentionSnapshot).success).toBe(true);
});

test("rejects Attention sourced from non-blocking or resolved inputs", () => {
  const variants = [
    {
      kind: "structural-diagnostic",
      diagnosticReference: nonBlockingReference,
    },
    {
      kind: "alignment-check",
      id: resolvedCheck.id,
      title: resolvedCheck.title,
      source: resolvedCheck.source,
    },
    {
      kind: "planning-review",
      id: completedReview.id,
      title: completedReview.title,
      source: completedReview.source,
    },
  ];
  for (const item of variants) {
    expect(
      projectSnapshotSchema.safeParse({
        ...attentionSnapshot,
        attention: [...exactAttention, item],
      }).success,
    ).toBe(false);
  }
});

test("rejects missing, extra, and identity-mismatched Attention items", () => {
  const extra = {
    kind: "structural-diagnostic",
    diagnosticReference: `diagnostic:${"d".repeat(64)}`,
  };
  const wrongIdentity = { ...exactAttention[1], id: "alignment-check:other" };
  expect(
    projectSnapshotSchema.safeParse({ ...attentionSnapshot, attention: exactAttention.slice(1) })
      .success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...attentionSnapshot,
      attention: [...exactAttention, extra],
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...attentionSnapshot,
      attention: [exactAttention[0], wrongIdentity, exactAttention[2]],
    }).success,
  ).toBe(false);
});

test("rejects Attention title or source drift for the same decision ID", () => {
  const wrongTitle = { ...exactAttention[1], title: "Wrong title" };
  const wrongSource = { ...exactAttention[1], source: otherSource };
  for (const item of [wrongTitle, wrongSource]) {
    expect(
      projectSnapshotSchema.safeParse({
        ...attentionSnapshot,
        attention: [exactAttention[0], item, exactAttention[2]],
      }).success,
    ).toBe(false);
  }
});

const activeRoadmap = {
  id: "roadmap:active",
  title: "Active Roadmap",
  source: activeRoadmapRecord.reference,
  citations: [],
  intent: "Continue the active horizon.",
  lifecycle: "active" as const,
  startedAt: { availability: "unavailable" as const },
  focusedGateId: null,
  gateOrder: [],
  horizon: "unknown" as const,
  effortIds: [],
};
const completedRoadmap = {
  ...activeRoadmap,
  id: "roadmap:completed",
  title: "Completed Roadmap",
  source: completedRoadmapRecord.reference,
  lifecycle: "completed" as const,
  completedAt: { availability: "unavailable" as const },
  horizon: "exhausted" as const,
};
const supersededRoadmap = {
  ...activeRoadmap,
  id: "roadmap:superseded",
  title: "Superseded Roadmap",
  source: supersededRoadmapRecord.reference,
  lifecycle: "superseded" as const,
  supersededAt: { availability: "unavailable" as const },
  horizon: "exhausted" as const,
};
const roadmapSnapshotCandidate = {
  ...emptySnapshot,
  roadmaps: {
    validity: "available" as const,
    items: [activeRoadmap, completedRoadmap, supersededRoadmap],
  },
  roadmapIndex: {
    validity: "available",
    value: {
      source: roadmapIndexRecord.reference,
      activeRoadmapIds: [activeRoadmap.id],
      completedRoadmapIds: [completedRoadmap.id],
      supersededRoadmapIds: [supersededRoadmap.id],
    },
  },
};
const roadmapSnapshot = {
  ...roadmapSnapshotCandidate,
  lineage: buildPlanningLineageProjection(roadmapSnapshotCandidate),
};

test("accepts an exact Roadmap Index lifecycle projection", () => {
  expect(projectSnapshotSchema.safeParse(roadmapSnapshot).success).toBe(true);
});

test("rejects a completed Roadmap tampered into the active Index group", () => {
  const tampered = {
    ...roadmapSnapshot,
    roadmapIndex: {
      validity: "available",
      value: {
        ...roadmapSnapshot.roadmapIndex.value,
        activeRoadmapIds: [activeRoadmap.id, completedRoadmap.id],
        completedRoadmapIds: [],
      },
    },
  };
  expect(projectSnapshotSchema.safeParse(tampered).success).toBe(false);
});
