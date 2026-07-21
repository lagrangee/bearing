import { indexNativeTickets } from "./native-ticket-index";
import {
  type NativeSourceRecord,
  type NativeWork,
  resolveNativeTicket,
  scopeFor,
  ticketNumber,
} from "./native-work";

export type CapturedNativeNode = Readonly<{
  reference: string;
  title: string;
  locator: string;
  native: NativeWork;
}>;

export const capturedNativeHeading = (source: string): string =>
  /^#\s+(?:Wayfinder Map:\s*)?(.+?)\s*$/mu.exec(source)?.[1]?.trim() ?? "Untitled";

export const buildCapturedNativeNodes = (
  records: readonly NativeSourceRecord[],
): readonly CapturedNativeNode[] => {
  const ticketCandidates: { scope: string; number: string; locator: string }[] = [];
  for (const record of records) {
    const scope = scopeFor(record.locator);
    const number = ticketNumber(record.locator);
    if (scope !== undefined && number !== undefined) {
      ticketCandidates.push({ scope, number, locator: record.locator });
    }
  }
  const ticketByScopeAndNumber = new Map<string, string | null>();
  for (const [key, candidates] of indexNativeTickets(ticketCandidates)) {
    const [only] = candidates;
    ticketByScopeAndNumber.set(
      key,
      candidates.length === 1 && only !== undefined ? only.locator : null,
    );
  }
  return records.flatMap((record): readonly CapturedNativeNode[] => {
    const native = record.native;
    if (native === undefined) return [];
    return [
      {
        reference: record.locator,
        title: capturedNativeHeading(record.source),
        locator: record.locator,
        native:
          native.kind === "ticket" ? resolveNativeTicket(native, ticketByScopeAndNumber) : native,
      },
    ];
  });
};
