import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sharedModule = "src/markdown-document.ts";
const requiredBoundaryPackages = [
  "mdast",
  "mdast-util-from-markdown",
  "mdast-util-frontmatter",
  "mdast-util-gfm",
  "mdast-util-to-markdown",
  "mdast-util-to-string",
  "micromark-extension-frontmatter",
  "micromark-extension-gfm",
  "unist-util-visit",
] as const;
const rawBoundaryPackages = ["micromark", "unist"] as const;
const boundaryPackages = [...requiredBoundaryPackages, ...rawBoundaryPackages] as const;

const sourceFiles = async (): Promise<readonly string[]> => {
  const glob = new Bun.Glob("src/**/*.{ts,tsx}");
  return [...glob.scanSync({ cwd: process.cwd(), onlyFiles: true })].sort();
};

test("keeps the raw mdast and micromark stack inside one Bearing-owned boundary", async () => {
  const files = await sourceFiles();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const dependency of boundaryPackages) {
      const importsDependency = new RegExp(`from\\s+["']${dependency}(?:/[^"']*)?["']`, "u").test(
        source,
      );
      const requiredByShared = requiredBoundaryPackages.some((required) => required === dependency);
      expect(importsDependency, `${file} imports ${dependency}`).toBe(
        file === sharedModule && requiredByShared,
      );
    }
    expect(source).not.toMatch(/from ["'](?:unified|remark(?:-|\/|["']))/u);
  }

  const emitted = new Map<string, string>();
  const program = ts.createProgram([sharedModule], {
    declaration: true,
    emitDeclarationOnly: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  });
  const result = program.emit(undefined, (file, content) => emitted.set(file, content));
  expect(result.emitSkipped).toBe(false);
  const declaration = [...emitted.entries()].find(([file]) =>
    file.endsWith("/markdown-document.d.ts"),
  )?.[1];
  expect(declaration).toBeDefined();
  expect(declaration).not.toMatch(/\b(?:mdast|micromark|unist|Mdast|RootContent)\b/u);
});

test("removes compatibility readers and keeps domain decoders on the shared boundary", async () => {
  const files = await sourceFiles();
  expect(files).not.toContain("src/frontmatter.ts");
  expect(files).not.toContain("src/plain-text.ts");

  for (const file of files) {
    const source = await readFile(file, "utf8");
    expect(source, `${file} imports a removed Markdown compatibility module`).not.toMatch(
      /from ["'](?:\.\.\/)*\.?\/?(?:frontmatter|plain-text)["']/u,
    );
  }

  for (const file of ["src/audit-body.ts", "src/bearing-record-sections.ts"]) {
    const source = await readFile(file, "utf8");
    expect(source).toMatch(/from ["']\.\/markdown-document["']/u);
    expect(source, `${file} still line-parses Markdown structure`).not.toMatch(
      /split\(["']\\n["']\)|\^#{1,6}|#"\.repeat|new RegExp\([^)]*#|\^-[ ]/u,
    );
  }
});
