export type NativeTicketIdentity = Readonly<{
  scope: string;
  number: string;
}>;

export const nativeTicketKey = (ticket: NativeTicketIdentity): string =>
  `${ticket.scope}:${ticket.number}`;

export const indexNativeTickets = <T extends NativeTicketIdentity>(
  tickets: readonly T[],
): ReadonlyMap<string, readonly T[]> => {
  const index = new Map<string, T[]>();
  for (const ticket of tickets) {
    const key = nativeTicketKey(ticket);
    const candidates = index.get(key) ?? [];
    candidates.push(ticket);
    index.set(key, candidates);
  }
  return index;
};
