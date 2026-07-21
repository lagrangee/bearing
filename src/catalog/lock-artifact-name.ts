import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

const MAX_OWNER_PID = 0x7fff_ffff;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const TOKEN = "[A-Za-z0-9_-]{22}";
const PID = "[1-9a-z][0-9a-z]{0,5}";
const NEW_INITIALIZER = new RegExp(
  `^(.+)\\.(${PID})\\.(${TOKEN})\\.initializing((?:\\.${UUID}\\.quarantine)*)$`,
  "i",
);
const NEW_QUARANTINE = new RegExp(`^(.+)\\.(${TOKEN})\\.quarantine$`);
const LEGACY_SEGMENT = new RegExp(`\\.${UUID}\\.(initializing|quarantine)`, "i");
const LEGACY_INITIALIZER_TAIL = new RegExp(
  `^\\.${UUID}\\.initializing(?:\\.${UUID}\\.quarantine)*$`,
  "i",
);
const LEGACY_QUARANTINE_TAIL = new RegExp(`^(?:\\.${UUID}\\.quarantine)+$`, "i");

export type LockDebrisName = Readonly<{
  canonical: string;
  kind: "initializing" | "quarantine";
  initializer?: Readonly<{ pid: number; token: string }>;
}>;

const parsePid = (input: string): number | undefined => {
  const pid = Number.parseInt(input, 36);
  return pid >= 1 && pid <= MAX_OWNER_PID && pid.toString(36) === input.toLowerCase()
    ? pid
    : undefined;
};

const isCanonicalToken = (input: string): boolean => {
  try {
    const bytes = Buffer.from(input, "base64url");
    return bytes.length === 16 && bytes.toString("base64url") === input;
  } catch {
    return false;
  }
};

const containsGeneratedSuffix = (input: string): boolean =>
  LEGACY_SEGMENT.test(input) ||
  /\.[1-9a-z][0-9a-z]{0,5}\.[A-Za-z0-9_-]{22}\.initializing/i.test(input) ||
  /\.[A-Za-z0-9_-]{22}\.quarantine/.test(input);

export const createLockToken = (): string => randomBytes(16).toString("base64url");

export const initializingLockPath = (lock: string, pid: number, token: string): string =>
  join(dirname(lock), `${basename(lock)}.${pid.toString(36)}.${token}.initializing`);

export const quarantineLockPath = (lock: string, token: string): string => {
  const current = basename(lock);
  const canonical = parseLockDebrisName(current)?.canonical ?? current;
  return join(dirname(lock), `${canonical}.${token}.quarantine`);
};

export const parseLockDebrisName = (name: string): LockDebrisName | undefined => {
  const current = NEW_INITIALIZER.exec(name);
  if (current !== null) {
    const [, canonical, encodedPid, token, legacyQuarantines] = current;
    const pid = encodedPid === undefined ? undefined : parsePid(encodedPid);
    if (
      canonical === undefined ||
      canonical.length === 0 ||
      containsGeneratedSuffix(canonical) ||
      pid === undefined ||
      token === undefined ||
      legacyQuarantines !== "" ||
      !isCanonicalToken(token)
    ) {
      return undefined;
    }
    return { canonical, kind: "initializing", initializer: { pid, token } };
  }
  const quarantine = NEW_QUARANTINE.exec(name);
  if (quarantine !== null) {
    const [, candidate, token] = quarantine;
    if (
      candidate === undefined ||
      containsGeneratedSuffix(candidate) ||
      token === undefined ||
      !isCanonicalToken(token)
    ) {
      return undefined;
    }
    return { canonical: candidate, kind: "quarantine" };
  }
  const firstLegacy = name.search(LEGACY_SEGMENT);
  if (firstLegacy <= 0) return undefined;
  const canonical = name.slice(0, firstLegacy);
  if (containsGeneratedSuffix(canonical)) return undefined;
  const tail = name.slice(firstLegacy);
  if (LEGACY_INITIALIZER_TAIL.test(tail)) {
    return { canonical, kind: "initializing" };
  }
  if (LEGACY_QUARANTINE_TAIL.test(tail)) {
    return { canonical, kind: "quarantine" };
  }
  return undefined;
};

export const canonicalLockBasenameFromDebris = (name: string): string | undefined =>
  parseLockDebrisName(name)?.canonical;
