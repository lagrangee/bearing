export type MattObjectReference = string & Readonly<{ __mattObjectReference: true }>;

export type MattSourceAnchor = Readonly<{
  kind: "source" | "external" | "decision" | "answer" | "disposition";
  target: string;
}>;

export type MattRawFacet = Readonly<{
  key: string;
  values: readonly string[];
}>;

export type MattSemanticSectionAvailability =
  | "available"
  | "confirmed-empty"
  | "unavailable"
  | "unsupported";

export type MattSemanticSection = Readonly<{
  role: string;
  availability: MattSemanticSectionAvailability;
}>;

export type MattNativeEvidence =
  | Readonly<{
      kind: "local";
      identity: Readonly<{
        locator: string;
      }>;
      sourceAnchors: readonly MattSourceAnchor[];
      rawFacets: readonly MattRawFacet[];
    }>
  | Readonly<{
      kind: "github";
      identity: Readonly<{
        repositoryDatabaseId: string;
        repositoryNodeId: string;
        objectKind: "issue" | "pull-request";
        objectDatabaseId: string;
        objectNodeId: string;
        number: number;
        url: string;
        owner: string;
        repository: string;
      }>;
      sourceAnchors: readonly MattSourceAnchor[];
      rawFacets: readonly MattRawFacet[];
    }>;

export type MattContent = Readonly<{
  role:
    | "answer"
    | "issue-body"
    | "ordinary-comment"
    | "agent-brief"
    | "triage-note"
    | "source-anchor";
  body: string;
  sourceAnchor?: MattSourceAnchor | undefined;
  nativeIdentity?: string | undefined;
  author?: string | undefined;
  authoredAt?: string | undefined;
}>;

export type MattAnswer =
  | Readonly<{
      availability: "available";
      content: MattContent & Readonly<{ role: "answer" }>;
    }>
  | Readonly<{
      availability: "unavailable";
      reason: "not-authored" | "no-unique-native-reference" | "source-contract-gap";
    }>;

export type MattTrackerClosure =
  | Readonly<{ state: "open" }>
  | Readonly<{
      state: "closed";
      disposition: "completed" | "wontfix" | "not-planned" | "unknown";
      observedAt: string;
      actor?: string | undefined;
    }>;

export type MattMap = Readonly<{
  kind: "map";
  ref: MattObjectReference;
  title: string;
  destination: string;
  notes: readonly string[];
  decisions: readonly Readonly<{
    ticket?: MattObjectReference | undefined;
    gist: string;
    sourceAnchor: MattSourceAnchor;
  }>[];
  fog: readonly string[];
  outOfScope: readonly Readonly<{
    ticket?: MattObjectReference | undefined;
    rationale: string;
    sourceAnchor: MattSourceAnchor;
  }>[];
  lifecycle:
    | Readonly<{ state: "active" }>
    | Readonly<{
        state: "resolved";
        resolutionEvidence: readonly MattSourceAnchor[];
      }>;
  semanticSections: readonly MattSemanticSection[];
  native: MattNativeEvidence;
}>;

export type MattSpec = Readonly<{
  kind: "spec";
  ref: MattObjectReference;
  title: string;
  sections: readonly Readonly<{
    role:
      | "problem"
      | "solution"
      | "user-stories"
      | "implementation"
      | "testing"
      | "out-of-scope"
      | "further-notes";
    title: string;
    body: string;
    availability: MattSemanticSectionAvailability;
  }>[];
  lifecycle: Readonly<{
    state: "draft" | "ready-for-agent" | "superseded";
  }>;
  semanticSections: readonly MattSemanticSection[];
  native: MattNativeEvidence;
}>;

export type MattWayfinderTicket = Readonly<{
  kind: "wayfinder-ticket";
  ref: MattObjectReference;
  title: string;
  subtype: "research" | "prototype" | "grilling" | "task";
  question: string;
  claim:
    | Readonly<{ state: "unclaimed" }>
    | Readonly<{
        state: "claimed";
        claimant?: string | undefined;
        claimantAmbiguous?: boolean | undefined;
      }>;
  answer: MattAnswer;
  comments: readonly MattContent[];
  lifecycle:
    | Readonly<{ state: "open" }>
    | Readonly<{
        state: "resolved-on-route";
        decisionSource: MattSourceAnchor;
      }>
    | Readonly<{
        state: "ruled-out-of-scope";
        dispositionSource: MattSourceAnchor;
      }>;
  trackerClosure: MattTrackerClosure;
  semanticSections: readonly MattSemanticSection[];
  native: MattNativeEvidence;
}>;

export type MattDeliveryTicket = Readonly<{
  kind: "delivery-ticket";
  ref: MattObjectReference;
  title: string;
  whatToBuild: string;
  acceptanceCriteria: readonly string[];
  lifecycle:
    | Readonly<{ state: "open" }>
    | Readonly<{
        state: "completed";
        evidence: readonly string[];
      }>
    | Readonly<{
        state: "completion-unavailable";
        reason: "source-contract-gap" | "incomplete-writeback" | "ambiguous-evidence";
      }>;
  trackerClosure: MattTrackerClosure;
  comments: readonly MattContent[];
  semanticSections: readonly MattSemanticSection[];
  native: MattNativeEvidence;
}>;

export type MattIncomingIssue = Readonly<{
  kind: "incoming-issue";
  ref: MattObjectReference;
  title: string;
  classification: Readonly<{
    category: "bug" | "enhancement" | "unknown" | "ambiguous";
    state:
      | "needs-triage"
      | "needs-info"
      | "ready-for-agent"
      | "ready-for-human"
      | "wontfix"
      | "unknown"
      | "ambiguous";
    nativeCategory?: string | undefined;
    nativeState?: string | undefined;
  }>;
  content: readonly MattContent[];
  lifecycle:
    | Readonly<{ state: "open" }>
    | Readonly<{
        state: "closed";
        disposition: "completed" | "wontfix" | "not-planned" | "unknown";
        observedAt: string;
      }>;
  semanticSections: readonly MattSemanticSection[];
  native: MattNativeEvidence;
}>;

export type MattParentChildRelation = Readonly<{
  parent: MattObjectReference;
  child: MattObjectReference;
  evidence: "matt-contract" | "github-native" | "matt-body-fallback";
}>;

export type MattBlockedByRelation = Readonly<{
  blocked: MattObjectReference;
  blocker: MattObjectReference;
  evidence: "matt-contract" | "github-native" | "matt-body-fallback";
}>;

export type MattScopeProjection = Readonly<{
  map?: MattMap | undefined;
  spec?: MattSpec | undefined;
  wayfinderTickets: readonly MattWayfinderTicket[];
  deliveryTickets: readonly MattDeliveryTicket[];
  incomingIssues: readonly MattIncomingIssue[];
  graph: Readonly<{
    parentChild: readonly MattParentChildRelation[];
    blockedBy: readonly MattBlockedByRelation[];
  }>;
}>;
