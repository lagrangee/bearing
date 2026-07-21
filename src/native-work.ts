export type NativeMap = Readonly<{
  kind: "map";
  locator: string;
  scope: string;
  status: string | undefined;
  fogCount: number;
}>;

export type NativeTicket = Readonly<{
  kind: "ticket";
  locator: string;
  scope: string;
  number: string;
  status: string | undefined;
  blockers: readonly string[];
  blockerTargets?: readonly string[];
}>;

export type NativeWork = NativeMap | NativeTicket;

export type NativeSourceRecord = Readonly<{
  locator: string;
  source: string;
  native?: NativeWork;
}>;

const field = (source: string, name: string): string | undefined =>
  new RegExp(`^${name}:\\s*(.+?)\\s*$`, "mu").exec(source)?.[1];

export const scopeFor = (locator: string): string | undefined =>
  /^(\.scratch\/[^/]+)\//u.exec(locator)?.[1];

export const ticketNumber = (locator: string): string | undefined =>
  /^\.scratch\/[^/]+\/issues\/(?:.*\/)?(\d+)-[^/]+\.md$/u.exec(locator)?.[1];

const fogCount = (source: string): number => {
  const afterHeading = source.split(/^## Not yet specified\s*$/mu)[1] ?? "";
  const section = afterHeading.split(/^## /mu)[0] ?? "";
  return section.split(/\r?\n/u).filter((line) => /^\s*-\s+\S/u.test(line)).length;
};

export const parseNativeMap = (locator: string, source: string): NativeMap | undefined => {
  const scope = scopeFor(locator);
  if (scope === undefined || !/^\.scratch\/[^/]+\/map\.md$/u.test(locator)) return undefined;
  return {
    kind: "map",
    locator,
    scope,
    status: field(source, "Status"),
    fogCount: fogCount(source),
  };
};

export const parseNativeTicket = (locator: string, source: string): NativeTicket | undefined => {
  const scope = scopeFor(locator);
  const number = ticketNumber(locator);
  if (scope === undefined || number === undefined) return undefined;
  const blockerField = field(source, "Blocked by");
  return {
    kind: "ticket",
    locator,
    scope,
    number,
    status: field(source, "Status"),
    blockers:
      blockerField === undefined
        ? []
        : blockerField
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
  };
};

export const parseNativeWork = (locator: string, source: string): NativeWork | undefined =>
  parseNativeMap(locator, source) ?? parseNativeTicket(locator, source);

export const normalizeNativeSource = (locator: string, source: string): NativeSourceRecord => {
  const native = parseNativeWork(locator, source);
  return { locator, source, ...(native === undefined ? {} : { native }) };
};

export const resolveNativeTicket = (
  ticket: NativeTicket,
  ticketByScopeAndNumber: ReadonlyMap<string, string | null>,
): NativeTicket => ({
  ...ticket,
  blockerTargets: ticket.blockers.flatMap((blocker) => {
    const target = ticketByScopeAndNumber.get(`${ticket.scope}:${blocker}`);
    return target === null ? [] : [target ?? blocker];
  }),
});
