import type { NativeWork } from "./native-work";

export type TicketLane = "claimed" | "ready" | "blocked" | "resolved" | "triage";

type NativeLaneNode = Readonly<{ reference: string; native?: NativeWork }>;

const nativeStatus = (node: NativeLaneNode): string | undefined => node.native?.status;

export const deriveTicketLane = (
  ticket: NativeLaneNode,
  nodes: readonly NativeLaneNode[],
): TicketLane => {
  if (ticket.native?.kind !== "ticket") return "triage";
  const status = ticket.native.status;
  if (status === "claimed") return "claimed";
  if (status === "resolved" || status === "wontfix") return "resolved";
  if (status === "needs-triage" || status === "needs-info") return "triage";
  if (status !== "open" && status !== "ready-for-agent" && status !== "ready-for-human")
    return "triage";
  return (ticket.native.blockerTargets ?? []).some((targetReference) => {
    const target = nodes.find((node) => node.reference === targetReference);
    const targetStatus = target === undefined ? undefined : nativeStatus(target);
    return targetStatus !== "resolved" && targetStatus !== "wontfix";
  })
    ? "blocked"
    : "ready";
};
