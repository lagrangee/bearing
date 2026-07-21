import type { CapturedNativeNode } from "../captured-native-work";
import { deriveTicketLane } from "../planning-derivation";
import type { StructuralDiagnostic } from "../types";
import type {
  CollectionProjection,
  MapProjection,
  ProjectionIssue,
  TicketProjection,
} from "./contract";
import { mapProjectionSchema, ticketProjectionSchema } from "./schema";
import { createSourceReference } from "./source-reference";

type NativeProjectionInput = Readonly<{
  nodes: readonly CapturedNativeNode[];
  effortByScope: ReadonlyMap<string, string>;
  sitemapFingerprint: string;
  diagnostics?: readonly StructuralDiagnostic[];
}>;

export type NativeProjection = Readonly<{
  maps: CollectionProjection<MapProjection>;
  tickets: CollectionProjection<TicketProjection>;
}>;

type Result<T> = Readonly<{ item?: T; issue?: ProjectionIssue }>;

const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const mapState = (state: string): "active" | "resolved" | "unknown" => {
  if (state === "active" || state === "resolved") return state;
  return "unknown";
};

const collection = <T>(results: readonly Result<T>[]): CollectionProjection<T> => {
  const items = results.flatMap((result) => (result.item === undefined ? [] : [result.item]));
  const issues = results.flatMap((result) => (result.issue === undefined ? [] : [result.issue]));
  if (issues.length === 0) return { validity: "available", items };
  return items.length === 0
    ? { validity: "invalid", issues }
    : { validity: "partial", items, issues };
};

const blockingIssue = (
  input: NativeProjectionInput,
  node: CapturedNativeNode,
  source: ReturnType<typeof createSourceReference>,
): Result<never> | undefined => {
  const diagnostic = input.diagnostics?.find(
    (candidate) => candidate.impact === "blocking" && candidate.target === node.locator,
  );
  return diagnostic === undefined
    ? undefined
    : {
        issue: {
          code: diagnostic.code,
          target: node.locator,
          message: "Tracker-native source has a blocking structural diagnostic.",
          source,
        },
      };
};

export const buildNativeProjection = (input: NativeProjectionInput): NativeProjection => {
  const sourceFor = (locator: string, role: "map" | "ticket") =>
    createSourceReference({
      basisFingerprint: input.sitemapFingerprint,
      kind: "tracker",
      displayLocator: locator,
      binding: { role, identity: locator },
    });
  const maps = input.nodes
    .filter((node) => node.native.kind === "map")
    .sort((left, right) => compareUtf8(left.reference, right.reference))
    .map((node): Result<MapProjection> => {
      const effortId = input.effortByScope.get(node.native.scope);
      const source = sourceFor(node.locator, "map");
      const blocked = blockingIssue(input, node, source);
      if (blocked !== undefined) return blocked;
      const parsed = mapProjectionSchema.safeParse({
        reference: node.reference,
        title: node.title,
        source,
        state: mapState(node.native.status ?? "unknown"),
        ...(effortId === undefined ? {} : { effortId }),
        fogCount: node.native.kind === "map" ? node.native.fogCount : 0,
      });
      return parsed.success
        ? { item: parsed.data }
        : {
            issue: {
              code: "invalid-native-map",
              target: node.locator,
              message: "Native Map metadata cannot enter the normalized read model.",
              source,
            },
          };
    });
  const tickets = input.nodes
    .filter((node) => node.native.kind === "ticket")
    .sort((left, right) => compareUtf8(left.reference, right.reference))
    .map((node): Result<TicketProjection> => {
      const effortId = input.effortByScope.get(node.native.scope);
      const source = sourceFor(node.locator, "ticket");
      const blocked = blockingIssue(input, node, source);
      if (blocked !== undefined) return blocked;
      const blockedBy = [
        ...new Set(node.native.kind === "ticket" ? (node.native.blockerTargets ?? []) : []),
      ].sort(compareUtf8);
      const parsed = ticketProjectionSchema.safeParse({
        reference: node.reference,
        title: node.title,
        source,
        state: deriveTicketLane(node, input.nodes),
        ...(effortId === undefined ? {} : { effortId }),
        blockedBy,
      });
      return parsed.success
        ? { item: parsed.data }
        : {
            issue: {
              code: "invalid-native-ticket",
              target: node.locator,
              message: "Native Ticket metadata cannot enter the normalized read model.",
              source,
            },
          };
    });
  return {
    maps: collection(maps),
    tickets: collection(tickets),
  };
};
