import { z } from "zod";
import {
  type DocumentPresentation,
  type DocumentPresentationSection,
  documentPresentationSchema,
} from "../../document-presentation";
import {
  hasConsistentProviderCompletion,
  providerObservationIdentityFor,
} from "../../native-work-provider";
import { projectedNativeTimeSchema } from "../../source-event-time";
import type { MattObjectReference } from "./model";

const nonEmpty = z.string().min(1);
const semanticItem = z.string().refine((value) => value.trim().length > 0, {
  message: "Semantic collection items must contain non-whitespace text.",
});
const reference = nonEmpty.transform((value): MattObjectReference => value as MattObjectReference);

const sourceAnchorSchema = z.strictObject({
  kind: z.enum(["source", "external", "decision", "answer", "disposition"]),
  target: nonEmpty,
});

const rawFacetSchema = z.strictObject({
  key: nonEmpty,
  values: z.array(z.string()),
});

const semanticSectionSchema = z.strictObject({
  role: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u),
  availability: z.enum(["available", "confirmed-empty", "unavailable", "unsupported"]),
});

const nativeEventTimeSchema = projectedNativeTimeSchema;

const validateNativeTimeBasis = (
  time: z.infer<typeof nativeEventTimeSchema>,
  nativeKind: "local" | "github",
  context: z.RefinementCtx,
  path: readonly (string | number)[],
): void => {
  if (time.availability !== "available") return;
  const expected = nativeKind === "github" ? "source-event" : "inferred-source-metadata";
  if (time.basis === expected) return;
  context.addIssue({
    code: "custom",
    path: [...path],
    message: `${nativeKind === "github" ? "GitHub" : "Local Markdown"} projected time must use ${expected} basis.`,
  });
};

const exactSemanticSections = (roles: readonly string[]) =>
  z.array(semanticSectionSchema).superRefine((sections, context) => {
    const actual = sections.map((section) => section.role);
    for (const role of roles) {
      if (!actual.includes(role)) {
        context.addIssue({
          code: "custom",
          message: `Required semantic role ${role} is missing.`,
        });
      }
    }
    for (const [index, role] of actual.entries()) {
      if (!roles.includes(role) || actual.indexOf(role) !== index) {
        context.addIssue({
          code: "custom",
          path: [index, "role"],
          message: `Semantic role ${role} is unexpected or duplicated.`,
        });
      }
    }
  });

type SemanticSection = z.infer<typeof semanticSectionSchema>;

const validateSemanticContent = (
  sections: readonly SemanticSection[],
  role: string,
  hasContent: boolean,
  context: z.RefinementCtx,
): void => {
  const position = sections.findIndex((section) => section.role === role);
  if (position < 0) return;
  const availability = sections[position]?.availability;
  if (
    (hasContent && availability === "available") ||
    (!hasContent && availability !== "available")
  ) {
    return;
  }
  context.addIssue({
    code: "custom",
    path: ["semanticSections", position, "availability"],
    message: hasContent
      ? `${role} must be available when its semantic content is present.`
      : `${role} cannot be available when its semantic content is empty.`,
  });
};

const validateDocumentSemanticAvailability = (
  sections: readonly SemanticSection[],
  role: string,
  availability: "available" | "confirmed-empty" | "unavailable",
  context: z.RefinementCtx,
): void => {
  const position = sections.findIndex((section) => section.role === role);
  if (position < 0 || sections[position]?.availability === availability) return;
  context.addIssue({
    code: "custom",
    path: ["semanticSections", position, "availability"],
    message: `${role} document and semantic availability must agree.`,
  });
};

const authoredDocumentRoleSection = (
  document: DocumentPresentation,
  role: string,
  context: z.RefinementCtx,
  path: readonly (string | number)[],
): DocumentPresentationSection | undefined => {
  const roleSections = document.sections.filter((section) => section.semanticRole === role);
  const hasForeignSemanticRole = document.sections.some(
    (section) => section.semanticRole !== undefined && section.semanticRole !== role,
  );
  if (roleSections.length === 1 && !hasForeignSemanticRole) return roleSections[0];
  context.addIssue({
    code: "custom",
    path: [...path],
    message: `${role} requires one semantic section; additive sections must stay provider-generic.`,
  });
  return undefined;
};

