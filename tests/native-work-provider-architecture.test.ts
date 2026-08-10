import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("keeps the public capture wrapper provider-neutral and free of tracker driver state", async () => {
  const contract = await readFile("src/native-work-provider.ts", "utf8");
  expect(contract).not.toMatch(/\bdriver\b/iu);
  expect(contract).not.toMatch(/\bMatt\b/u);
  expect(contract).not.toMatch(
    /\b(?:work object|tracker ontology|capability DSL|provider SDK)\b/iu,
  );
});

test("keeps workflow dispositions concrete without a generic terminal lifecycle", async () => {
  const model = await readFile("src/providers/matt-skills-v1/model.ts", "utf8");
  expect(model).not.toMatch(/\bterminal\b/iu);
  expect(model).not.toMatch(/\b(?:GenericWork|UniversalWork|WorkObject)\b/u);
  expect(model).toContain('"resolved-on-route"');
  expect(model).toContain('"ruled-out-of-scope"');
  expect(model).toContain('"completion-unavailable"');
  expect(model).toContain('"wontfix"');
});

test("keeps the semantic equivalence oracle test-owned", async () => {
  const glob = new Bun.Glob("src/**/*.{ts,tsx}");
  for (const file of glob.scanSync({ cwd: process.cwd(), onlyFiles: true })) {
    const source = await readFile(file, "utf8");
    expect(source, file).not.toContain("mattReferenceSemanticView");
    expect(source, file).not.toContain("expectedMattReferenceSemantics");
  }
});

test("reuses one immutable-object implementation across capture and project compilation", async () => {
  const immutable = await readFile("src/immutable.ts", "utf8");
  const capture = await readFile("src/native-work-provider.ts", "utf8");
  const projections = await readFile("src/project-compilation-projection.ts", "utf8");
  expect(immutable).toContain("export const deepFreeze");
  expect(immutable).toContain('from "deep-freeze-es6"');
  expect(immutable).not.toContain("Object.freeze");
  expect(capture).toContain('import { deepFreeze } from "./immutable"');
  expect(projections).toContain('import { deepFreeze } from "./immutable"');
  expect(projections).not.toContain("const deepFreeze =");
});
