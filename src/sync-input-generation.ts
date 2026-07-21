import {
  type FingerprintObservation,
  fingerprintInputRecords,
  normalizeLocator,
  orderedInputLocators,
} from "./fingerprint";
import { probeContainedInput, readContainedInput } from "./input-boundary";
import { type NativeSourceRecord, normalizeNativeSource } from "./native-work";
import { resolveRepositoryRoot } from "./path-boundary";

export type SyncInputRecord = NativeSourceRecord & Readonly<{ bytes: Buffer }>;

export type SyncInputGeneration = Readonly<{
  root: string;
  inputs: readonly string[];
  fingerprint: string;
  records: readonly SyncInputRecord[];
  observations: readonly FingerprintObservation[];
  instrumentation: SyncOperationInstrumentation;
}>;

export type SyncOperationMetricsSnapshot = Readonly<{
  inputReadCount: number;
  repositoryRevalidationCount: number;
}>;

export type SyncOperationInstrumentation = Readonly<{
  readInput: typeof readContainedInput;
  runRepositoryRevalidation: <T>(operation: () => Promise<T>) => Promise<T>;
  snapshot: () => SyncOperationMetricsSnapshot;
}>;

export const createSyncOperationInstrumentation = (): SyncOperationInstrumentation => {
  let inputReadCount = 0;
  let repositoryRevalidationCount = 0;
  return {
    readInput: async (repoRoot, locator) => {
      inputReadCount += 1;
      return readContainedInput(repoRoot, locator);
    },
    runRepositoryRevalidation: async (operation) => {
      repositoryRevalidationCount += 1;
      return operation();
    },
    snapshot: () => ({ inputReadCount, repositoryRevalidationCount }),
  };
};

const captureRecord = async (
  root: string,
  locator: string,
  instrumentation: SyncOperationInstrumentation,
): Promise<SyncInputRecord | Readonly<{ unavailable: string }>> => {
  const input = await instrumentation.readInput(root, locator);
  if (input.status === "blocked") return { unavailable: input.diagnostic.message };
  const normalized = normalizeNativeSource(locator, input.bytes.toString("utf8"));
  return { ...normalized, bytes: input.bytes };
};

const fingerprintGeneration = (
  records: readonly SyncInputRecord[],
  observations: readonly FingerprintObservation[],
) => fingerprintInputRecords(records, observations);

export const captureSyncInputGeneration = async (
  repoRoot: string,
  locators: readonly string[],
  instrumentation = createSyncOperationInstrumentation(),
): Promise<SyncInputGeneration> => {
  const root = await resolveRepositoryRoot(repoRoot);
  const records: SyncInputRecord[] = [];
  for (const locator of orderedInputLocators(locators)) {
    const record = await captureRecord(root, locator, instrumentation);
    if ("unavailable" in record) throw new Error(record.unavailable);
    records.push(record);
  }
  const fingerprint = fingerprintGeneration(records, []);
  return {
    root,
    inputs: fingerprint.inputs,
    fingerprint: fingerprint.fingerprint,
    records,
    observations: [],
    instrumentation,
  };
};

const optionalLocators = async (
  root: string,
  locators: readonly string[],
): Promise<readonly string[]> => {
  const normalized = new Set<string>();
  for (const candidate of locators) {
    let locator: string;
    try {
      locator = normalizeLocator(candidate);
    } catch {
      continue;
    }
    const probe = await probeContainedInput(root, locator);
    if (probe.status === "available") normalized.add(locator);
  }
  return orderedInputLocators([...normalized]);
};

export const extendSyncInputGeneration = async (
  generation: SyncInputGeneration,
  locators: readonly string[],
  options: Readonly<{
    optionalLocators?: readonly string[];
    observations?: readonly FingerprintObservation[];
  }> = {},
): Promise<SyncInputGeneration> => {
  const captured = new Map(generation.records.map((record) => [record.locator, record]));
  const capture = async (locator: string, required: boolean): Promise<void> => {
    if (captured.has(locator)) return;
    const record = await captureRecord(generation.root, locator, generation.instrumentation);
    if ("unavailable" in record) {
      if (required) throw new Error(record.unavailable);
      return;
    }
    captured.set(locator, record);
  };
  for (const locator of orderedInputLocators(locators)) await capture(locator, true);
  for (const locator of await optionalLocators(generation.root, options.optionalLocators ?? [])) {
    await capture(locator, false);
  }
  const records = orderedInputLocators([...captured.keys()]).map((locator) => {
    const record = captured.get(locator);
    if (record === undefined) throw new Error(`Captured input is unavailable: ${locator}`);
    return record;
  });
  const observations = [...generation.observations, ...(options.observations ?? [])];
  const fingerprint = fingerprintGeneration(records, observations);
  return {
    root: generation.root,
    inputs: fingerprint.inputs,
    fingerprint: fingerprint.fingerprint,
    records,
    observations,
    instrumentation: generation.instrumentation,
  };
};
