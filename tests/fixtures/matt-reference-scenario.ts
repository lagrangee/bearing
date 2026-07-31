import { createProviderScopeObservation } from "../../src/native-work-provider";
import type { MattSkillsV1Provider } from "../../src/providers/matt-skills-v1/capture";
import type {
  MattNativeEvidence,
  MattObjectReference,
  MattScopeProjection,
} from "../../src/providers/matt-skills-v1/model";
import type { MattReferenceSemanticView } from "../helpers/matt-reference-oracle";

type NativeKind = "local" | "github";

const ref = (value: string): MattObjectReference => value as MattObjectReference;
const scenarioRef = (nativeKind: NativeKind, role: string): MattObjectReference =>
  ref(`${nativeKind}:opaque:${role}`);
const availableSections = (...roles: readonly string[]) =>
  roles.map((role) => ({ role, availability: "available" as const }));

const nativeEvidence = (
  nativeKind: NativeKind,
  role: string,
  ordinal: number,
): MattNativeEvidence =>
  nativeKind === "local"
    ? {
        kind: "local",
        identity: {
          locator: `.scratch/reference/${role}-${ordinal}.md`,
        },
        sourceAnchors: [
          {
            kind: "source",
            target: `.scratch/reference/${role}-${ordinal}.md`,
          },
        ],
        rawFacets: [{ key: "mode", values: ["100644"] }],
      }
    : {
        kind: "github",
        identity: {
          repositoryDatabaseId: "9001",
          repositoryNodeId: "R_reference",
          objectKind: "issue",
          objectDatabaseId: String(9100 + ordinal),
          objectNodeId: `I_reference_${ordinal}`,
          number: 100 + ordinal,
          url: `https://github.com/example/reference/issues/${100 + ordinal}`,
          owner: "example",
          repository: "reference",
        },
        sourceAnchors: [
          {
            kind: "source",
            target: `https://github.com/example/reference/issues/${100 + ordinal}`,
          },
        ],
        rawFacets: [
          { key: "labels", values: role === "incoming" ? ["custom-enhancement"] : [role] },
        ],
      };

