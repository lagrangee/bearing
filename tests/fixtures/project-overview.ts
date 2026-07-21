import { projectSnapshotSchema } from "../../src/project-snapshot/schema";
import {
  createSourceReference,
  type SourceBindingRole,
  type SourceKind,
} from "../../src/project-snapshot/source-reference";

const BASIS = `sha256:${"b".repeat(64)}`;
const sourceRecord = (
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
const canonicalRecord = (
  displayLocator: string,
  role: SourceBindingRole,
  identity: string,
  fragment?: string,
) => sourceRecord("canonical", displayLocator, role, identity, fragment);
const trackerRecord = (displayLocator: string, role: "map" | "ticket") =>
  sourceRecord("tracker", displayLocator, role, displayLocator);

const summaryRecord = canonicalRecord(
  ".bearing/state/project-summary.md",
  "project-summary",
  "project-summary:current",
);
const roadmapIndexRecord = canonicalRecord(
  ".bearing/state/roadmap-index.md",
  "roadmap-index",
  "roadmap-index:current",
);
const roadmapRecord = canonicalRecord(
  ".bearing/state/roadmaps/portal.md",
  "roadmap",
  "roadmap:portal",
);
const secondRoadmapRecord = canonicalRecord(
  ".bearing/state/roadmaps/second.md",
  "roadmap",
  "roadmap:second",
);
const gateOneRecord = canonicalRecord(
  ".bearing/state/milestone-gates/one.md",
  "milestone-gate",
  "gate:one",
);
const gateTwoRecord = canonicalRecord(
  ".bearing/state/milestone-gates/two.md",
  "milestone-gate",
  "gate:two",
);
const effortModelRecord = canonicalRecord(".scratch/model/effort.md", "effort", "effort:model");
const effortPortalRecord = canonicalRecord(".scratch/portal/effort.md", "effort", "effort:portal");
const assetRecord = sourceRecord(
  "asset",
  ".bearing/state/assets.md",
  "asset",
  "asset:planning-model-evidence",
  "asset:planning-model-evidence",
);
const modelMapRecord = trackerRecord(".scratch/model/map.md", "map");
const portalMapRecord = trackerRecord(".scratch/portal/map.md", "map");
const resolvedTicketRecord = trackerRecord(".scratch/model/issues/01-resolve.md", "ticket");
const claimedTicketRecord = trackerRecord(".scratch/portal/issues/01-build.md", "ticket");
const readyTicketRecord = trackerRecord(".scratch/portal/issues/02-review.md", "ticket");
const blockedTicketRecord = trackerRecord(".scratch/portal/issues/03-gate.md", "ticket");
const auditRecord = canonicalRecord(
  ".bearing/state/planning-audit.md",
  "planning-audit",
  "planning-audit:current",
);
const guidanceRecord = canonicalRecord(
  ".bearing/state/next-work-guidance.md",
  "next-work-guidance",
  "next-work-guidance:current",
);
const guidanceItemRecord = (fragment: string) =>
  canonicalRecord(
    ".bearing/state/next-work-guidance.md",
    "guidance-item",
    `next-work-guidance:current#${fragment}`,
    fragment,
  );
const primaryGuidanceRecord = guidanceItemRecord("primary");
const firstAlternativeRecord = guidanceItemRecord("alternative-1");
const secondAlternativeRecord = guidanceItemRecord("alternative-2");
const checkRecord = canonicalRecord(
  ".bearing/state/alignment-checks/portal.md",
  "alignment-check",
  "alignment-check:portal",
);
const reviewRecord = canonicalRecord(
  ".bearing/state/planning-reviews/sequence.md",
  "planning-review",
  "planning-review:sequence",
);
const summarySource = summaryRecord.reference;
const roadmapIndexSource = roadmapIndexRecord.reference;
const roadmapSource = roadmapRecord.reference;
const secondRoadmapSource = secondRoadmapRecord.reference;
const gateOneSource = gateOneRecord.reference;
const gateTwoSource = gateTwoRecord.reference;
const effortModelSource = effortModelRecord.reference;
const effortPortalSource = effortPortalRecord.reference;
const assetSource = assetRecord.reference;
const modelMapSource = modelMapRecord.reference;
const portalMapSource = portalMapRecord.reference;
const resolvedTicketSource = resolvedTicketRecord.reference;
const claimedTicketSource = claimedTicketRecord.reference;
const readyTicketSource = readyTicketRecord.reference;
const blockedTicketSource = blockedTicketRecord.reference;
const auditSource = auditRecord.reference;
const guidanceSource = guidanceRecord.reference;
const primaryGuidanceSource = primaryGuidanceRecord.reference;
const firstAlternativeSource = firstAlternativeRecord.reference;
const secondAlternativeSource = secondAlternativeRecord.reference;
const checkSource = checkRecord.reference;
const reviewSource = reviewRecord.reference;
const diagnosticReference = `diagnostic:${"c".repeat(64)}`;
const availableItems = { validity: "available", items: [] };
const guidanceItem = (title: string, rationale: string, source: typeof guidanceSource) => ({
  title,
  rationale,
  supportingReferences: ["gate:two"],
  source,
});

export const createProjectOverviewFixture = () =>
  projectSnapshotSchema.parse({
    schemaVersion: 2,
    producer: { packageVersion: "0.0.0-test" },
    basis: { sitemapVersion: 1, sitemapFingerprint: BASIS },
    summary: {
      validity: "available",
      value: {
        id: "project-summary:current",
        title: "Portal Project",
        purpose: "Keep the whole project visible.",
        currentDesign: "One read-oriented governance surface.",
        boundaries: [],
        futureCandidates: [],
        materialRevisions: [],
        source: summarySource,
      },
    },
    roadmapIndex: {
      validity: "available",
      value: {
        source: roadmapIndexSource,
        activeRoadmapIds: ["roadmap:second", "roadmap:portal"],
        completedRoadmapIds: [],
        supersededRoadmapIds: [],
      },
    },
    roadmaps: {
      validity: "available",
      items: [
        {
          id: "roadmap:portal",
          title: "Portal Evolution",
          source: roadmapSource,
          citations: [],
          intent: "Prove whole-project orientation.",
          lifecycle: "active",
          focusedGateId: "gate:two",
          gateOrder: ["gate:one", "gate:two"],
          horizon: "active-horizon",
          effortIds: ["effort:model", "effort:portal"],
        },
        {
          id: "roadmap:second",
          title: "Second Horizon",
          source: secondRoadmapSource,
          citations: [],
          intent: "Keep peer outcomes visible.",
          lifecycle: "active",
          focusedGateId: null,
          gateOrder: [],
          horizon: "unknown",
          effortIds: [],
        },
      ],
    },
    gates: {
      validity: "available",
      items: [
        {
          id: "gate:two",
          title: "Overview proven",
          source: gateTwoSource,
          citations: [],
          intent: "Prove Overview.",
          exitCriteria: ["Overview is usable.", "Evidence remains inspectable."],
          roadmapId: "roadmap:portal",
          lifecycle: "active",
          readiness: "not-ready",
          horizonState: "focused",
          effortIds: ["effort:portal"],
        },
        {
          id: "gate:one",
          title: "Model ready",
          source: gateOneSource,
          citations: [],
          intent: "Establish the model.",
          exitCriteria: ["The planning model is accepted."],
          roadmapId: "roadmap:portal",
          lifecycle: "passed",
          readiness: "ready-for-review",
          horizonState: "passed",
          effortIds: ["effort:model"],
          passage: {
            acceptedDecision: "Accept the planning model as ready.",
            rationale: "The model satisfies its accepted Gate criteria.",
            evidenceAssetIds: ["asset:planning-model-evidence"],
            exceptions: [],
          },
        },
      ],
    },
    efforts: {
      validity: "available",
      items: [
        {
          id: "effort:model",
          title: "Planning Model",
          source: effortModelSource,
          citations: [
            {
              assetId: "asset:planning-model-evidence",
              note: "Accepted planning-model evidence.",
            },
          ],
          intent: "Establish the planning model.",
          roadmapId: "roadmap:portal",
          targetGateId: "gate:one",
          authorityIds: [],
          derivedState: "resolved",
          frontier: {
            claimed: [],
            ready: [],
            blocked: [],
            resolved: [".scratch/model/issues/01-resolve.md"],
            fogCount: 0,
          },
        },
        {
          id: "effort:portal",
          title: "Web Portal Validation",
          source: effortPortalSource,
          citations: [],
          intent: "Deliver the accepted Portal journey.",
          roadmapId: "roadmap:portal",
          targetGateId: "gate:two",
          authorityIds: [],
          derivedState: "active",
          frontier: {
            claimed: [".scratch/portal/issues/01-build.md"],
            ready: [".scratch/portal/issues/02-review.md"],
            blocked: [".scratch/portal/issues/03-gate.md"],
            resolved: [],
            fogCount: 2,
          },
        },
      ],
    },
    authorities: availableItems,
    assets: {
      validity: "available",
      items: [
        {
          id: "asset:planning-model-evidence",
          title: "Planning Model Evidence",
          source: assetSource,
          citations: [
            {
              assetId: "asset:planning-model-evidence",
              note: "Accepted planning-model evidence.",
              citingReference: "effort:model",
              source: effortModelSource,
            },
          ],
          kind: "verification-report",
          owner: "gate:one",
          producer: { kind: "executor-profile", name: "generic-agent" },
          lifecycleSource: "native",
          displayLocation: ".scratch/evidence/planning-model",
          contentAvailability: "available",
          adoptedByAuthorityIds: [],
          gatePassageEvidenceFor: ["gate:one"],
          citationCount: 1,
        },
      ],
    },
    checks: {
      validity: "available",
      items: [
        {
          id: "alignment-check:portal",
          title: "Confirm the Portal revision",
          source: checkSource,
          citations: [],
          status: "open",
          target: "roadmap:portal",
        },
      ],
    },
    reviews: {
      validity: "available",
      items: [
        {
          id: "planning-review:sequence",
          title: "Review the current sequence",
          source: reviewSource,
          citations: [],
          status: "pending",
          scope: "Current Roadmap sequencing",
        },
      ],
    },
    audit: {
      validity: "available",
      value: {
        id: "planning-audit:current",
        generatedAt: "2026-07-13T19:55:00+0800",
        semanticFreshness: "current",
        coverage: "complete",
        skippedTargets: [],
        findings: [],
        source: auditSource,
      },
    },
    guidance: {
      validity: "available",
      value: {
        id: "next-work-guidance:current",
        generatedAt: "2026-07-13T20:00:00+0800",
        semanticFreshness: "stale",
        semanticCoverage: "complete",
        basedOnAuditId: "planning-audit:current",
        primary: guidanceItem(
          "Finish Overview",
          "Connect the accepted reading path.",
          primaryGuidanceSource,
        ),
        alternatives: [
          guidanceItem(
            "Inspect the horizon",
            "Check the explicit Gate order.",
            firstAlternativeSource,
          ),
          guidanceItem("Review evidence", "Confirm the current basis.", secondAlternativeSource),
        ],
        source: guidanceSource,
      },
    },
    maps: {
      validity: "available",
      items: [
        {
          reference: ".scratch/model/map.md",
          title: "Planning Model",
          source: modelMapSource,
          state: "resolved",
          effortId: "effort:model",
          fogCount: 0,
        },
        {
          reference: ".scratch/portal/map.md",
          title: "Portal Validation",
          source: portalMapSource,
          state: "active",
          effortId: "effort:portal",
          fogCount: 2,
        },
      ],
    },
    tickets: {
      validity: "available",
      items: [
        {
          reference: ".scratch/model/issues/01-resolve.md",
          title: "Resolve the planning model",
          source: resolvedTicketSource,
          state: "resolved",
          effortId: "effort:model",
          blockedBy: [],
        },
        {
          reference: ".scratch/portal/issues/01-build.md",
          title: "Build the Roadmap journey",
          source: claimedTicketSource,
          state: "claimed",
          effortId: "effort:portal",
          blockedBy: [],
        },
        {
          reference: ".scratch/portal/issues/02-review.md",
          title: "Review the Roadmap journey",
          source: readyTicketSource,
          state: "ready",
          effortId: "effort:portal",
          blockedBy: [],
        },
        {
          reference: ".scratch/portal/issues/03-gate.md",
          title: "Pass the integration gate",
          source: blockedTicketSource,
          state: "blocked",
          effortId: "effort:portal",
          blockedBy: [".scratch/portal/issues/02-review.md"],
        },
      ],
    },
    diagnostics: [
      {
        reference: diagnosticReference,
        code: "invalid-source",
        impact: "blocking",
        target: ".bearing/state/project-summary.md",
        message: "Project Summary has one malformed section.",
        source: summarySource,
      },
    ],
    attention: [
      { kind: "structural-diagnostic", diagnosticReference },
      {
        kind: "alignment-check",
        id: "alignment-check:portal",
        title: "Confirm the Portal revision",
        source: checkSource,
      },
      {
        kind: "planning-review",
        id: "planning-review:sequence",
        title: "Review the current sequence",
        source: reviewSource,
      },
    ],
    sources: [
      summaryRecord,
      roadmapIndexRecord,
      roadmapRecord,
      secondRoadmapRecord,
      gateOneRecord,
      gateTwoRecord,
      effortModelRecord,
      effortPortalRecord,
      assetRecord,
      modelMapRecord,
      portalMapRecord,
      resolvedTicketRecord,
      claimedTicketRecord,
      readyTicketRecord,
      blockedTicketRecord,
      auditRecord,
      guidanceRecord,
      primaryGuidanceRecord,
      firstAlternativeRecord,
      secondAlternativeRecord,
      checkRecord,
      reviewRecord,
    ],
  });