const validateAuthoredDocumentCollection = (
  documents: readonly Readonly<{ document: DocumentPresentation }>[],
  sections: readonly SemanticSection[],
  role: string,
  pathKey: "comments" | "content",
  context: z.RefinementCtx,
): void => {
  for (const [index, document] of documents.entries()) {
    authoredDocumentRoleSection(document.document, role, context, [
      pathKey,
      index,
      "document",
      "sections",
    ]);
  }
  if (documents.length === 0) {
    validateSemanticContent(sections, role, false, context);
    return;
  }
  validateDocumentSemanticAvailability(
    sections,
    role,
    documents.every(
      (document) =>
        document.document.sections.find((section) => section.semanticRole === role)
          ?.availability === "available",
    )
      ? "available"
      : "unavailable",
    context,
  );
};

const trackerClosureSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("open") }),
  z.strictObject({
    state: z.literal("closed"),
    disposition: z.enum(["completed", "wontfix", "not-planned", "unknown"]),
    closedAt: nativeEventTimeSchema,
    actor: nonEmpty.optional(),
  }),
]);

const localEvidenceSchema = z
  .strictObject({
    kind: z.literal("local"),
    identity: z.strictObject({ locator: nonEmpty }),
    createdAt: nativeEventTimeSchema,
    lastUpdated: nativeEventTimeSchema,
    sourceAnchors: z.array(sourceAnchorSchema),
    rawFacets: z.array(rawFacetSchema),
  })
  .superRefine((evidence, context) => {
    for (const [key, time] of [
      ["createdAt", evidence.createdAt],
      ["lastUpdated", evidence.lastUpdated],
    ] as const) {
      validateNativeTimeBasis(time, "local", context, [key]);
    }
  });

const githubEvidenceSchema = z
  .strictObject({
    kind: z.literal("github"),
    identity: z.strictObject({
      repositoryDatabaseId: nonEmpty,
      repositoryNodeId: nonEmpty,
      objectKind: z.enum(["issue", "pull-request"]),
      objectDatabaseId: nonEmpty,
      objectNodeId: nonEmpty,
      number: z.number().int().positive(),
      url: z
        .string()
        .url()
        .refine((value) => {
          const protocol = new URL(value).protocol;
          return protocol === "https:" || protocol === "http:";
        }),
      owner: nonEmpty,
      repository: nonEmpty,
    }),
    createdAt: nativeEventTimeSchema,
    lastUpdated: nativeEventTimeSchema,
    trackerClosure: trackerClosureSchema,
    sourceAnchors: z.array(sourceAnchorSchema),
    rawFacets: z.array(rawFacetSchema),
  })
  .superRefine((evidence, context) => {
    validateNativeTimeBasis(evidence.createdAt, "github", context, ["createdAt"]);
    validateNativeTimeBasis(evidence.lastUpdated, "github", context, ["lastUpdated"]);
    if (evidence.trackerClosure.state === "closed") {
      validateNativeTimeBasis(evidence.trackerClosure.closedAt, "github", context, [
        "trackerClosure",
        "closedAt",
      ]);
    }
  });

const nativeEvidenceSchema = z.discriminatedUnion("kind", [
  localEvidenceSchema,
  githubEvidenceSchema,
]);

const providerAuthoredDocumentShape = {
  document: documentPresentationSchema,
  authoredAt: nativeEventTimeSchema,
  sourceAnchor: sourceAnchorSchema.optional(),
  nativeIdentity: nonEmpty.optional(),
  author: nonEmpty.optional(),
};

