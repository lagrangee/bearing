import type { MattSkillsV1ScopeCapture } from "../../src/providers/matt-skills-v1/capture";
import type {
  MattScopeProjection,
  MattTrackerClosure,
} from "../../src/providers/matt-skills-v1/model";

const closureSemantic = (closure: MattTrackerClosure): string =>
  closure.state === "open" ? "open" : `closed:${closure.disposition}`;

const scenarioAlias = (aliases: Readonly<Record<string, string>>, reference: string): string => {
  const alias = aliases[reference];
  if (alias === undefined) {
    throw new TypeError(`Reference scenario alias is missing for ${reference}.`);
  }
  return alias;
};

type DeepReadonly<Value> = Value extends
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  ? Value
  : Value extends (...args: never[]) => unknown
    ? Value
    : Value extends readonly unknown[]
      ? Readonly<{ [Index in keyof Value]: DeepReadonly<Value[Index]> }>
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;

const answerSemantic = (answer: MattScopeProjection["wayfinderTickets"][number]["answer"]) =>
  answer.availability === "available"
    ? {
        availability: "available" as const,
        body: answer.content.body,
        sourceKind: answer.content.sourceAnchor?.kind,
      }
    : {
        availability: "unavailable" as const,
        reason: answer.reason,
      };

const contentSemantic = (
  content:
    | MattScopeProjection["wayfinderTickets"][number]["comments"][number]
    | MattScopeProjection["deliveryTickets"][number]["comments"][number]
    | MattScopeProjection["incomingIssues"][number]["content"][number],
) => ({
  role: content.role,
  body: content.body,
  sourceKind: content.sourceAnchor?.kind,
});

const buildMattReferenceSemanticView = (
  capture: MattSkillsV1ScopeCapture,
  aliases: Readonly<Record<string, string>>,
) => ({
  capture: {
    state: capture.state,
    freshness: capture.freshness.assessment,
    coverage: capture.coverage.assessment,
    completion: capture.completion,
    coverageDimensions: capture.coverage.dimensions.map(
      (dimension) => `${dimension.key}:${dimension.state}`,
    ),
    diagnostics: capture.diagnostics.map(
      (diagnostic) => `${diagnostic.code}:${diagnostic.class}:${diagnostic.impact}`,
    ),
  },
  map:
    capture.projection?.map === undefined
      ? undefined
      : {
          title: capture.projection.map.title,
          destination: capture.projection.map.destination,
          notes: capture.projection.map.notes,
          decisions: capture.projection.map.decisions.map((decision) => ({
            ...(decision.ticket === undefined
              ? {}
              : { ticket: scenarioAlias(aliases, String(decision.ticket)) }),
            gist: decision.gist,
            sourceKind: decision.sourceAnchor.kind,
          })),
          fog: capture.projection.map.fog,
          outOfScope: capture.projection.map.outOfScope.map((entry) => ({
            ...(entry.ticket === undefined
              ? {}
              : { ticket: scenarioAlias(aliases, String(entry.ticket)) }),
            rationale: entry.rationale,
            sourceKind: entry.sourceAnchor.kind,
          })),
          lifecycle: capture.projection.map.lifecycle.state,
        },
  spec:
    capture.projection?.spec === undefined
      ? undefined
      : {
          title: capture.projection.spec.title,
          lifecycle: capture.projection.spec.lifecycle.state,
          sections: capture.projection.spec.sections.map((section) => ({
            role: section.role,
            title: section.title,
            body: section.body,
          })),
        },
  wayfinder: (capture.projection?.wayfinderTickets ?? []).map((ticket) => ({
    ref: scenarioAlias(aliases, String(ticket.ref)),
    title: ticket.title,
    subtype: ticket.subtype,
    question: ticket.question,
    claim:
      ticket.claim.state === "unclaimed"
        ? { state: "unclaimed" as const }
        : {
            state: "claimed" as const,
            claimantAmbiguous: ticket.claim.claimantAmbiguous,
          },
    answer: answerSemantic(ticket.answer),
    lifecycle: ticket.lifecycle.state,
    closure: closureSemantic(ticket.trackerClosure),
    comments: ticket.comments.map(contentSemantic),
  })),
  delivery: (capture.projection?.deliveryTickets ?? []).map((ticket) => ({
    ref: scenarioAlias(aliases, String(ticket.ref)),
    title: ticket.title,
    whatToBuild: ticket.whatToBuild,
    acceptanceCriteria: ticket.acceptanceCriteria,
    lifecycle:
      ticket.lifecycle.state === "completed" ? { state: "completed" as const } : ticket.lifecycle,
    closure: closureSemantic(ticket.trackerClosure),
    comments: ticket.comments.map(contentSemantic),
  })),
  incoming: (capture.projection?.incomingIssues ?? []).map((issue) => ({
    ref: scenarioAlias(aliases, String(issue.ref)),
    title: issue.title,
    classification: {
      category: issue.classification.category,
      state: issue.classification.state,
    },
    lifecycle: issue.lifecycle.state,
    content: issue.content.map(contentSemantic),
  })),
  parentChild: (capture.projection?.graph.parentChild ?? []).map(
    (relation) =>
      `${scenarioAlias(aliases, String(relation.parent))}>${scenarioAlias(
        aliases,
        String(relation.child),
      )}`,
  ),
  blockedBy: (capture.projection?.graph.blockedBy ?? []).map(
    (relation) =>
      `${scenarioAlias(aliases, String(relation.blocked))}<${scenarioAlias(
        aliases,
        String(relation.blocker),
      )}`,
  ),
});

