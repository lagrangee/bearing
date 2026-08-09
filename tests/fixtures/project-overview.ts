import { createProviderScopeObservation } from "../../src/native-work-provider";
import { buildPlanningLineageProjection } from "../../src/project-generation/planning-lineage";
import { projectGenerationSchema } from "../../src/project-generation/schema";
import {
  createSourceReference,
  type SourceBindingRole,
  type SourceKind,
} from "../../src/project-generation/source-reference";
import { plainDocumentPresentation, plainProviderDocument } from "./document-presentation";

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
const trackerRecord = (
  displayLocator: string,
  role: "native-scope" | "map" | "spec" | "wayfinder-ticket" | "delivery-ticket" | "incoming-issue",
  identity = displayLocator,
) => sourceRecord("tracker", displayLocator, role, identity);

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
const effortModelRecord = canonicalRecord(
  ".bearing/state/efforts/model.md",
  "effort",
  "effort:model",
);
const effortPortalRecord = canonicalRecord(
  ".bearing/state/efforts/portal.md",
  "effort",
  "effort:portal",
);
const assetRecord = sourceRecord(
  "asset",
  ".bearing/state/assets.md",
  "asset",
  "asset:planning-model-evidence",
  "asset:planning-model-evidence",
);
const modelMapRecord = trackerRecord(".scratch/model/map.md", "map");
const portalMapRecord = trackerRecord(".scratch/portal/map.md", "map");
const modelScopeRecord = trackerRecord(".scratch/model", "native-scope");
const portalScopeRecord = trackerRecord(".scratch/portal", "native-scope");
const resolvedTicketRecord = trackerRecord(
  ".scratch/model/issues/01-resolve.md",
  "wayfinder-ticket",
);
const claimedTicketRecord = trackerRecord(".scratch/portal/issues/01-build.md", "wayfinder-ticket");
const readyTicketRecord = trackerRecord(".scratch/portal/issues/02-review.md", "wayfinder-ticket");
const blockedTicketRecord = trackerRecord(".scratch/portal/issues/03-gate.md", "delivery-ticket");
const portalSpecRecord = trackerRecord(".scratch/portal/PRD.md", "spec");
const portalIncomingRecord = trackerRecord(
  ".scratch/portal/issues/04-incoming.md",
  "incoming-issue",
);
const auditRecord = canonicalRecord(
  ".bearing/state/planning-audit.md",
  "planning-audit",
  "planning-audit:current",
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
const auditSource = auditRecord.reference;
const reviewSource = reviewRecord.reference;
const diagnosticReference = `diagnostic:${"c".repeat(64)}`;
const availableItems = { validity: "available", items: [] } as const;
const localNative = (locator: string) => ({
  kind: "local" as const,
  identity: { locator },
  createdAt: { availability: "unsupported" as const },
  lastUpdated: { availability: "unsupported" as const },
  sourceAnchors: [],
  rawFacets: [],
});
const availableSections = (...roles: readonly string[]) =>
  roles.map((role) => ({ role, availability: "available" as const }));
const map = (locator: string, title: string, state: "active" | "resolved", fog: string[]) => ({
  kind: "map" as const,
  ref: locator,
  title,
  destination: plainProviderDocument(
    "map.destination",
    "Destination",
    "Reach the accepted project outcome.",
  ),
  notes: [],
  decisions: [],
  fog,
  outOfScope: [],
  lifecycle:
    state === "active"
      ? ({ state: "active" } as const)
      : ({ state: "resolved", resolutionEvidence: [] } as const),
  semanticSections: [
    ...availableSections("map.destination"),
    { role: "map.notes", availability: "confirmed-empty" as const },
    { role: "map.decisions", availability: "confirmed-empty" as const },
    {
      role: "map.fog",
      availability: fog.length === 0 ? ("confirmed-empty" as const) : ("available" as const),
    },
    { role: "map.out-of-scope", availability: "confirmed-empty" as const },
    {
      role: "map.resolution-evidence",
      availability: state === "active" ? ("confirmed-empty" as const) : ("unavailable" as const),
    },
  ],
  native: localNative(locator),
});
const wayfinder = (locator: string, title: string, state: "claimed" | "ready" | "resolved") => ({
  kind: "wayfinder-ticket" as const,
  ref: locator,
  title,
  subtype: "task" as const,
  question: plainProviderDocument("wayfinder.question", "Question", title),
  claim:
    state === "claimed"
      ? ({ state: "claimed", claimant: "lago" } as const)
      : ({ state: "unclaimed" } as const),
  answer:
    state === "resolved"
      ? ({
          availability: "available",
          content: {
            role: "answer",
            document: plainProviderDocument("wayfinder.answer", "Answer", "Resolved."),
            authoredAt: { availability: "unsupported" },
          },
        } as const)
      : ({ availability: "unavailable", reason: "not-authored" } as const),
  comments: [],
  lifecycle:
    state === "resolved"
      ? ({
          state: "resolved-on-route",
          decisionSource: { kind: "decision", target: locator },
        } as const)
      : ({ state: "open" } as const),
  trackerClosure: { state: "open" } as const,
  semanticSections: [
    ...availableSections("wayfinder.question", "wayfinder.claim"),
    {
      role: "wayfinder.answer",
      availability: state === "resolved" ? ("available" as const) : ("confirmed-empty" as const),
    },
    { role: "wayfinder.comments", availability: "confirmed-empty" as const },
  ],
  native: localNative(locator),
});
const delivery = (locator: string, title: string) => ({
  kind: "delivery-ticket" as const,
  ref: locator,
  title,
  whatToBuild: title,
  acceptanceCriteria: ["Complete the accepted work."],
  lifecycle: { state: "open" } as const,
  trackerClosure: { state: "open" } as const,
  comments: [],
  semanticSections: [
    ...availableSections("delivery.what-to-build", "delivery.acceptance-criteria"),
    { role: "delivery.completion-evidence", availability: "confirmed-empty" as const },
    { role: "delivery.comments", availability: "confirmed-empty" as const },
  ],
  native: localNative(locator),
});
const spec = (locator: string, title: string) => {
  const sections = [
    ["problem", "Problem Statement", "The current reading path is incomplete."],
    ["solution", "Solution", "Expose stable native subject routes."],
    ["user-stories", "User Stories", "Users can refresh and share native details."],
    ["implementation", "Implementation Decisions", "Use provider semantic roles."],
    ["testing", "Testing Decisions", "Exercise the shared route contract."],
    ["out-of-scope", "Out of Scope", "Do not mutate provider-native work."],
    ["further-notes", "Further Notes", "Keep Gate Passage independent."],
  ] as const;
  return {
    kind: "spec" as const,
    ref: locator,
    title,
    document: plainDocumentPresentation(
      sections.map(([role, title, body]) => ({ role, title, body })),
    ),
    lifecycle: { state: "ready-for-agent" as const },
    semanticSections: sections.map(([role]) => ({
      role: `spec.${role}`,
      availability: "available" as const,
    })),
    native: localNative(locator),
  };
};
const incoming = (locator: string, title: string) => ({
  kind: "incoming-issue" as const,
  ref: locator,
  title,
  classification: {
    category: "enhancement" as const,
    state: "ready-for-agent" as const,
    nativeCategory: "enhancement",
    nativeState: "ready-for-agent",
  },
  content: [
    {
      role: "triage-note" as const,
      document: plainProviderDocument(
        "incoming.content",
        "Triage Note",
        "Route this request through the accepted Matt workflow.",
      ),
      authoredAt: { availability: "unsupported" as const },
    },
  ],
  lifecycle: { state: "open" as const },
  semanticSections: [
    ...availableSections("incoming.classification", "incoming.content", "incoming.routing"),
  ],
  native: localNative(locator),
});
const capture = (
  nativeScope: string,
  projection: {
    map: ReturnType<typeof map>;
    spec?: ReturnType<typeof spec>;
    wayfinderTickets: readonly ReturnType<typeof wayfinder>[];
    deliveryTickets: readonly ReturnType<typeof delivery>[];
    incomingIssues?: readonly ReturnType<typeof incoming>[];
    blockedBy: readonly Readonly<{ blocked: string; blocker: string }>[];
  },
  completion: "complete" | "incomplete",
) =>
  createProviderScopeObservation({
    provider: "matt-skills/v1" as const,
    binding: { provider: "matt-skills/v1" as const, nativeScope },
    observedAt: "2026-07-28T00:00:00.000Z",
    sourceRevision: BASIS,
    sourceObservedAt: "2026-07-28T00:00:00.000Z",
    validators: [],
    state: "available" as const,
    freshness: {
      assessment: "current" as const,
      evidence: [{ kind: "local-scope", value: nativeScope }],
    },
    coverage: {
      assessment: "complete" as const,
      dimensions: [{ key: "scope", state: "covered" as const }],
    },
    completion,
    diagnostics: [],
    projection: {
      map: projection.map,
      ...(projection.spec === undefined ? {} : { spec: projection.spec }),
      wayfinderTickets: projection.wayfinderTickets,
      deliveryTickets: projection.deliveryTickets,
      incomingIssues: projection.incomingIssues ?? [],
      structuralOrder: [
        projection.map.ref,
        ...(projection.spec === undefined ? [] : [projection.spec.ref]),
        ...projection.wayfinderTickets.map((ticket) => ticket.ref),
        ...projection.deliveryTickets.map((ticket) => ticket.ref),
        ...(projection.incomingIssues ?? []).map((issue) => issue.ref),
      ],
      graph: {
        parentChild: [
          ...projection.wayfinderTickets.map((ticket) => ({
            parent: projection.map.ref,
            child: ticket.ref,
            evidence: "matt-contract" as const,
          })),
          ...(projection.spec === undefined
            ? []
            : projection.deliveryTickets.map((ticket) => ({
                parent: projection.spec?.ref ?? "",
                child: ticket.ref,
                evidence: "matt-contract" as const,
              }))),
        ],
        blockedBy: projection.blockedBy.map((relation) => ({
          ...relation,
          evidence: "matt-contract" as const,
        })),
      },
    },
  });

export const createProjectOverviewFixture = () => {
  const candidate = {
    schemaVersion: 20,
    producer: { packageVersion: "0.0.0-test" },
    basis: { generationVersion: 1, basisFingerprint: BASIS },
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
    brief: { validity: "absent" },
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
          startedAt: { availability: "unavailable" },
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
          startedAt: { availability: "unavailable" },
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
          plannedAt: { availability: "unavailable" },
          activatedAt: { availability: "unavailable" },
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
          plannedAt: { availability: "unavailable" },
          activatedAt: { availability: "unavailable" },
          readiness: "ready-for-review",
          horizonState: "passed",
          effortIds: ["effort:model"],
          passage: {
            acceptedDecision: "Accept the planning model as ready.",
            acceptedAt: { availability: "unavailable" },
            rationale: "The model satisfies its accepted Gate criteria.",
            evidence: [
              {
                locator: ".scratch/evidence/planning-model",
                relevance: "Accepted planning-model evidence.",
              },
            ],
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
          workBinding: {
            provider: "matt-skills/v1",
            nativeScope: ".scratch/model",
          },
          workBindingState: { state: "bound" },
          lifecycle: "concluded",
          plannedAt: { availability: "unavailable" },
          activatedAt: { availability: "unavailable" },
          conclusion: {
            disposition: "completed",
            rationale: "The governed contribution was explicitly accepted as complete.",
            concludedAt: { availability: "unavailable" },
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
          workBinding: {
            provider: "matt-skills/v1",
            nativeScope: ".scratch/portal",
          },
          workBindingState: { state: "bound" },
          lifecycle: "active",
          plannedAt: { availability: "unavailable" },
          activatedAt: { availability: "unavailable" },
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
          purpose: "Keep durable planning-model context available.",
          citations: [
            {
              assetId: "asset:planning-model-evidence",
              note: "Accepted planning-model evidence.",
              citingReference: "effort:model",
              source: effortModelSource,
            },
          ],
          kind: "reference",
          sourceLocator: ".scratch/evidence/planning-model",
          owner: "project-summary:current",
          addedAt: { availability: "unavailable" },
          disposition: "active",
          authorityBaselines: [],
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
          question: "Should the current Roadmap sequence change?",
          scope: { kind: "exact-target", target: "roadmap:portal" },
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
    providerObservations: [
      capture(
        ".scratch/model",
        {
          map: map(".scratch/model/map.md", "Planning Model", "resolved", []),
          wayfinderTickets: [
            wayfinder(
              ".scratch/model/issues/01-resolve.md",
              "Resolve the planning model",
              "resolved",
            ),
          ],
          deliveryTickets: [],
          blockedBy: [],
        },
        "complete",
      ),
      capture(
        ".scratch/portal",
        {
          map: map(".scratch/portal/map.md", "Portal Validation", "active", [
            "Finish the product journey.",
            "Review the evidence.",
          ]),
          spec: spec(".scratch/portal/PRD.md", "Portal Validation PRD"),
          wayfinderTickets: [
            wayfinder(".scratch/portal/issues/01-build.md", "Build the Roadmap journey", "claimed"),
            wayfinder(".scratch/portal/issues/02-review.md", "Review the Roadmap journey", "ready"),
          ],
          deliveryTickets: [
            delivery(".scratch/portal/issues/03-gate.md", "Pass the integration gate"),
          ],
          incomingIssues: [
            incoming(".scratch/portal/issues/04-incoming.md", "Route a new Portal request"),
          ],
          blockedBy: [
            {
              blocked: ".scratch/portal/issues/03-gate.md",
              blocker: ".scratch/portal/issues/02-review.md",
            },
          ],
        },
        "incomplete",
      ),
    ],
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
      modelScopeRecord,
      portalScopeRecord,
      modelMapRecord,
      portalMapRecord,
      resolvedTicketRecord,
      claimedTicketRecord,
      readyTicketRecord,
      blockedTicketRecord,
      portalSpecRecord,
      portalIncomingRecord,
      auditRecord,
      reviewRecord,
    ],
  } as const;
  const providerObservationSelections = candidate.providerObservations.map((observation) => ({
    provider: observation.provider,
    nativeScope: observation.binding.nativeScope,
    observationId: observation.id,
    effectiveFreshness: observation.freshness.assessment,
    latestAttempt: null,
  }));
  return projectGenerationSchema.parse({
    ...candidate,
    providerObservationSelections,
    providerDetailEvidences: { observations: [], selections: [] },
    lineage: buildPlanningLineageProjection({
      roadmaps: candidate.roadmaps,
      gates: candidate.gates,
      efforts: candidate.efforts,
      authorities: candidate.authorities,
      assets: candidate.assets,
      reviews: candidate.reviews,
      providerObservations: candidate.providerObservations,
      providerObservationSelections,
      providerDetailEvidences: { observations: [], selections: [] },
      sources: candidate.sources,
    }),
  });
};