const answerSchema = z.discriminatedUnion("availability", [
  z.strictObject({
    availability: z.literal("available"),
    content: z.strictObject({
      ...providerAuthoredDocumentShape,
      role: z.literal("answer"),
    }),
  }),
  z.strictObject({
    availability: z.literal("unavailable"),
    reason: z.enum(["not-authored", "no-unique-native-reference", "source-contract-gap"]),
  }),
]);

const mapSchema = z
  .strictObject({
    kind: z.literal("map"),
    ref: reference,
    title: nonEmpty,
    destination: documentPresentationSchema,
    notes: z.array(semanticItem),
    decisions: z.array(
      z.strictObject({
        ticket: reference.optional(),
        gist: semanticItem,
        sourceAnchor: sourceAnchorSchema,
      }),
    ),
    fog: z.array(semanticItem),
    outOfScope: z.array(
      z.strictObject({
        ticket: reference.optional(),
        rationale: semanticItem,
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
    semanticSections: exactSemanticSections([
      "map.destination",
      "map.notes",
      "map.decisions",
      "map.fog",
      "map.out-of-scope",
      "map.resolution-evidence",
    ]),
    native: nativeEvidenceSchema,
  })
  .superRefine((map, context) => {
    const destination = authoredDocumentRoleSection(map.destination, "map.destination", context, [
      "destination",
      "sections",
    ]);
    if (destination !== undefined) {
      validateDocumentSemanticAvailability(
        map.semanticSections,
        "map.destination",
        destination.availability,
        context,
      );
    }
    validateSemanticContent(map.semanticSections, "map.notes", map.notes.length > 0, context);
    validateSemanticContent(
      map.semanticSections,
      "map.decisions",
      map.decisions.length > 0,
      context,
    );
    validateSemanticContent(map.semanticSections, "map.fog", map.fog.length > 0, context);
    validateSemanticContent(
      map.semanticSections,
      "map.out-of-scope",
      map.outOfScope.length > 0,
      context,
    );
    validateSemanticContent(
      map.semanticSections,
      "map.resolution-evidence",
      map.lifecycle.state === "resolved" && map.lifecycle.resolutionEvidence.length > 0,
      context,
    );
  });

const specSchema = z
  .strictObject({
    kind: z.literal("spec"),
    ref: reference,
    title: nonEmpty,
    document: documentPresentationSchema,
    lifecycle: z.strictObject({ state: z.enum(["draft", "ready-for-agent", "superseded"]) }),
    semanticSections: exactSemanticSections([
      "spec.problem",
      "spec.solution",
      "spec.user-stories",
      "spec.implementation",
      "spec.testing",
      "spec.out-of-scope",
      "spec.further-notes",
    ]),
    native: nativeEvidenceSchema,
  })
  .superRefine((spec, context) => {
    const knownRoles = spec.semanticSections.map((section) => section.role);
    for (const [position, section] of spec.document.sections.entries()) {
      if (section.semanticRole !== undefined && !knownRoles.includes(section.semanticRole)) {
        context.addIssue({
          code: "custom",
          path: ["document", "sections", position, "semanticRole"],
          message: `Spec document semantic role ${section.semanticRole} is not provider-owned.`,
        });
      }
    }
    for (const [position, semantic] of spec.semanticSections.entries()) {
      const section = spec.document.sections.find(
        (candidate) => candidate.semanticRole === semantic.role,
      );
      const expected = section?.availability ?? "unavailable";
      if (semantic.availability !== expected) {
        context.addIssue({
          code: "custom",
          path: ["semanticSections", position, "availability"],
          message: `${semantic.role} document and semantic availability must agree.`,
        });
      }
    }
  });

const wayfinderTicketSchema = z
  .strictObject({
    kind: z.literal("wayfinder-ticket"),
    ref: reference,
    title: nonEmpty,
    subtype: z.enum(["research", "prototype", "grilling", "task"]),
    question: documentPresentationSchema,
    claim: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("unclaimed") }),
      z.strictObject({
        state: z.literal("claimed"),
        claimant: nonEmpty.optional(),
        claimantAmbiguous: z.boolean().optional(),
      }),
    ]),
    answer: answerSchema,
    comments: z.array(
      z.strictObject({
        ...providerAuthoredDocumentShape,
        role: z.enum(["ordinary-comment", "agent-brief", "triage-note"]),
      }),
    ),
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
    semanticSections: exactSemanticSections([
      "wayfinder.question",
      "wayfinder.claim",
      "wayfinder.answer",
      "wayfinder.comments",
    ]),
    native: nativeEvidenceSchema,
  })
  .superRefine((ticket, context) => {
    validateSemanticContent(ticket.semanticSections, "wayfinder.claim", true, context);
    const question = authoredDocumentRoleSection(ticket.question, "wayfinder.question", context, [
      "question",
      "sections",
    ]);
    if (question !== undefined) {
      validateDocumentSemanticAvailability(
        ticket.semanticSections,
        "wayfinder.question",
        question.availability,
        context,
      );
    }
    if (ticket.answer.availability === "available") {
      const answerSection = authoredDocumentRoleSection(
        ticket.answer.content.document,
        "wayfinder.answer",
        context,
        ["answer", "content", "document", "sections"],
      );
      if (answerSection !== undefined && answerSection.availability !== "available") {
        context.addIssue({
          code: "custom",
          path: ["answer", "content", "document", "sections"],
          message:
            "An available Wayfinder Answer requires one available provider document section.",
        });
      } else if (answerSection !== undefined) {
        validateDocumentSemanticAvailability(
          ticket.semanticSections,
          "wayfinder.answer",
          answerSection.availability,
          context,
        );
      }
    } else {
      validateSemanticContent(ticket.semanticSections, "wayfinder.answer", false, context);
    }
    validateAuthoredDocumentCollection(
      ticket.comments,
      ticket.semanticSections,
      "wayfinder.comments",
      "comments",
      context,
    );
    if (ticket.trackerClosure.state === "closed") {
      validateNativeTimeBasis(ticket.trackerClosure.closedAt, ticket.native.kind, context, [
        "trackerClosure",
        "closedAt",
      ]);
    }
    if (ticket.answer.availability === "available") {
      validateNativeTimeBasis(ticket.answer.content.authoredAt, ticket.native.kind, context, [
        "answer",
        "content",
        "authoredAt",
      ]);
    }
    for (const [index, comment] of ticket.comments.entries()) {
      if (!("authoredAt" in comment)) continue;
      validateNativeTimeBasis(comment.authoredAt, ticket.native.kind, context, [
        "comments",
        index,
        "authoredAt",
      ]);
    }
  });

