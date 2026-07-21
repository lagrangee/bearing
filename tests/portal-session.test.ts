import { expect, test } from "bun:test";
import { createPortalSessionManager } from "../src/portal/session";

const secret = "portal-session-adversarial-test-secret-32-bytes";
const cookieValue = (setCookie: string): string => setCookie.split(";", 1)[0] ?? setCookie;

test("binds each CSRF token to one signed in-memory session", () => {
  const sessions = createPortalSessionManager(secret);
  const first = sessions.establish(undefined);
  const second = sessions.establish(undefined);
  if (first.cookie === undefined || second.cookie === undefined) {
    throw new Error("Expected two new Portal sessions.");
  }
  const firstCookie = cookieValue(first.cookie);
  const secondCookie = cookieValue(second.cookie);

  expect(sessions.verify(firstCookie, first.csrfToken)).toBe(true);
  expect(sessions.verify(secondCookie, second.csrfToken)).toBe(true);
  expect(sessions.verify(firstCookie, second.csrfToken)).toBe(false);
  expect(sessions.verify(secondCookie, first.csrfToken)).toBe(false);

  const forged = `${firstCookie.slice(0, -1)}${firstCookie.endsWith("a") ? "b" : "a"}`;
  expect(sessions.verify(forged, first.csrfToken)).toBe(false);
  expect(sessions.verify(firstCookie, `${first.csrfToken}x`)).toBe(false);
});

test("reuses an admitted session without rotating its CSRF token or cookie", () => {
  const sessions = createPortalSessionManager(secret);
  const created = sessions.establish(undefined);
  if (created.cookie === undefined) throw new Error("Expected a new Portal session.");

  expect(sessions.establish(cookieValue(created.cookie))).toEqual({
    csrfToken: created.csrfToken,
  });
});
