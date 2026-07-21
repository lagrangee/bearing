export class UnreachableVariantError extends Error {
  readonly name = "UnreachableVariantError";

  constructor(readonly value: never) {
    super(`Unexpected variant: ${String(value)}`);
  }
}

export function assertNever(value: never): never {
  throw new UnreachableVariantError(value);
}