export const createMattReferenceProjection = (nativeKind: NativeKind): MattScopeProjection => {
  const mapRef = scenarioRef(nativeKind, "map");
  const specRef = scenarioRef(nativeKind, "spec");
  const researchRef = scenarioRef(nativeKind, "research");
  const prototypeRef = scenarioRef(nativeKind, "prototype");
  const grillingRef = scenarioRef(nativeKind, "grilling");
  const taskRef = scenarioRef(nativeKind, "task");
  const deliveryOneRef = scenarioRef(nativeKind, "delivery-one");
  const deliveryTwoRef = scenarioRef(nativeKind, "delivery-two");
  const incomingRef = scenarioRef(nativeKind, "incoming-enhancement");

  return {
    map: {
      kind: "map",
      ref: mapRef,
      title: "Reference Map",
      destination: "Prove one complete Matt-native semantic scope.",
      notes: ["Keep provider-native identity outside the semantic oracle."],
      decisions: [
        {
          ticket: researchRef,
          gist: "Use the versioned capture seam.",
          sourceAnchor: {
            kind: "decision",
            target: nativeKind === "local" ? "map.md#decision-1" : "comment:decision-1",
          },
        },
      ],
      fog: ["Whether one source comment can be uniquely identified as an Answer."],
      outOfScope: [
        {
          ticket: grillingRef,
          rationale: "Do not build a universal tracker ontology.",
          sourceAnchor: {
            kind: "disposition",
            target: nativeKind === "local" ? "map.md#out-of-scope-1" : "comment:out-of-scope-1",
          },
        },
      ],
      lifecycle: { state: "active" },
      semanticSections: [
        ...availableSections(
          "map.destination",
          "map.notes",
          "map.decisions",
          "map.fog",
          "map.out-of-scope",
        ),
        { role: "map.resolution-evidence", availability: "confirmed-empty" },
      ],
      native: nativeEvidence(nativeKind, "map", 1),
    },
    spec: {
      kind: "spec",
      ref: specRef,
      title: "Reference Spec",
      sections: [
        {
          role: "problem",
          title: "Problem Statement",
          body: "Local and GitHub must preserve the same accepted semantics.",
          availability: "available",
        },
        {
          role: "solution",
          title: "Solution",
          body: "Capture one concrete Matt scope through a versioned provider seam.",
          availability: "available",
        },
        {
          role: "user-stories",
          title: "User Stories",
          body: "A consumer can distinguish workflow truth without native identity coupling.",
          availability: "available",
        },
        {
          role: "implementation",
          title: "Implementation Decisions",
          body: "Keep provider-specific projection behind a provider-neutral wrapper.",
          availability: "available",
        },
        {
          role: "testing",
          title: "Testing Decisions",
          body: "Compare public provider captures through a test-owned oracle.",
          availability: "available",
        },
        {
          role: "out-of-scope",
          title: "Out of Scope",
          body: "Do not build a generic tracker ontology.",
          availability: "available",
        },
        {
          role: "further-notes",
          title: "Further Notes",
          body: "Opaque relation references are capture-local.",
          availability: "available",
        },
      ],
      lifecycle: { state: "ready-for-agent" },
      semanticSections: availableSections(
        "spec.problem",
        "spec.solution",
        "spec.user-stories",
        "spec.implementation",
        "spec.testing",
        "spec.out-of-scope",
        "spec.further-notes",
      ),
      native: nativeEvidence(nativeKind, "spec", 2),
    },
    wayfinderTickets: [
      {
        kind: "wayfinder-ticket",
        ref: researchRef,
        title: "Research the semantic contract",
        subtype: "research",
        question: "Which semantics are durable?",
        claim: { state: "claimed", claimant: "lago" },
        answer: {
          availability: "available",
          content: {
            role: "answer",
            body: "Preserve workflow-specific lifecycle and evidence.",
            sourceAnchor: {
              kind: "answer",
              target: nativeKind === "local" ? "research.md#answer" : "comment:answer-1",
            },
          },
        },
        comments: [
          {
            role: "ordinary-comment",
            body: "This comment is not the Answer.",
            nativeIdentity: nativeKind === "local" ? "comment:local-1" : "comment:github-1",
          },
        ],
        lifecycle: {
          state: "resolved-on-route",
          decisionSource: {
            kind: "decision",
            target: nativeKind === "local" ? "map.md#decision-1" : "comment:decision-1",
          },
        },
        trackerClosure: {
          state: "closed",
          disposition: "completed",
          observedAt: "2026-07-01T00:00:00Z",
        },
        semanticSections: availableSections(
          "wayfinder.question",
          "wayfinder.claim",
          "wayfinder.answer",
          "wayfinder.comments",
        ),
        native: nativeEvidence(nativeKind, "research", 3),
      },
      {
        kind: "wayfinder-ticket",
        ref: prototypeRef,
        title: "Prototype the capture seam",
        subtype: "prototype",
        question: "Does one capture preserve all axes?",
        claim: { state: "unclaimed" },
        answer: { availability: "unavailable", reason: "no-unique-native-reference" },
        comments: [],
        lifecycle: { state: "open" },
        trackerClosure: { state: "open" },
        semanticSections: [
          ...availableSections("wayfinder.question", "wayfinder.claim"),
          { role: "wayfinder.answer", availability: "unavailable" },
          { role: "wayfinder.comments", availability: "confirmed-empty" },
        ],
        native: nativeEvidence(nativeKind, "prototype", 4),
      },
      {
        kind: "wayfinder-ticket",
        ref: grillingRef,
        title: "Grill the ontology boundary",
        subtype: "grilling",
        question: "What must remain provider-specific?",
        claim: { state: "claimed", claimant: "blue" },
        answer: { availability: "unavailable", reason: "not-authored" },
        comments: [],
        lifecycle: {
          state: "ruled-out-of-scope",
          dispositionSource: {
            kind: "disposition",
            target: nativeKind === "local" ? "map.md#out-of-scope-1" : "comment:out-of-scope-1",
          },
        },
        trackerClosure: {
          state: "closed",
          disposition: "wontfix",
          observedAt: "2026-07-02T00:00:00Z",
        },
        semanticSections: [
          ...availableSections("wayfinder.question", "wayfinder.claim"),
          { role: "wayfinder.answer", availability: "confirmed-empty" },
          { role: "wayfinder.comments", availability: "confirmed-empty" },
        ],
        native: nativeEvidence(nativeKind, "grilling", 5),
      },
      {
        kind: "wayfinder-ticket",
        ref: taskRef,
        title: "Record the accepted decision",
        subtype: "task",
        question: "Can the decision be written durably?",
        claim: { state: "claimed", claimant: "lago" },
        answer: { availability: "unavailable", reason: "no-unique-native-reference" },
        comments: [
          {
            role: "agent-brief",
            body: "Write only the accepted resolution.",
          },
        ],
        lifecycle: { state: "open" },
        trackerClosure: { state: "open" },
        semanticSections: [
          ...availableSections("wayfinder.question", "wayfinder.claim", "wayfinder.comments"),
          { role: "wayfinder.answer", availability: "unavailable" },
        ],
        native: nativeEvidence(nativeKind, "task", 6),
      },
    ],
    deliveryTickets: [
      {
        kind: "delivery-ticket",
        ref: deliveryOneRef,
        title: "Implement provider capture",
        whatToBuild: "A versioned capture seam.",
        acceptanceCriteria: [
          "Return independent state, freshness and completion.",
          "Keep the capture immutable.",
        ],
        lifecycle: { state: "completed", evidence: ["verification:delivery-one"] },
        trackerClosure: { state: "open" },
        comments: [
          {
            role: "triage-note",
            body: "Delivery completion is not tracker closure.",
          },
        ],
        semanticSections: availableSections(
          "delivery.what-to-build",
          "delivery.acceptance-criteria",
          "delivery.completion-evidence",
          "delivery.comments",
        ),
        native: nativeEvidence(nativeKind, "delivery", 7),
      },
      {
        kind: "delivery-ticket",
        ref: deliveryTwoRef,
        title: "Integrate provider capture",
        whatToBuild: "A single-generation consumer path.",
        acceptanceCriteria: ["Reuse the same capture downstream."],
        lifecycle: { state: "completion-unavailable", reason: "source-contract-gap" },
        trackerClosure: {
          state: "closed",
          disposition: "completed",
          observedAt: "2026-07-03T00:00:00Z",
        },
        comments: [],
        semanticSections: [
          ...availableSections("delivery.what-to-build", "delivery.acceptance-criteria"),
          { role: "delivery.completion-evidence", availability: "unavailable" },
          { role: "delivery.comments", availability: "confirmed-empty" },
        ],
        native: nativeEvidence(nativeKind, "delivery", 8),
      },
    ],
    incomingIssues: [
      {
        kind: "incoming-issue",
        ref: incomingRef,
        title: "Support a custom-mapped enhancement",
        classification: {
          category: "enhancement",
          state: "ready-for-agent",
          nativeCategory: "custom-enhancement",
          nativeState: "custom-ready",
        },
        content: [
          {
            role: "source-anchor",
            body: "External customer report.",
            sourceAnchor: {
              kind: "external",
              target: "https://example.com/customer-report",
            },
          },
        ],
        lifecycle: { state: "open" },
        semanticSections: availableSections(
          "incoming.classification",
          "incoming.content",
          "incoming.routing",
        ),
        native: nativeEvidence(nativeKind, "incoming", 9),
      },
    ],
    graph: {
      parentChild: [
        { parent: mapRef, child: researchRef, evidence: "matt-contract" },
        { parent: mapRef, child: prototypeRef, evidence: "matt-contract" },
        { parent: mapRef, child: grillingRef, evidence: "matt-contract" },
        { parent: mapRef, child: taskRef, evidence: "matt-contract" },
        { parent: specRef, child: deliveryOneRef, evidence: "matt-contract" },
        { parent: specRef, child: deliveryTwoRef, evidence: "matt-contract" },
      ],
      blockedBy: [
        { blocked: prototypeRef, blocker: researchRef, evidence: "matt-contract" },
        { blocked: deliveryTwoRef, blocker: deliveryOneRef, evidence: "matt-contract" },
      ],
    },
  };
};

