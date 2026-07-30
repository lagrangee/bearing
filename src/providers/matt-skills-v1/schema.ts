import { z } from "zod";
import {
  hasConsistentProviderCompletion,
  providerObservationIdentityFor,
} from "../../native-work-provider";

const nonEmpty = z.string().min(1);
const reference = nonEmpty;

const sourceAnchorSchema = z.strictObject({
  kind: z.enum(["source", "external", "decision", "answer", "disposition"]),
  target: nonEmpty,
});

const rawFacetSchema = z.strictObject({
  key: nonEmpty,
  values: z.array(z.string()),
});

const localEvidenceSchema = z.strictObject({
  kind: z.literal("local"),
  identity: z.strictObject({ locator: nonEmpty }),
  sourceAnchors: z.array(sourceAnchorSchema),
  rawFacets: z.array(rawFacetSchema),
});

const githubEvidenceSchema = z.strictObject({
  kind: z.literal("github"),
  identity: z.strictObject({
    repositoryDatabaseId: nonEmpty,
    repositoryNodeId: nonEmpty,
    objectKind: z.enum(["issue", "pull-request"]),
    objectDatabaseId: nonEmpty,
    objectNodeId: nonEmpty,
    number: z.number().int().positive(),
    url: nonEmpty,
    owner: nonEmpty,
    repository: nonEmpty,
  }),
  sourceAnchors: z.array(sourceAnchorSchema),
  rawFacets: z.array(rawFacetSchema),
});

const nativeEvidenceSchema = z.discriminatedUnion("kind", [
  localEvidenceSchema,
  githubEvidenceSchema,
]);

const contentSchema = z.strictObject({
  role: z.enum(["answer", "ordinary-comment", "agent-brief", "triage-note", "source-anchor"]),
  body: z.string(),
  sourceAnchor: sourceAnchorSchema.optional(),
  nativeIdentity: nonEmpty.optional(),
  author: nonEmpty.optional(),
  authoredAt: nonEmpty.optional(),
});

const answerSchema = z.discriminatedUnion("availability", [
  z.strictObject({
    availability: z.literal("available"),
    content: contentSchema.extend({ role: z.literal("answer") }),
  }),
  z.strictObject({
    availability: z.literal("unavailable"),
    reason: z.enum(["not-authored", "no-unique-native-reference", "source-contract-gap"]),
  }),
]);

const trackerClosureSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("open") }),
  z.strictObject({
    state: z.literal("closed"),
    disposition: z.enum(["completed", "wontfix", "not-planned", "unknown"]),
    observedAt: nonEmpty,
    actor: nonEmpty.optional(),
  }),
]);

const mapSchema = z.strictObject({
  kind: z.literal("map"),
  ref: reference,
  title: nonEmpty,
  destination: z.string(),
  notes: z.array(z.string()),
  decisions: z.array(
    z.strictObject({
      ticket: reference.optional(),
      gist: z.string(),
      sourceAnchor: sourceAnchorSchema,
    }),
  ),
  fog: z.array(z.string()),
  outOfScope: z.array(
    z.strictObject({
      ticket: reference.optional(),
      rationale: z.string(),
      sourceAnchor: sourceAnchorSchema,
    }),
  ),
  lifecycle: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("active") }),
    z.strictObject({
      state: z.literal("resolved"),
      resolutionEvidence: z.array(sourceAnchorSchema),
    }),
  ]),
  native: nativeEvidenceSchema,
});

const specSchema = z.strictObject({
  kind: z.literal("spec"),
  ref: reference,
  title: nonEmpty,
  sections: z.array(
    z.strictObject({
      role: z.enum([
        "problem",
        "solution",
        "user-stories",
        "implementation",
        "testing",
        "out-of-scope",
        "further-notes",
      ]),
      title: nonEmpty,
      body: z.string(),
    }),
  ),
  lifecycle: z.strictObject({ state: z.enum(["draft", "ready-for-agent", "superseded"]) }),
  native: nativeEvidenceSchema,
});

const wayfinderTicketSchema = z.strictObject({
  kind: z.literal("wayfinder-ticket"),
  ref: reference,
  title: nonEmpty,
  subtype: z.enum(["research", "prototype", "grilling", "task"]),
  question: z.string(),
  claim: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unclaimed") }),
    z.strictObject({
      state: z.literal("claimed"),
      claimant: nonEmpty.optional(),
      claimantAmbiguous: z.boolean().optional(),
    }),
  ]),
  answer: answerSchema,
  comments: z.array(contentSchema),
  lifecycle: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("open") }),
    z.strictObject({
      state: z.literal("resolved-on-route"),
      decisionSource: sourceAnchorSchema,
    }),
    z.strictObject({
      state: z.literal("ruled-out-of-scope"),
      dispositionSource: sourceAnchorSchema,
    }),
  ]),
  trackerClosure: trackerClosureSchema,
  native: nativeEvidenceSchema,
});

