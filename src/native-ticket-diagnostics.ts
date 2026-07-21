import { indexNativeTickets, nativeTicketKey } from "./native-ticket-index";
import type { NativeTicket } from "./native-work";
import type { StructuralDiagnostic } from "./types";

export { type NativeTicket, parseNativeTicket } from "./native-work";

const WORK_STATUSES = new Set([
  "open",
  "claimed",
  "resolved",
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
]);

export const deriveNativeTicketDiagnostics = (
  tickets: readonly NativeTicket[],
): StructuralDiagnostic[] => {
  const diagnostics: StructuralDiagnostic[] = [];
  const index = indexNativeTickets(tickets);
  for (const candidates of index.values()) {
    if (candidates.length < 2) continue;
    for (const ticket of candidates) {
      diagnostics.push({
        code: "duplicate-ticket-number",
        impact: "blocking",
        target: ticket.locator,
        message: "Tracker-native Ticket number is duplicated within its work scope.",
      });
    }
  }
  for (const ticket of tickets) {
    if (ticket.status === undefined || !WORK_STATUSES.has(ticket.status)) {
      diagnostics.push({
        code: "unsupported-tracker-status",
        impact: "blocking",
        target: ticket.locator,
        message:
          ticket.status === undefined
            ? "Tracker-native Ticket has no Status."
            : "Tracker-native Ticket Status is not supported.",
      });
      continue;
    }
    for (const blocker of ticket.blockers) {
      const targets = index.get(nativeTicketKey({ scope: ticket.scope, number: blocker })) ?? [];
      if (targets.length !== 1) {
        diagnostics.push({
          code: targets.length === 0 ? "missing-ticket-blocker" : "ambiguous-ticket-blocker",
          impact: "blocking",
          target: ticket.locator,
          message:
            targets.length === 0
              ? "Tracker-native Ticket blocker does not resolve."
              : "Tracker-native Ticket blocker is ambiguous within its work scope.",
        });
        continue;
      }
      const [target] = targets;
      if (ticket.status !== "claimed" || target?.status === "resolved") continue;
      diagnostics.push({
        code: "claimed-with-unresolved-blocker",
        impact: "non-blocking",
        target: ticket.locator,
        message: "Claimed Ticket still depends on an unresolved Ticket.",
      });
    }
  }
  return diagnostics;
};