export const createMattReferenceAliases = (
  nativeKind: NativeKind,
): Readonly<Record<string, string>> => ({
  [String(scenarioRef(nativeKind, "map"))]: "map",
  [String(scenarioRef(nativeKind, "spec"))]: "spec",
  [String(scenarioRef(nativeKind, "research"))]: "research",
  [String(scenarioRef(nativeKind, "prototype"))]: "prototype",
  [String(scenarioRef(nativeKind, "grilling"))]: "grilling",
  [String(scenarioRef(nativeKind, "task"))]: "task",
  [String(scenarioRef(nativeKind, "delivery-one"))]: "delivery-one",
  [String(scenarioRef(nativeKind, "delivery-two"))]: "delivery-two",
  [String(scenarioRef(nativeKind, "incoming-enhancement"))]: "incoming-enhancement",
});

export const createMattReferenceProvider = (nativeKind: NativeKind): MattSkillsV1Provider => ({
  id: "matt-skills/v1",
  capture: async (binding) =>
    createProviderScopeObservation({
      provider: "matt-skills/v1",
      binding,
      state: "partial",
      freshness: {
        assessment: "current",
        capturedAt: "2026-07-28T00:00:00Z",
        sourceRevision: `${nativeKind}:reference-revision`,
        evidence: [{ kind: "reference-fixture", value: nativeKind }],
      },
      coverage: {
        assessment: "incomplete",
        dimensions: [
          { key: "scope-membership", state: "covered" },
          {
            key: "answer",
            state: "gap",
            detail: "At least one Answer has no unique native reference.",
          },
        ],
      },
      completion: "undetermined",
      diagnostics: [
        {
          code: "matt.answer.unavailable",
          class: "mapping",
          impact: "blocking",
          target: binding.nativeScope,
          message: "At least one Answer has no unique native reference.",
        },
      ],
      projection: createMattReferenceProjection(nativeKind),
    }),
});

