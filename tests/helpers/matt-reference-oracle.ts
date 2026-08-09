import { documentPresentationBlocksPlainText } from "../../src/document-presentation";
import type { MattSkillsV1ProviderObservation } from "../../src/providers/matt-skills-v1/capture";
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

const providerDocumentPlainText = (
  document: MattScopeProjection["wayfinderTickets"][number]["question"],
): string =>
  document.sections
    .flatMap((section) =>
      section.availability === "available"
        ? [documentPresentationBlocksPlainText(section.blocks)]
        : [],
    )
    .join("\n\n");

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
        body: providerDocumentPlainText(answer.content.document),
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
  body: providerDocumentPlainText(content.document),
  sourceKind: content.sourceAnchor?.kind,
});

const buildMattReferenceSemanticView = (
  capture: MattSkillsV1ProviderObservation,
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
          destination: providerDocumentPlainText(capture.projection.map.destination),
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
          sections: capture.projection.spec.document.sections.flatMap((section) =>
            section.semanticRole === undefined
              ? []
              : [
                  {
                    role: section.semanticRole.slice("spec.".length),
                    title: section.title,
                    body: documentPresentationBlocksPlainText(section.blocks),
                  },
                ],
          ),
        },
  wayfinder: (capture.projection?.wayfinderTickets ?? []).map((ticket) => ({
    ref: scenarioAlias(aliases, String(ticket.ref)),
    title: ticket.title,
    subtype: ticket.subtype,
    question: providerDocumentPlainText(ticket.question),
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
  capture: MattSkillsV1ProviderObservation,
  aliases: Readonly<Record<string, string>>,
): MattReferenceSemanticView =>
  buildMattReferenceSemanticView(capture, aliases) as MattReferenceSemanticView;

const semanticAvailabilityFor = (
  sections: readonly Readonly<{ role: string; availability: string }>[],
) =>
  Object.fromEntries(sections.map((section) => [section.role, section.availability])) as Readonly<
    Record<string, string>
  >;

const buildMattReferenceSemanticAvailabilityView = (
  capture: MattSkillsV1ProviderObservation,
  aliases: Readonly<Record<string, string>>,
) =>
  Object.fromEntries(
    [
      ...(capture.projection?.map === undefined ? [] : [capture.projection.map]),
      ...(capture.projection?.spec === undefined ? [] : [capture.projection.spec]),
      ...(capture.projection?.wayfinderTickets ?? []),
      ...(capture.projection?.deliveryTickets ?? []),
      ...(capture.projection?.incomingIssues ?? []),
    ].map((object) => [
      scenarioAlias(aliases, String(object.ref)),
      semanticAvailabilityFor(object.semanticSections),
    ]),
  );

export type MattReferenceSemanticAvailabilityView = DeepReadonly<
  ReturnType<typeof buildMattReferenceSemanticAvailabilityView>
>;

export const mattReferenceSemanticAvailabilityView = (
  capture: MattSkillsV1ProviderObservation,
  aliases: Readonly<Record<string, string>>,
): MattReferenceSemanticAvailabilityView =>
  buildMattReferenceSemanticAvailabilityView(
    capture,
    aliases,
  ) as MattReferenceSemanticAvailabilityView;

type MattReferenceRole = "map" | "spec" | "wayfinder" | "delivery" | "incoming";

const roleByReference = (
  capture: MattSkillsV1ProviderObservation,
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
  capture: MattSkillsV1ProviderObservation,
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
  capture: MattSkillsV1ProviderObservation,
  aliases: Readonly<Record<string, string>>,
): MattReferenceRelationPartition =>
  buildMattReferenceRelationPartition(capture, aliases) as MattReferenceRelationPartition;

const buildMattReferenceEquivalenceView = (
  capture: MattSkillsV1ProviderObservation,
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
  capture: MattSkillsV1ProviderObservation,
  aliases: Readonly<Record<string, string>>,
): MattReferenceEquivalenceView =>
  buildMattReferenceEquivalenceView(capture, aliases) as MattReferenceEquivalenceView;
