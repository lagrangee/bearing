import { basename, dirname, join } from "node:path";
import { createLockToken } from "./lock-artifact-name";

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

const isCanonicalToken = (token: string): boolean => {
  if (!TOKEN.test(token)) return false;
  const bytes = Buffer.from(token, "base64url");
  return bytes.length === 16 && bytes.toString("base64url") === token;
};

const tokenBetween = (name: string, prefix: string, suffix: string): string | undefined => {
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return undefined;
  return name.slice(prefix.length, -suffix.length);
};

export const isBoundOwnerRetiredName = (name: string): boolean => {
  const owner = tokenBetween(name, ".owner.", ".retired");
  return owner !== undefined && isCanonicalToken(owner);
};

export const isBoundEntryRetiredName = (name: string): boolean => {
  const entry = tokenBetween(name, ".entry.", ".retired");
  return entry !== undefined && isCanonicalToken(entry);
};

export const isBoundRetiredTargetName = (name: string): boolean =>
  isBoundOwnerRetiredName(name) || isBoundEntryRetiredName(name);

export const isRecoveryRetiredName = (name: string, recoveryName: string): boolean => {
  const token = tokenBetween(name, `${recoveryName}.`, ".retired");
  return token !== undefined && isCanonicalToken(token);
};

export const recoveryRetiredPath = (recoveryPath: string): string =>
  join(dirname(recoveryPath), `${basename(recoveryPath)}.${createLockToken()}.retired`);
