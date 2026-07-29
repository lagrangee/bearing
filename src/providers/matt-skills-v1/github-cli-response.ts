import parseHeaders from "parse-headers";

export type GitHubCliIncludedResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body?: unknown;
}>;

const normalizeParsedHeaders = (
  headers: Readonly<Record<string, string | string[]>>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? (value.at(-1) ?? "") : value,
    ]),
  );

export const parseGitHubCliIncludedResponse = (
  stdout: string,
): GitHubCliIncludedResponse | undefined => {
  const firstLineEnd = stdout.search(/\r?\n/u);
  const separator = /\r?\n\r?\n/u.exec(stdout);
  if (firstLineEnd < 0 || separator === null || separator.index < firstLineEnd) {
    return undefined;
  }
  const statusLine = stdout.slice(0, firstLineEnd).trim();
  const statusMatch = /^HTTP\/\S+\s+([1-5][0-9]{2})(?:\s|$)/u.exec(statusLine);
  if (statusMatch?.[1] === undefined) return undefined;
  const status = Number(statusMatch[1]);
  const headerSource = stdout.slice(firstLineEnd, separator.index);
  const headers = normalizeParsedHeaders(parseHeaders(headerSource));
  const bodySource = stdout.slice(separator.index + separator[0].length).trim();
  if (bodySource.length === 0) return { status, headers };
  return { status, headers, body: JSON.parse(bodySource) as unknown };
};