export type MattReferenceSemanticView = DeepReadonly<
  ReturnType<typeof buildMattReferenceSemanticView>
>;

export const mattReferenceSemanticView = (
  capture: MattSkillsV1ScopeCapture,
  aliases: Readonly<Record<string, string>>,
): MattReferenceSemanticView =>
  buildMattReferenceSemanticView(capture, aliases) as MattReferenceSemanticView;

type MattReferenceRole = "map" | "spec" | "wayfinder" | "delivery" | "incoming";

const roleByReference = (
  capture: MattSkillsV1ScopeCapture,
): ReadonlyMap<string, MattReferenceRole> => {
  const roles = new Map<string, MattReferenceRole>();
  const projection = capture.projection;
  if (projection?.map !== undefined) roles.set(String(projection.map.ref), "map");
  if (projection?.spec !== undefined) roles.set(String(projection.spec.ref), "spec");
  for (const ticket of projection?.wayfinderTickets ?? []) {
    roles.set(String(ticket.ref), "wayfinder");
  }
  for (const ticket of projection?.deliveryTickets ?? []) {
    roles.set(String(ticket.ref), "delivery");
  }
  for (const issue of projection?.incomingIssues ?? []) {
    roles.set(String(issue.ref), "incoming");
  }
  return roles;
};

const buildMattReferenceRelationPartition = (
  capture: MattSkillsV1ScopeCapture,
  aliases: Readonly<Record<string, string>>,
) => {
  const roles = roleByReference(capture);
  const workflow: string[] = [];
  const nativeAcquisition: { relation: string; evidence: string }[] = [];
  const relations = capture.projection?.graph.parentChild ?? [];

  for (const relation of relations) {
    const parentRole = roles.get(String(relation.parent));
    const childRole = roles.get(String(relation.child));
    const semanticRelation = `${scenarioAlias(
      aliases,
      String(relation.parent),
    )}>${scenarioAlias(aliases, String(relation.child))}`;
    if (
      (parentRole === "map" && childRole === "wayfinder") ||
      (parentRole === "spec" && childRole === "delivery")
    ) {
      workflow.push(semanticRelation);
      continue;
    }
    if (
      relation.evidence === "github-native" &&
      parentRole === "map" &&
      (childRole === "spec" || childRole === "incoming")
    ) {
      nativeAcquisition.push({
        relation: semanticRelation,
        evidence: relation.evidence,
      });
      continue;
    }
    throw new TypeError(
      `Reference scenario relation has no semantic partition: ${String(
        relation.parent,
      )}>${String(relation.child)} (${relation.evidence}).`,
    );
  }

  if (workflow.length + nativeAcquisition.length !== relations.length) {
    throw new TypeError("Reference scenario relation partition is incomplete.");
  }
  return { workflow, nativeAcquisition };
};

export type MattReferenceRelationPartition = DeepReadonly<
  ReturnType<typeof buildMattReferenceRelationPartition>
>;

export const mattReferenceRelationPartition = (
  capture: MattSkillsV1ScopeCapture,
  aliases: Readonly<Record<string, string>>,
): MattReferenceRelationPartition =>
  buildMattReferenceRelationPartition(capture, aliases) as MattReferenceRelationPartition;

const buildMattReferenceEquivalenceView = (
  capture: MattSkillsV1ScopeCapture,
  aliases: Readonly<Record<string, string>>,
) => {
  const view = buildMattReferenceSemanticView(capture, aliases);
  const relations = buildMattReferenceRelationPartition(capture, aliases);
  return {
    ...view,
    capture: {
      state: view.capture.state,
      freshness: view.capture.freshness,
      coverage: view.capture.coverage,
      completion: view.capture.completion,
      diagnostics: view.capture.diagnostics,
    },
    wayfinder: view.wayfinder.map((ticket) => ({
      ...ticket,
      comments: ticket.comments.map((comment) => ({
        role: comment.role,
        body: comment.body,
      })),
    })),
    delivery: view.delivery.map((ticket) => ({
      ...ticket,
      comments: ticket.comments.map((comment) => ({
        role: comment.role,
        body: comment.body,
      })),
    })),
    parentChild: relations.workflow,
  };
};

export type MattReferenceEquivalenceView = DeepReadonly<
  ReturnType<typeof buildMattReferenceEquivalenceView>
>;

export const mattReferenceEquivalenceView = (
  capture: MattSkillsV1ScopeCapture,
  aliases: Readonly<Record<string, string>>,
): MattReferenceEquivalenceView =>
  buildMattReferenceEquivalenceView(capture, aliases) as MattReferenceEquivalenceView;
