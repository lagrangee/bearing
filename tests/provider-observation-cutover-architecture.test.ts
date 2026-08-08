import { expect, test } from "bun:test";
import { access, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { createProjectService } from "../src/portal/project-service";
import { authorizeWritesDirectly } from "../src/portal/project-write-executor";
import type { MattProviderFactory } from "../src/provider-observation-acquisition";
import { prepareSync } from "../src/sync-plan";
import { createValidBearingRepo } from "./helpers";

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

test("a real Project activation with no observation baseline performs zero acquisition", async () => {
  const root = await realpath(await createValidBearingRepo());
  let captureCalls = 0;
  const providerFactory: MattProviderFactory = () => ({
    id: "matt-skills/v1",
    capture: async () => {
      captureCalls += 1;
      throw new Error("ordinary Project activation must not enter provider acquisition");
    },
  });
  const materializer = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: {
      prepare: (repoRoot, options) => prepareSync(repoRoot, { ...options, providerFactory }),
    },
  });
  const service = createProjectService({
    packageVersion: "0.0.0-test",
    materializer,
    readCatalog: async () => ({
      state: "ready",
      entries: [
        {
          entryId: "entry-provider-budget",
          displayName: "Provider budget",
          repoRoot: root,
          availability: "available",
        },
      ],
    }),
    operationExecutorFor: () => (operation) => operation(authorizeWritesDirectly),
  });

  expect(await service.sync("entry-provider-budget", "ensure-current")).toMatchObject({
    kind: "completed",
    mode: "ensure-current",
  });
  expect(captureCalls).toBe(0);
  await expect(
    access(join(root, ".bearing/cache/provider-observations.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("cuts production consumers over to provider observations without provisional native work", async () => {
  for (const file of productionFiles) {
    const source = await readFile(file, "utf8");
    expect(source, file).not.toMatch(/\b(?:NativeWork|NativeSourceRecord|nativeRecords)\b/u);
    expect(source, file).not.toMatch(/\bDriver\b/u);
  }
});

test("keeps provider acquisition behind the explicit observation owner", async () => {
  const files = [
    ...new Bun.Glob("src/**/*.{ts,tsx}").scanSync({
      cwd: process.cwd(),
      onlyFiles: true,
    }),
  ].sort();
  const acquisitionOwner = "src/provider-observation-acquisition.ts";
  for (const file of files) {
    if (file.startsWith("src/providers/")) continue;
    const source = await readFile(file, "utf8");
    const importsConcreteProvider =
      source.includes("createLocalMarkdownMattProvider") ||
      source.includes("createGitHubMattProvider");
    expect(importsConcreteProvider, `${file} performs a direct provider acquisition`).toBe(
      file === acquisitionOwner,
    );
  }
});

test("contains scratch discovery inside provider and explicit repository boundaries", async () => {
  const allowedScratchOwners = new Set([
    "src/artifact-model.ts",
    "src/executor-registration.ts",
    "src/providers/matt-skills-v1/local-markdown.ts",
  ]);
  const detected = new Set<string>();
  for (const file of new Bun.Glob("src/**/*.{ts,tsx}").scanSync({
    cwd: process.cwd(),
    onlyFiles: true,
  })) {
    const source = await readFile(file, "utf8");
    if (!source.includes(".scratch")) continue;
    detected.add(file);
    expect(
      allowedScratchOwners.has(file),
      `${file} reintroduces global or consumer-owned scratch discovery`,
    ).toBe(true);
  }
  expect(detected).toEqual(allowedScratchOwners);
});

test("keeps every Graph, Inspect, Sitemap, Snapshot and Portal consumer free of provisional truth", async () => {
  const consumers = [
    "src/planning-graph.ts",
    "src/sitemap-discovery.ts",
    "src/sitemap-enrichment.ts",
    "src/sitemap-model.ts",
    "src/sitemap.ts",
    ...new Bun.Glob("src/project-snapshot/**/*.{ts,tsx}").scanSync({
      cwd: process.cwd(),
      onlyFiles: true,
    }),
    ...new Bun.Glob("src/portal/**/*.{ts,tsx}").scanSync({
      cwd: process.cwd(),
      onlyFiles: true,
    }),
    ...new Bun.Glob("src/portal-ui/**/*.{ts,tsx}").scanSync({
      cwd: process.cwd(),
      onlyFiles: true,
    }),
  ];
  for (const file of consumers) {
    const source = await readFile(file, "utf8");
    expect(source, file).not.toMatch(/\b(?:NativeWork|NativeSourceRecord|nativeRecords)\b/u);
    expect(source, file).not.toMatch(/\bDriver\b/u);
  }
});
