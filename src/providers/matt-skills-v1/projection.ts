import type { z } from "zod";
import type { MattSkillsV1ProviderObservation } from "./capture";
import type {
  MattDeliveryTicket,
  MattIncomingIssue,
  MattMap,
  MattScopeProjection,
  MattSpec,
  MattWayfinderTicket,
} from "./model";
import type { mattSkillsV1ProviderObservationSchema } from "./schema";

export type MattProjectedObject =
  | MattMap
  | MattSpec
  | MattWayfinderTicket
  | MattDeliveryTicket
  | MattIncomingIssue;

export type MattPlanningMap = Readonly<{
  reference: string;
  title: string;
  state: MattMap["lifecycle"]["state"];
  fogCount: number;
}>;

export type MattPlanningTicket = Readonly<{
  reference: string;
  title: string;
  state: "claimed" | "ready" | "blocked" | "resolved";
  blockedBy: readonly string[];
}>;

export type MattPlanningPresentation = Readonly<{
  maps: readonly MattPlanningMap[];
  tickets: readonly MattPlanningTicket[];
}>;

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type DeepReadonly<T> = T extends Primitive
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;
export type MattObservationView = DeepReadonly<
  z.output<typeof mattSkillsV1ProviderObservationSchema>
>;
type SchemaCapture = MattObservationView;
type MattPlanningCapture =
  | Pick<Extract<SchemaCapture, { state: "available" | "partial" }>, "state" | "projection">
  | Pick<Extract<SchemaCapture, { state: "absent" | "invalid" }>, "state">;

export const mattObjectsFromProjection = (
  projection: MattScopeProjection,
): readonly MattProjectedObject[] => {
  const objects = [
    ...(projection.map === undefined ? [] : [projection.map]),
    ...(projection.spec === undefined ? [] : [projection.spec]),
    ...projection.wayfinderTickets,
    ...projection.deliveryTickets,
    ...projection.incomingIssues,
  ];
  const byReference = new Map(objects.map((object) => [object.ref, object]));
  return projection.structuralOrder.flatMap((reference) => {
    const object = byReference.get(reference);
    return object === undefined ? [] : [object];
  });
};

export const mattObjects = (
  capture: MattSkillsV1ProviderObservation | MattObservationView | undefined,
): readonly MattProjectedObject[] =>
  capture === undefined || (capture.state !== "available" && capture.state !== "partial")
    ? []
    : mattObjectsFromProjection(capture.projection);

export const mattObjectLocator = (object: MattProjectedObject): string =>
  object.native.kind === "local"
    ? object.native.identity.locator
    : `github/${object.native.identity.owner}/${object.native.identity.repository}/${
        object.native.identity.objectKind === "issue" ? "issues" : "pulls"
      }/${object.native.identity.number}`;

export const mattObjectState = (object: MattProjectedObject): string => {
  switch (object.kind) {
    case "map":
    case "spec":
    case "wayfinder-ticket":
    case "delivery-ticket":
    case "incoming-issue":
      return object.lifecycle.state;
  }
};

export const mattPlanningPresentation = (
  capture: MattPlanningCapture,
): MattPlanningPresentation => {
  if (capture.state !== "available" && capture.state !== "partial") {
    return { maps: [], tickets: [] };
  }
  const projection = capture.projection;
  const completed = new Set<string>(
    [...projection.wayfinderTickets, ...projection.deliveryTickets].flatMap((ticket) => {
      const resolved =
        (ticket.kind === "wayfinder-ticket" && ticket.lifecycle.state !== "open") ||
        (ticket.kind === "delivery-ticket" && ticket.lifecycle.state === "completed");
      return resolved ? [ticket.ref] : [];
    }),
  );
  const blockedBy = (reference: string): readonly string[] =>
    projection.graph.blockedBy
      .filter((relation) => relation.blocked === reference)
      .map((relation) => relation.blocker);
  const tickets = [...projection.wayfinderTickets, ...projection.deliveryTickets].map(
    (ticket): MattPlanningTicket => {
      const blockers = blockedBy(ticket.ref);
      const resolved = completed.has(ticket.ref);
      const state = resolved
        ? "resolved"
        : blockers.some((blocker) => !completed.has(blocker))
          ? "blocked"
          : ticket.kind === "wayfinder-ticket" && ticket.claim.state === "claimed"
            ? "claimed"
            : "ready";
      return {
        reference: ticket.ref,
        title: ticket.title,
        state,
        blockedBy: blockers,
      };
    },
  );
  const maps =
    projection.map === undefined
      ? []
      : [
          {
            reference: projection.map.ref,
            title: projection.map.title,
            state: projection.map.lifecycle.state,
            fogCount: projection.map.fog.length,
          },
        ];
  return { maps, tickets };
};