const deliveryTicketSchema = z
  .strictObject({
    kind: z.literal("delivery-ticket"),
    ref: reference,
    title: nonEmpty,
    whatToBuild: z.string(),
    acceptanceCriteria: z.array(semanticItem),
    lifecycle: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("open") }),
      z.strictObject({ state: z.literal("completed"), evidence: z.array(semanticItem) }),
      z.strictObject({
        state: z.literal("completion-unavailable"),
        reason: z.enum(["source-contract-gap", "incomplete-writeback", "ambiguous-evidence"]),
      }),
    ]),
    trackerClosure: trackerClosureSchema,
    comments: z.array(
      z.strictObject({
        ...providerAuthoredDocumentShape,
        role: z.enum(["ordinary-comment", "agent-brief", "triage-note"]),
      }),
    ),
    semanticSections: exactSemanticSections([
      "delivery.what-to-build",
      "delivery.acceptance-criteria",
      "delivery.completion-evidence",
      "delivery.comments",
    ]),
    native: nativeEvidenceSchema,
  })
  .superRefine((ticket, context) => {
    validateSemanticContent(
      ticket.semanticSections,
      "delivery.what-to-build",
      ticket.whatToBuild.trim().length > 0,
      context,
    );
    validateSemanticContent(
      ticket.semanticSections,
      "delivery.acceptance-criteria",
      ticket.acceptanceCriteria.length > 0,
      context,
    );
    validateSemanticContent(
      ticket.semanticSections,
      "delivery.completion-evidence",
      ticket.lifecycle.state === "completed" && ticket.lifecycle.evidence.length > 0,
      context,
    );
    validateAuthoredDocumentCollection(
      ticket.comments,
      ticket.semanticSections,
      "delivery.comments",
      "comments",
      context,
    );
    if (ticket.trackerClosure.state === "closed") {
      validateNativeTimeBasis(ticket.trackerClosure.closedAt, ticket.native.kind, context, [
        "trackerClosure",
        "closedAt",
      ]);
    }
    for (const [index, comment] of ticket.comments.entries()) {
      if (!("authoredAt" in comment)) continue;
      validateNativeTimeBasis(comment.authoredAt, ticket.native.kind, context, [
        "comments",
        index,
        "authoredAt",
      ]);
    }
  });