const deliveryTicketSchema = z.strictObject({
  kind: z.literal("delivery-ticket"),
  ref: reference,
  title: nonEmpty,
  whatToBuild: z.string(),
  acceptanceCriteria: z.array(z.string()),
  lifecycle: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("open") }),
    z.strictObject({ state: z.literal("completed"), evidence: z.array(z.string()) }),
    z.strictObject({
      state: z.literal("completion-unavailable"),
      reason: z.enum(["source-contract-gap", "incomplete-writeback", "ambiguous-evidence"]),
    }),
  ]),
  trackerClosure: trackerClosureSchema,
  comments: z.array(contentSchema),
  native: nativeEvidenceSchema,
});

const incomingIssueSchema = z.strictObject({
  kind: z.literal("incoming-issue"),
  ref: reference,
  title: nonEmpty,
  classification: z.strictObject({
    category: z.enum(["bug", "enhancement", "unknown", "ambiguous"]),
    state: z.enum([
      "needs-triage",
      "needs-info",
      "ready-for-agent",
      "ready-for-human",
      "wontfix",
      "unknown",
      "ambiguous",
    ]),
    nativeCategory: z.string().optional(),
    nativeState: z.string().optional(),
  }),
  content: z.array(contentSchema),
  lifecycle: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("open") }),
    z.strictObject({
      state: z.literal("closed"),
      disposition: z.enum(["completed", "wontfix", "not-planned", "unknown"]),
      observedAt: nonEmpty,
    }),
  ]),
  native: nativeEvidenceSchema,
});

export const mattScopeProjectionSchema = z.strictObject({
  map: mapSchema.optional(),
  spec: specSchema.optional(),
  wayfinderTickets: z.array(wayfinderTicketSchema),
  deliveryTickets: z.array(deliveryTicketSchema),
  incomingIssues: z.array(incomingIssueSchema),
  graph: z.strictObject({
    parentChild: z.array(
      z.strictObject({
        parent: reference,
        child: reference,
        evidence: z.enum(["matt-contract", "github-native", "matt-body-fallback"]),
      }),
    ),
    blockedBy: z.array(
      z.strictObject({
        blocked: reference,
        blocker: reference,
        evidence: z.enum(["matt-contract", "github-native", "matt-body-fallback"]),
      }),
    ),
  }),
});

const diagnosticSchema = z.strictObject({
  code: nonEmpty,
  class: z.enum([
    "source",
    "contract",
    "mapping",
    "permission",
    "acquisition",
    "network",
    "pagination",
    "format",
    "identity",
    "concurrency",
  ]),
  impact: z.enum(["blocking", "non-blocking"]),
  target: nonEmpty,
  message: nonEmpty,
});

const captureBase = {
  id: z.string().regex(/^provider-observation:sha256:[a-f0-9]{64}$/u),
  provider: z.literal("matt-skills/v1"),
  binding: z.strictObject({
    provider: z.literal("matt-skills/v1"),
    nativeScope: nonEmpty,
  }),
  observedAt: nonEmpty,
  sourceRevision: nonEmpty.optional(),
  sourceObservedAt: nonEmpty.optional(),
  validators: z.array(z.strictObject({ kind: nonEmpty, value: z.string() })),
  freshness: z.strictObject({
    assessment: z.enum(["current", "stale", "undetermined"]),
    evidence: z.array(z.strictObject({ kind: nonEmpty, value: z.string() })),
  }),
  coverage: z.strictObject({
    assessment: z.enum(["complete", "incomplete"]),
    dimensions: z.array(
      z.strictObject({
        key: nonEmpty,
        state: z.enum(["covered", "excluded", "gap", "conflict"]),
        detail: z.string().optional(),
      }),
    ),
  }),
  completion: z.enum(["incomplete", "complete", "undetermined"]),
  diagnostics: z.array(diagnosticSchema),
};

export const mattSkillsV1ProviderObservationSchema = z
  .discriminatedUnion("state", [
    z.strictObject({
      ...captureBase,
      state: z.enum(["available", "partial"]),
      projection: mattScopeProjectionSchema,
    }),
    z.strictObject({
      ...captureBase,
      state: z.enum(["absent", "invalid"]),
    }),
  ])
  .superRefine((capture, context) => {
    const { id, ...content } = capture;
    if (id !== providerObservationIdentityFor(content)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Provider observation identity must match its immutable semantic content.",
      });
    }
    if (!hasConsistentProviderCompletion(capture)) {
      context.addIssue({
        code: "custom",
        path: ["completion"],
        message:
          "Provider completion requires an available, current, fully covered capture without blocking diagnostics.",
      });
    }
  });
