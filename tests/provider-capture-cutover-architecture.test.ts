import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const productionFiles = [
  "src/bearing-record-decoder.ts",
  "src/diagnostics.ts",
  "src/discovery.ts",
  "src/planning-graph.ts",
  "src/project-snapshot/governance.ts",
  "src/project-snapshot/projection-input.ts",
  "src/project-snapshot/projection.ts",
  "src/project-snapshot/schema.ts",
  "src/sitemap-discovery.ts",
  "src/sitemap-model.ts",
  "src/sitemap.ts",
  "src/sync-input-generation.ts",
  "src/sync-plan.ts",
] as const;

test("cuts production consumers over to provider captures without provisional native work", async () => {
  for (const file of productionFiles) {
    const source = await readFile(file, "utf8");
    expect(source, file).not.toMatch(/\b(?:NativeWork|NativeSourceRecord|nativeRecords)\b/u);
    expect(source, file).not.toMatch(/\bDriver\b/u);
  }
});

test("removes the provisional native-work implementation and global scratch discovery", async () => {
  for (const file of [
    "src/native-work.ts",
    "src/captured-native-work.ts",
    "src/planning-derivation.ts",
    "src/native-ticket-diagnostics.ts",
  ]) {
    expect(Bun.file(file).size, file).toBe(0);
  }
  const discovery = await readFile("src/sitemap-discovery.ts", "utf8");
  expect(discovery).not.toContain('probeContainedInput(root, ".scratch")');
  expect(discovery).not.toContain("discoverCanonicalEffortScopes");
});

test("publishes provider captures instead of generic map and ticket Snapshot truth", async () => {
  const schema = await readFile("src/project-snapshot/schema.ts", "utf8");
  expect(schema).toContain("providerCaptures:");
  expect(schema).not.toMatch(/^\s+maps:/mu);
  expect(schema).not.toMatch(/^\s+tickets:/mu);
});
