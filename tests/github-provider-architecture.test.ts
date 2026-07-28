import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("keeps GitHub capture provider-internal, read-only and behind shared boundaries", async () => {
  const source = await readFile("src/providers/matt-skills-v1/github.ts", "utf8");
  const responseBoundary = await readFile(
    "src/providers/matt-skills-v1/github-cli-response.ts",
    "utf8",
  );
  const packageDocument = JSON.parse(await readFile("package.json", "utf8")) as {
    devDependencies?: Readonly<Record<string, string>>;
  };

  expect(source).toContain('from "../../markdown-document"');
  expect(source).toContain("parseMarkdownDocument");
  expect(source).not.toMatch(/from\s+["'](?:mdast|mdast-util-|micromark|unist)/u);

  expect(source).toContain("execFile(\n      command,\n      [...args]");
  expect(source).toContain('"--method"');
  expect(source).toContain('"GET"');
  expect(source).toContain('"--hostname"');
  expect(source).toContain('"github.com"');
  expect(source).toContain("createGhCliGitHubReadTransport");
  expect(source).not.toMatch(/["'](?:POST|PATCH|PUT|DELETE)["']/u);
  expect(source).not.toMatch(/\bgh\s+(?:issue|pr)\s+(?:create|edit|comment|close|reopen)/u);
  expect(source).not.toMatch(/\b(?:writeFile|appendFile|mkdir|rename|unlink|rm)\s*\(/u);

  expect(source).not.toMatch(/\b(?:GH_TOKEN|GITHUB_TOKEN|Authorization|oauth_token)\b/u);
  expect(source).toContain('from "./github-cli-response"');
  expect(source).not.toContain('from "parse-headers"');
  expect(responseBoundary).toContain('from "parse-headers"');
  expect(source).toContain('from "safe-stable-stringify"');
  expect(packageDocument.devDependencies?.["parse-headers"]).toBe("^2.0.6");
  expect(packageDocument.devDependencies?.["safe-stable-stringify"]).toBe("^2.5.0");
});
