import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { makeTemporaryDirectory } from "./helpers";

test("keeps Local acquisition read-only and behind the shared Markdown boundary", async () => {
  const source = await readFile("src/providers/matt-skills-v1/local-markdown.ts", "utf8");

  expect(source).toContain('from "../../markdown-document"');
  expect(source).toContain("parseMarkdownDocument");
  expect(source).toContain("readContainedFile");
  expect(source).not.toMatch(/\b(?:writeFile|appendFile|mkdir|rename|unlink|rm|fetch)\s*\(/u);
  expect(source).not.toMatch(/from\s+["']node:(?:http|https|net|tls)["']/u);
  expect(source).not.toMatch(/from\s+["'](?:mdast|mdast-util-|micromark)/u);
});

test("keeps Portal read and Project Find outside every provider I/O graph", async () => {
  const outputRoot = await makeTemporaryDirectory("bearing-portal-read-graph-");
  try {
    const result = await Bun.build({
      entrypoints: [join(process.cwd(), "src/portal/project-query-service.ts")],
      outdir: outputRoot,
      target: "node",
      format: "esm",
      minify: false,
      sourcemap: "none",
      metafile: true,
    });
    expect(result.success).toBe(true);
    if (result.metafile === undefined) throw new Error("Expected a Portal read import graph.");
    const reachableModules = Object.keys(result.metafile.inputs);
    for (const forbidden of [
      "src/provider-acquisition.ts",
      "src/project-read-model/provider-operations.ts",
      "src/providers/matt-skills-v1/local-markdown.ts",
      "src/providers/matt-skills-v1/github.ts",
    ]) {
      expect(
        reachableModules.some((module) => module.endsWith(forbidden)),
        forbidden,
      ).toBe(false);
    }
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