const incomingIssueSchema = z
  .strictObject({
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
    content: z.array(
      z.strictObject({
        ...providerAuthoredDocumentShape,
        role: z.enum(["issue-body", "ordinary-comment", "agent-brief", "triage-note"]),
      }),
    ),
    lifecycle: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("open") }),
      z.strictObject({
        state: z.literal("closed"),
        disposition: z.enum(["completed", "wontfix", "not-planned", "unknown"]),
        closedAt: nativeEventTimeSchema,
      }),
    ]),
    semanticSections: exactSemanticSections([
      "incoming.classification",
      "incoming.content",
      "incoming.routing",
    ]),
    native: nativeEvidenceSchema,
  })
  .superRefine((issue, context) => {
    validateSemanticContent(
      issue.semanticSections,
      "incoming.classification",
      issue.classification.category === "bug" || issue.classification.category === "enhancement",
      context,
    );
    validateAuthoredDocumentCollection(
      issue.content,
      issue.semanticSections,
      "incoming.content",
      "content",
      context,
    );
    validateSemanticContent(
      issue.semanticSections,
      "incoming.routing",
      issue.classification.state !== "unknown" && issue.classification.state !== "ambiguous",
      context,
    );
    if (issue.lifecycle.state === "closed") {
      validateNativeTimeBasis(issue.lifecycle.closedAt, issue.native.kind, context, [
        "lifecycle",
        "closedAt",
      ]);
    }
    for (const [index, content] of issue.content.entries()) {
      if (!("authoredAt" in content)) continue;
      validateNativeTimeBasis(content.authoredAt, issue.native.kind, context, [
        "content",
        index,
        "authoredAt",
      ]);
    }
  });

export const mattScopeProjectionSchema = z
  .strictObject({
    map: mapSchema.optional(),
    spec: specSchema.optional(),
    wayfinderTickets: z.array(wayfinderTicketSchema),
    deliveryTickets: z.array(deliveryTicketSchema),
    incomingIssues: z.array(incomingIssueSchema),
    structuralOrder: z.array(reference),
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
  })
  .superRefine((projection, context) => {
    const references = [
      ...(projection.map === undefined ? [] : [projection.map.ref]),
      ...(projection.spec === undefined ? [] : [projection.spec.ref]),
      ...projection.wayfinderTickets.map((ticket) => ticket.ref),
      ...projection.deliveryTickets.map((ticket) => ticket.ref),
      ...projection.incomingIssues.map((issue) => issue.ref),
    ];
    const expected = new Set(references);
    const actual = new Set(projection.structuralOrder);
    if (
      expected.size === references.length &&
      actual.size === projection.structuralOrder.length &&
      expected.size === actual.size &&
      [...expected].every((reference) => actual.has(reference))
    ) {
      return;
    }
    context.addIssue({
      code: "custom",
      path: ["structuralOrder"],
      message:
        "Native structural order must contain every projected object reference exactly once.",
    });
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
