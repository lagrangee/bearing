import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("keeps Local acquisition read-only and behind the shared Markdown boundary", async () => {
  const source = await readFile("src/providers/matt-skills-v1/local-markdown.ts", "utf8");

  expect(source).toContain('from "../../markdown-document"');
  expect(source).toContain("parseMarkdownDocument");
  expect(source).toContain("readContainedFile");
  expect(source).not.toMatch(/\b(?:writeFile|appendFile|mkdir|rename|unlink|rm|fetch)\s*\(/u);
  expect(source).not.toMatch(/from\s+["']node:(?:http|https|net|tls)["']/u);
  expect(source).not.toMatch(/from\s+["'](?:mdast|mdast-util-|micromark)/u);
});
