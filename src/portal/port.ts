import { parseArgs } from "node:util";

export const DEFAULT_PORTAL_PORT = 4178;

const parsePortValue = (value: string | undefined): number => {
  if (value === undefined) return DEFAULT_PORTAL_PORT;
  if (!/^[0-9]+$/u.test(value)) throw new Error("Portal port must be an integer from 1 to 65535.");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Portal port must be an integer from 1 to 65535.");
  }
  return port;
};

export const parsePortalPort = (
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): number => {
  const parsed = parseArgs({
    args: [...args],
    options: { port: { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  return parsePortValue(parsed.values.port ?? environment["BEARING_PORT"]);
};