export const expectedMattReferenceSemantics: MattReferenceSemanticView = {
  capture: {
    state: "partial",
    freshness: "current",
    coverage: "incomplete",
    completion: "undetermined",
    coverageDimensions: ["scope-membership:covered", "answer:gap"],
    diagnostics: ["matt.answer.unavailable:mapping:blocking"],
  },
  map: {
    title: "Reference Map",
    destination: "Prove one complete Matt-native semantic scope.",
    notes: ["Keep provider-native identity outside the semantic oracle."],
    decisions: [
      {
        ticket: "research",
        gist: "Use the versioned capture seam.",
        sourceKind: "decision",
      },
    ],
    fog: ["Whether one source comment can be uniquely identified as an Answer."],
    outOfScope: [
      {
        ticket: "grilling",
        rationale: "Do not build a universal tracker ontology.",
        sourceKind: "disposition",
      },
    ],
    lifecycle: "active",
  },
  spec: {
    title: "Reference Spec",
    lifecycle: "ready-for-agent",
    sections: [
      {
        role: "problem",
        title: "Problem Statement",
        body: "Local and GitHub must preserve the same accepted semantics.",
      },
      {
        role: "solution",
        title: "Solution",
        body: "Capture one concrete Matt scope through a versioned provider seam.",
      },
      {
        role: "user-stories",
        title: "User Stories",
        body: "A consumer can distinguish workflow truth without native identity coupling.",
      },
      {
        role: "implementation",
        title: "Implementation Decisions",
        body: "Keep provider-specific projection behind a provider-neutral wrapper.",
      },
      {
        role: "testing",
        title: "Testing Decisions",
        body: "Compare public provider captures through a test-owned oracle.",
      },
      {
        role: "out-of-scope",
        title: "Out of Scope",
        body: "Do not build a generic tracker ontology.",
      },
      {
        role: "further-notes",
        title: "Further Notes",
        body: "Opaque relation references are capture-local.",
      },
    ],
  },
  wayfinder: [
    {
      ref: "research",
      title: "Research the semantic contract",
      subtype: "research",
      question: "Which semantics are durable?",
      claim: { state: "claimed", claimantAmbiguous: undefined },
      answer: {
        availability: "available",
        body: "Preserve workflow-specific lifecycle and evidence.",
        sourceKind: "answer",
      },
      lifecycle: "resolved-on-route",
      closure: "closed:completed",
      comments: [
        {
          role: "ordinary-comment",
          body: "This comment is not the Answer.",
          sourceKind: undefined,
        },
      ],
    },
    {
      ref: "prototype",
      title: "Prototype the capture seam",
      subtype: "prototype",
      question: "Does one capture preserve all axes?",
      claim: { state: "unclaimed" },
      answer: {
        availability: "unavailable",
        reason: "no-unique-native-reference",
      },
      lifecycle: "open",
      closure: "open",
      comments: [],
    },
    {
      ref: "grilling",
      title: "Grill the ontology boundary",
      subtype: "grilling",
      question: "What must remain provider-specific?",
      claim: { state: "claimed", claimantAmbiguous: undefined },
      answer: { availability: "unavailable", reason: "not-authored" },
      lifecycle: "ruled-out-of-scope",
      closure: "closed:wontfix",
      comments: [],
    },
    {
      ref: "task",
      title: "Record the accepted decision",
      subtype: "task",
      question: "Can the decision be written durably?",
      claim: { state: "claimed", claimantAmbiguous: undefined },
      answer: {
        availability: "unavailable",
        reason: "no-unique-native-reference",
      },
      lifecycle: "open",
      closure: "open",
      comments: [
        {
          role: "agent-brief",
          body: "Write only the accepted resolution.",
          sourceKind: undefined,
        },
      ],
    },
  ],
  delivery: [
    {
      ref: "delivery-one",
      title: "Implement provider capture",
      whatToBuild: "A versioned capture seam.",
      acceptanceCriteria: [
        "Return independent state, freshness and completion.",
        "Keep the capture immutable.",
      ],
      lifecycle: { state: "completed" },
      closure: "open",
      comments: [
        {
          role: "triage-note",
          body: "Delivery completion is not tracker closure.",
          sourceKind: undefined,
        },
      ],
    },
    {
      ref: "delivery-two",
      title: "Integrate provider capture",
      whatToBuild: "A single-generation consumer path.",
      acceptanceCriteria: ["Reuse the same capture downstream."],
      lifecycle: {
        state: "completion-unavailable",
        reason: "source-contract-gap",
      },
      closure: "closed:completed",
      comments: [],
    },
  ],
  incoming: [
    {
      ref: "incoming-enhancement",
      title: "Support a custom-mapped enhancement",
      classification: {
        category: "enhancement",
        state: "ready-for-agent",
      },
      lifecycle: "open",
      content: [
        {
          role: "source-anchor",
          body: "External customer report.",
          sourceKind: "external",
        },
      ],
    },
  ],
  parentChild: [
    "map>research",
    "map>prototype",
    "map>grilling",
    "map>task",
    "spec>delivery-one",
    "spec>delivery-two",
  ],
  blockedBy: ["prototype<research", "delivery-two<delivery-one"],
};
