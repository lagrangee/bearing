import { describe, expect, test } from "bun:test";
import { parseGitHubCliIncludedResponse } from "../src/providers/matt-skills-v1/github-cli-response";

describe("GitHub CLI included-response boundary", () => {
  test("decodes HTTP/2 response framing, normalized headers and JSON body", () => {
    expect(
      parseGitHubCliIncludedResponse(
        'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nETag: "v1"\r\n\r\n{"ok":true}',
      ),
    ).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json",
        etag: '"v1"',
      },
      body: { ok: true },
    });
  });

  test("accepts LF framing and an empty conditional response body", () => {
    expect(parseGitHubCliIncludedResponse('HTTP/1.1 304 Not Modified\nETag: "v1"\n\n')).toEqual({
      status: 304,
      headers: { etag: '"v1"' },
    });
  });

  test("fails closed on malformed framing, invalid status and non-JSON bodies", () => {
    expect(parseGitHubCliIncludedResponse("plain body")).toBeUndefined();
    expect(parseGitHubCliIncludedResponse("HTTP/2.0 nope\r\n\r\n")).toBeUndefined();
    expect(() => parseGitHubCliIncludedResponse("HTTP/2.0 200 OK\r\n\r\nnot-json")).toThrow();
    expect(() =>
      parseGitHubCliIncludedResponse(
        "HTTP/1.1 301 Moved\r\nLocation: /next\r\n\r\nHTTP/2.0 200 OK\r\n\r\n{}",
      ),
    ).toThrow();
  });
});
