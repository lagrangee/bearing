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

const approvedStructuralOwners = new Set([
  "src/asset-registration.ts",
  "src/audit-body.ts",
  "src/bearing-record-decoder.ts",
  "src/bearing-record-sections.ts",
  "src/executor-registration.ts",
  "src/guidance-body.ts",
  "src/providers/matt-skills-v1.ts",
  "src/repository-cutover.ts",
  "src/sitemap.ts",
  "src/sync-plan.ts",
]);

const claimsMarkdownStructureOwnership = (source: string): boolean =>
  [
    /(?:^|[^#])#{1,6}(?: |\\s)/u,
    /(?:["'`]|\b(?:n|r)n)---(?:["'`]|\n|\\[nr])/u,
    /["'`](?:Blocked by|Category|Status|Type|What to build):/u,
    /const\s+\w+\s*=\s*["']#["']\.repeat\(/u,
    /new RegExp\(`\^\$\{(?:marker|name)\}(?: |:)/u,
  ].some((pattern) => pattern.test(source));

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

test("freezes approved readers while blocking new parallel structural parsers", async () => {
  expect(
    claimsMarkdownStructureOwnership(
      'source.split("\\n").find((line) => line.slice(0, 3) === "## ")',
    ),
  ).toBe(true);
  expect(
    claimsMarkdownStructureOwnership(
      'const heading = "## "; source.split("\\n").find((line) => line.startsWith(heading))',
    ),
  ).toBe(true);

  const files = await sourceFiles();
  for (const owner of approvedStructuralOwners) {
    expect(files).toContain(owner);
  }

  const detected = new Set<string>();
  for (const file of files) {
    if (file === sharedModule) continue;
    const source = await readFile(file, "utf8");
    if (claimsMarkdownStructureOwnership(source)) {
      detected.add(file);
      expect(
        approvedStructuralOwners.has(file),
        `${file} claims Markdown heading, section, field, or frontmatter structure outside the shared boundary`,
      ).toBe(true);
    }
  }

  for (const owner of approvedStructuralOwners) {
    expect(detected.has(owner), `${owner} is an explicit structural parsing responsibility`).toBe(
      true,
    );
  }
});
