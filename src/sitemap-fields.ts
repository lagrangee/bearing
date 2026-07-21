export const text = (data: Readonly<Record<string, unknown>>, key: string): string | undefined =>
  typeof data[key] === "string" ? data[key] : undefined;

export const texts = (data: Readonly<Record<string, unknown>>, key: string): string[] =>
  Array.isArray(data[key])
    ? data[key].filter((value): value is string => typeof value === "string")
    : [];

export const records = (
  data: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>>[] =>
  Array.isArray(data[key])
    ? data[key].filter(
        (value): value is Readonly<Record<string, unknown>> =>
          typeof value === "object" && value !== null && !Array.isArray(value),
      )
    : [];
