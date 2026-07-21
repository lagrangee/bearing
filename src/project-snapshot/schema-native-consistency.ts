import type { RefinementCtx } from "zod";
import {
  type DerivedCollection,
  nativeProjectionUncertainForEffort,
  normalizedEffortState,
} from "./normalized-planning-derivation";

type Collection<T> = DerivedCollection<T>;
type Frontier = Readonly<{
  claimed: readonly string[];
  ready: readonly string[];
  blocked: readonly string[];
  resolved: readonly string[];
  fogCount: number;
}>;
type Effort = Readonly<{
  id: string;
  source: string;
  roadmapId: string;
  targetGateId: string;
  derivedState: "active" | "resolved" | "unknown";
  frontier: Frontier;
}>;
type MapRelation = Readonly<{
  reference: string;
  effortId?: string | undefined;
  state: "active" | "resolved" | "unknown";
  fogCount: number;
}>;
type Ticket = Readonly<{
  reference: string;
  effortId?: string | undefined;
  state: "claimed" | "ready" | "blocked" | "resolved" | "triage";
  blockedBy: readonly string[];
}>;
type Diagnostic = Readonly<{
  impact: "blocking" | "non-blocking";
  target: string;
  source?: string | undefined;
}>;
type SourceRecord = Readonly<{ reference: string; displayLocator: string }>;
export type NativeConsistencySnapshot = Readonly<{
  efforts: Collection<Effort>;
  maps: Collection<MapRelation>;
  tickets: Collection<Ticket>;
  diagnostics: readonly Diagnostic[];
  sources: readonly SourceRecord[];
}>;

const trusted = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;
const complete = <T>(collection: Collection<T>): boolean => collection.validity === "available";
const byId = <T>(values: readonly T[], key: (item: T) => string): Map<string, T> =>
  new Map(values.map((item) => [key(item), item]));
const sameSet = (actual: readonly string[], expected: readonly string[]): boolean => {
  const expectedSet = new Set(expected);
  return actual.length === expectedSet.size && actual.every((value) => expectedSet.has(value));
};
const addIssue = (context: RefinementCtx, path: readonly (string | number)[], message: string) =>
  context.addIssue({ code: "custom", path: [...path], message });

const validateFrontier = (
  effort: Effort,
  position: number,
  tickets: readonly Ticket[],
  ticketsComplete: boolean,
  context: RefinementCtx,
): void => {
  const ticketIndex = byId(tickets, (ticket) => ticket.reference);
  const lanes = ["claimed", "ready", "blocked", "resolved"] as const;
  for (const lane of lanes) {
    const references = effort.frontier[lane];
    for (const [referencePosition, reference] of references.entries()) {
      const ticket = ticketIndex.get(reference);
      if (ticket !== undefined && (ticket.effortId !== effort.id || ticket.state !== lane)) {
        addIssue(
          context,
          ["efforts", "items", position, "frontier", lane, referencePosition],
          "An Effort frontier reference must preserve its native Ticket lane.",
        );
      }
    }
    const expected = tickets
      .filter((ticket) => ticket.effortId === effort.id && ticket.state === lane)
      .map((ticket) => ticket.reference);
    if (expected.some((reference) => !references.includes(reference))) {
      addIssue(
        context,
        ["efforts", "items", position, "frontier", lane],
        "An Effort frontier must retain every trustworthy Ticket in its native lane.",
      );
    } else if (ticketsComplete && !sameSet(references, expected)) {
      addIssue(
        context,
        ["efforts", "items", position, "frontier", lane],
        "A complete Ticket projection must exactly match each Effort frontier lane.",
      );
    }
  }
};

const validateEffortWork = (snapshot: NativeConsistencySnapshot, context: RefinementCtx): void => {
  const maps = trusted(snapshot.maps);
  const tickets = trusted(snapshot.tickets);
  for (const [position, effort] of trusted(snapshot.efforts).entries()) {
    const mapsUncertain = nativeProjectionUncertainForEffort(
      snapshot.maps,
      effort.source,
      snapshot.sources,
    );
    const ticketsUncertain = nativeProjectionUncertainForEffort(
      snapshot.tickets,
      effort.source,
      snapshot.sources,
    );
    validateFrontier(effort, position, tickets, !ticketsUncertain, context);
    const effortMaps = maps.filter((map) => map.effortId === effort.id);
    const fogCount = effortMaps.reduce((total, map) => total + map.fogCount, 0);
    if (!mapsUncertain && fogCount !== effort.frontier.fogCount) {
      addIssue(
        context,
        ["efforts", "items", position, "frontier", "fogCount"],
        "Effort Fog must exactly equal its complete native Map projection.",
      );
    }
    const expectedState = normalizedEffortState(effort, snapshot);
    if (effort.derivedState !== expectedState) {
      addIssue(
        context,
        ["efforts", "items", position, "derivedState"],
        "Effort state must exactly reflect its complete native work projection.",
      );
    }
  }
};

const validateNativeReferences = (
  snapshot: NativeConsistencySnapshot,
  context: RefinementCtx,
): void => {
  const efforts = byId(trusted(snapshot.efforts), (effort) => effort.id);
  for (const [position, map] of trusted(snapshot.maps).entries()) {
    if (map.effortId !== undefined && !efforts.has(map.effortId) && complete(snapshot.efforts)) {
      addIssue(context, ["maps", "items", position, "effortId"], "A Map Effort must resolve.");
    }
  }
  const tickets = trusted(snapshot.tickets);
  const ticketIndex = byId(tickets, (ticket) => ticket.reference);
  for (const [position, ticket] of tickets.entries()) {
    if (
      ticket.effortId !== undefined &&
      !efforts.has(ticket.effortId) &&
      complete(snapshot.efforts)
    ) {
      addIssue(
        context,
        ["tickets", "items", position, "effortId"],
        "A Ticket Effort must resolve.",
      );
    }
    if (
      complete(snapshot.tickets) &&
      ticket.blockedBy.some((reference) => !ticketIndex.has(reference))
    ) {
      addIssue(
        context,
        ["tickets", "items", position, "blockedBy"],
        "Every blocker in a complete Ticket projection must resolve.",
      );
    }
    if (
      ticket.state === "blocked" &&
      !ticket.blockedBy.some((reference) => ticketIndex.get(reference)?.state !== "resolved")
    ) {
      addIssue(
        context,
        ["tickets", "items", position, "blockedBy"],
        "A blocked Ticket must retain at least one unresolved native blocker.",
      );
    }
    if (
      ticket.state === "ready" &&
      ticket.blockedBy.some((reference) => ticketIndex.get(reference)?.state !== "resolved")
    ) {
      addIssue(
        context,
        ["tickets", "items", position, "blockedBy"],
        "A ready Ticket cannot retain a known unresolved native blocker.",
      );
    }
  }
};

export const validateNativeConsistency = (
  snapshot: NativeConsistencySnapshot,
  context: RefinementCtx,
): void => {
  validateEffortWork(snapshot, context);
  validateNativeReferences(snapshot, context);
};
