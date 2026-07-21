import { lstat, rename } from "node:fs/promises";

type MoveOptions<Value> = Readonly<{
  source: string;
  destination: string;
  expected: Value;
  inspect: (path: string) => Promise<Value | undefined>;
  matches: (expected: Value, observed: Value) => boolean;
  failure: (cause?: unknown) => Error;
  beforeMove?: (() => Promise<void>) | undefined;
}>;

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const assertMissing = async (path: string, failure: (cause?: unknown) => Error): Promise<void> => {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    if (!(error instanceof Error)) throw error;
    throw failure(error);
  }
  throw failure();
};

const inspect = async <Value>(
  path: string,
  operation: (path: string) => Promise<Value | undefined>,
  failure: (cause?: unknown) => Error,
): Promise<Value | undefined> => {
  try {
    return await operation(path);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw failure(error);
  }
};

const matches = <Value>(
  expected: Value,
  observed: Value,
  operation: (expected: Value, observed: Value) => boolean,
  failure: (cause?: unknown) => Error,
): boolean => {
  try {
    return operation(expected, observed);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw failure(error);
  }
};

export const moveAndVerify = async <Value>(options: MoveOptions<Value>): Promise<Value> => {
  await assertMissing(options.destination, options.failure);
  await options.beforeMove?.();
  const source = await inspect(options.source, options.inspect, options.failure);
  if (
    source === undefined ||
    !matches(options.expected, source, options.matches, options.failure)
  ) {
    throw options.failure();
  }
  await assertMissing(options.destination, options.failure);
  try {
    await rename(options.source, options.destination);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw options.failure(error);
  }
  const moved = await inspect(options.destination, options.inspect, options.failure);
  if (moved !== undefined && matches(options.expected, moved, options.matches, options.failure)) {
    return moved;
  }
  // Leave an unverifiable move at its unique destination. Moving it back could
  // overwrite a new canonical source or follow a raced symlink/special file.
  throw options.failure();
};
