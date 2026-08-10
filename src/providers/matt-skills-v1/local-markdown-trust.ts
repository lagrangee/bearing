import type {
  MattMap,
  MattObjectReference,
  MattScopeProjection,
  MattSpec,
  MattWayfinderTicket,
} from "./model";

export const retainTrustedLocalProjection = (input: {
  observed: MattScopeProjection;
  rawWayfinderTickets: readonly MattWayfinderTicket[];
  map: MattMap | undefined;
  spec: MattSpec | undefined;
  concurrentMutation: boolean;
  issuesMembershipChanged: boolean;
  unstableLocators: ReadonlySet<string>;
  unstableIssueLocators: ReadonlySet<string>;
  contractLocator: string;
  triageLocator: string;
  mapLocator: string;
  specLocator: string;
}): MattScopeProjection => {
  const contractUnstable = input.unstableLocators.has(input.contractLocator);
  const vocabularyUnstable = input.unstableLocators.has(input.triageLocator);
  const trustedIssue = (reference: MattObjectReference): boolean =>
    !contractUnstable && !vocabularyUnstable && !input.unstableIssueLocators.has(String(reference));
  const wayfinderTickets =
    input.concurrentMutation &&
    input.map !== undefined &&
    input.unstableLocators.has(input.mapLocator)
      ? input.rawWayfinderTickets.filter(
          (ticket) => trustedIssue(ticket.ref) && ticket.trackerClosure.state === "open",
        )
      : input.observed.wayfinderTickets.filter((ticket) => trustedIssue(ticket.ref));
  const deliveryTickets = input.observed.deliveryTickets.filter((ticket) =>
    trustedIssue(ticket.ref),
  );
  const incomingIssues = input.observed.incomingIssues.filter((issue) => trustedIssue(issue.ref));
  const trustedIssueReferences = new Set<MattObjectReference>([
    ...wayfinderTickets.map((ticket) => ticket.ref),
    ...deliveryTickets.map((ticket) => ticket.ref),
    ...incomingIssues.map((issue) => issue.ref),
  ]);
  const trustedDecisions =
    input.map?.decisions.filter(
      (entry) => entry.ticket === undefined || trustedIssueReferences.has(entry.ticket),
    ) ?? [];
  const map =
    contractUnstable || input.map === undefined || input.unstableLocators.has(input.mapLocator)
      ? undefined
      : {
          ...input.map,
          decisions: trustedDecisions,
          outOfScope: input.map.outOfScope.filter(
            (entry) => entry.ticket === undefined || trustedIssueReferences.has(entry.ticket),
          ),
          ...(input.map.lifecycle.state === "resolved"
            ? {
                lifecycle: {
                  ...input.map.lifecycle,
                  resolutionEvidence: trustedDecisions.map((entry) => entry.sourceAnchor),
                },
              }
            : {}),
        };
  const spec =
    contractUnstable || input.spec === undefined || input.unstableLocators.has(input.specLocator)
      ? undefined
      : input.spec;
  const trustedReferences = new Set<MattObjectReference>([
    ...trustedIssueReferences,
    ...(map === undefined ? [] : [map.ref]),
    ...(spec === undefined ? [] : [spec.ref]),
  ]);
  return {
    ...(map === undefined ? {} : { map }),
    ...(spec === undefined ? {} : { spec }),
    wayfinderTickets,
    deliveryTickets,
    incomingIssues,
    structuralOrder: input.observed.structuralOrder.filter((reference) =>
      trustedReferences.has(reference),
    ),
    graph: {
      parentChild: input.issuesMembershipChanged
        ? []
        : input.observed.graph.parentChild.filter(
            (relation) =>
              trustedReferences.has(relation.parent) && trustedReferences.has(relation.child),
          ),
      blockedBy: input.issuesMembershipChanged
        ? []
        : input.observed.graph.blockedBy.filter(
            (relation) =>
              trustedReferences.has(relation.blocked) && trustedReferences.has(relation.blocker),
          ),
    },
  };
};
