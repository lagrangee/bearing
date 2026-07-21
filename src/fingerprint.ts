import { createHash } from "node:crypto";
import { isAbsolute, posix } from "node:path";
import { readContainedInput } from "./input-boundary";
import { resolveRepositoryRoot } from "./path-boundary";
import type { FingerprintResult } from "./types";

const PREFIX = Buffer.from("bearing-input-fingerprint-v1\n", "ascii");
const UTF8_BOM = Buffer.from([239, 187, 191]);

const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

export const normalizeLocator = (locator: string): string => {
  const slashPath = locator.replaceAll("\\", "/");
  const normalized = posix.normalize(slashPath);
  if (
    slashPath.length === 0 ||
    slashPath.includes("\0") ||
    isAbsolute(slashPath) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Expected a repository-relative POSIX path, received: ${locator}`);
  }
  return normalized;
};

const normalizeMarkdown = (bytes: Buffer): Buffer => {
  const content = bytes.subarray(bytes.subarray(0, 3).equals(UTF8_BOM) ? 3 : 0);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
  const lineNormalized = decoded.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return Buffer.from(`${lineNormalized.replace(/\n+$/u, "")}\n`, "utf8");
};

const makeRecord = (locator: string, content: Buffer): Buffer => {
  const locatorBytes = Buffer.from(locator, "utf8");
  return Buffer.concat([
    Buffer.from(`${locatorBytes.length}:`, "ascii"),
    locatorBytes,
    Buffer.from(`${content.length}:`, "ascii"),
    content,
  ]);
};

export type FingerprintInputRecord = Readonly<{ locator: string; bytes: Buffer }>;
export type FingerprintObservation = Readonly<{ key: string; value: string }>;

export const orderedInputLocators = (locators: readonly string[]): readonly string[] =>
  [...new Set(locators.map(normalizeLocator))].sort(compareUtf8);

export const fingerprintInputRecords = (
  records: readonly FingerprintInputRecord[],
  observations: readonly FingerprintObservation[] = [],
): FingerprintResult => {
  const byLocator = new Map(
    records.map((record) => [normalizeLocator(record.locator), record.bytes]),
  );
  const inputs = orderedInputLocators([...byLocator.keys()]);
  const hash = createHash("sha256");
  hash.update(PREFIX);
  for (const locator of inputs) {
    const bytes = byLocator.get(locator);
    if (bytes === undefined) throw new Error(`Missing captured input: ${locator}`);
    const content = locator.toLowerCase().endsWith(".md") ? normalizeMarkdown(bytes) : bytes;
    hash.update(makeRecord(locator, content));
  }
  const normalizedObservations = new Map<string, string>();
  for (const observation of observations) {
    if (observation.key.length === 0 || observation.key.includes("\0")) {
      throw new Error("Fingerprint observation keys must be non-empty UTF-8 text.");
    }
    normalizedObservations.set(observation.key, observation.value);
  }
  if (normalizedObservations.size > 0) {
    hash.update(Buffer.from("bearing-input-observations-v1\n", "ascii"));
    for (const key of [...normalizedObservations.keys()].sort(compareUtf8)) {
      const value = normalizedObservations.get(key);
      if (value === undefined) throw new Error(`Missing fingerprint observation: ${key}`);
      hash.update(makeRecord(key, Buffer.from(value, "utf8")));
    }
  }
  return { inputs, fingerprint: `sha256:${hash.digest("hex")}` };
};

export const fingerprintFiles = async (
  repoRoot: string,
  locators: readonly string[],
): Promise<FingerprintResult> => {
  const inputs = orderedInputLocators(locators);
  const root = await resolveRepositoryRoot(repoRoot);
  const records: FingerprintInputRecord[] = [];

  for (const locator of inputs) {
    const input = await readContainedInput(root, locator);
    if (input.status === "blocked") throw new Error(input.diagnostic.message);
    records.push({ locator, bytes: input.bytes });
  }
  return fingerprintInputRecords(records);
};
