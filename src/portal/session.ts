import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "bearing_session";
const MAX_SESSIONS = 1_024;

type SessionRecord = Readonly<{ csrfToken: string }>;

const encoded = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const parseCookies = (header: string | undefined): Readonly<Record<string, string>> =>
  Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((part) => part.trim().split("=", 2))
      .filter((pair): pair is [string, string] => pair.length === 2 && pair[0] !== undefined),
  );

export type EstablishedSession = Readonly<{
  csrfToken: string;
  cookie?: string;
}>;

export type PortalSessionManager = Readonly<{
  establish(cookieHeader: string | undefined): EstablishedSession;
  verify(cookieHeader: string | undefined, csrfToken: string | undefined): boolean;
}>;

export const createPortalSessionManager = (secret: string): PortalSessionManager => {
  if (Buffer.byteLength(secret) < 32)
    throw new Error("Portal session secret must be at least 32 bytes.");
  const sessions = new Map<string, SessionRecord>();
  const signature = (id: string): string =>
    createHmac("sha256", secret).update(id).digest("base64url");
  const decode = (cookieHeader: string | undefined): string | undefined => {
    const value = parseCookies(cookieHeader)[COOKIE_NAME];
    if (value === undefined) return undefined;
    const [id, observed] = value.split(".", 2);
    if (id === undefined || observed === undefined) return undefined;
    const expected = signature(id);
    const left = Buffer.from(observed);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right) ? id : undefined;
  };
  const create = (): Readonly<{ id: string; record: SessionRecord }> => {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (typeof oldest === "string") sessions.delete(oldest);
    }
    const id = encoded(randomBytes(24));
    const record = { csrfToken: encoded(randomBytes(24)) };
    sessions.set(id, record);
    return { id, record };
  };

  return Object.freeze({
    establish(cookieHeader: string | undefined): EstablishedSession {
      const id = decode(cookieHeader);
      const existing = id === undefined ? undefined : sessions.get(id);
      if (id !== undefined && existing !== undefined) return { csrfToken: existing.csrfToken };
      const created = create();
      return {
        csrfToken: created.record.csrfToken,
        cookie: `${COOKIE_NAME}=${created.id}.${signature(created.id)}; Path=/; HttpOnly; SameSite=Strict`,
      };
    },
    verify(cookieHeader: string | undefined, csrfToken: string | undefined): boolean {
      const id = decode(cookieHeader);
      if (id === undefined || csrfToken === undefined) return false;
      const expected = sessions.get(id)?.csrfToken;
      if (expected === undefined) return false;
      const left = Buffer.from(csrfToken);
      const right = Buffer.from(expected);
      return left.length === right.length && timingSafeEqual(left, right);
    },
  });
};
