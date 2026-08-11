import { expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import packageMetadata from "../package.json";

const retiredTrackedPaths = [
  "scripts/benchmark-inspect.ts",
  "scripts/benchmark-sync.ts",
  "scripts/inspect-benchmark-lib.ts",
  "scripts/run-node-sync-benchmark.ts",
  "scripts/sync-benchmark-lib.ts",
  "src/inspect-benchmark.ts",
  "src/native-scope-inspection.ts",
  "src/planning-graph-instrumentation.ts",
  "src/planning-graph.ts",
  "src/project-compilation-graph-instrumentation.ts",
  "src/project-compilation-graph.ts",
  "src/portal-project-wire.ts",
  "src/portal/project-materializer.ts",
  "src/portal/project-service.ts",
  "src/project-snapshot",
  "src/provider-observation-acquisition.ts",
  "src/provider-observation-contract.ts",
  "src/provider-observation-store.ts",
  "src/repo-lifecycle.ts",
  "src/repo-setup.ts",
  "src/sitemap-cache.ts",
  "src/sitemap-discovery.ts",
  "src/sitemap-enrichment.ts",
  "src/sitemap-fields.ts",
  "src/sitemap-model.ts",
  "src/sitemap.ts",
  "src/sync-input-generation.ts",
  "src/sync-plan.ts",
  "src/sync-receipt-schema.ts",
  "src/sync-receipt.ts",
  "src/sync-transaction.ts",
  "src/sync.ts",
  "src/portal-ui/snapshot-states.tsx",
] as const;

const currentProductFiles = async (): Promise<readonly string[]> => {
  const roots = ["src", "skills", "scripts", "docs"] as const;
  const paths: string[] = [];
  for (const root of roots) {
    const glob = new Bun.Glob("**/*.{ts,tsx,css,md,mjs}");
    for await (const relative of glob.scan({ cwd: root, onlyFiles: true })) {
      if (root === "docs" && relative.startsWith("adr/")) continue;
      paths.push(`${root}/${relative}`);
    }
  }
  paths.push("README.md", "README.zh-CN.md", "package.json");
  return paths.sort();
};

test("retired architecture has no implementation surface", async () => {
  const present: string[] = [];
  for (const path of retiredTrackedPaths) {
    try {
      await access(path);
      present.push(path);
    } catch {}
  }
  expect(present).toEqual([]);
  expect(Object.keys(packageMetadata.scripts)).not.toContain("benchmark:sync");
  expect(Object.keys(packageMetadata.scripts)).not.toContain("benchmark:inspect");
});

test("current product contains no retired command, cache, route, type, or import", async () => {
  const forbidden = [
    /\.bearing\/cache\/(?:project-sitemap\.md|sync-report\.md|sync-receipt\.json|project-generation\.json|provider-observations\.json|provider-detail-selections\.json)/u,
    /(?:from|import\()[^\n]*(?:sync(?:-plan|-transaction|-receipt)?|sitemap(?:-cache|-discovery)?|provider-observation-store|native-scope-inspection)/u,
    /\b(?:ProjectSnapshot|ProviderObservationStore|NativeScopeInspection|SyncReceipt|SyncProjectionResult|SyncResult|RepositoryLifecycleResult|SnapshotState)\b/u,
    /\/api\/v1\/projects\/[^\s`"']*\/(?:sync|inspect-native-scope|reconcile-native)\b/u,
    /\bbearing sync\b/iu,
    /\bbearing (?:purge|activation(?: check)?)\b/iu,
    /(?<!\/)\bbearing setup\b/iu,
    /\bbenchmark:(?:sync|inspect)\b/u,
    /--(?:initialize-provider-observations|recover-provider-observations|full-provider-verification|benchmark-metrics-file|portal-entry)\b/u,
    /\b(?:recover-provider-observations|full-provider-verification|ordinary-sync)\b/u,
    /\b(?:SyncOperationInstrumentation|SyncOperationMetricsSnapshot|createSyncOperationInstrumentation)\b/u,
    /\b(?:syncing|topbar-sync|sync-control|sync-failure-detail)\b/u,
    /\bthen Sync\b/u,
  ] as const;
  const findings: string[] = [];
  for (const path of await currentProductFiles()) {
    const body = await readFile(path, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(body)) findings.push(`${path}: ${pattern.source}`);
    }
  }
  expect(findings).toEqual([]);
});

test("Portal authored content has one Host-sanitized HTML sink and no browser Markdown engine", async () => {
  const sourcePaths: string[] = [];
  const glob = new Bun.Glob("**/*.{ts,tsx}");
  for await (const relative of glob.scan({ cwd: "src/portal-ui", onlyFiles: true })) {
    sourcePaths.push(`src/portal-ui/${relative}`);
  }
  sourcePaths.push(
    "src/portal-project-read-wire.ts",
    "src/portal-provider-application-wire.ts",
    "src/project-read-model/portal.ts",
  );
  const forbiddenSource = [
    /(?:from|import\()[^\n]*(?:markdown-document|markdown-it|@mdit\/plugin-tasklist|sanitize-html)/u,
    /\b(?:parseMarkdownDocument|rawBody|markdownBody|displayBody)\b/u,
  ] as const;
  const findings: string[] = [];
  for (const path of sourcePaths) {
    const body = await readFile(path, "utf8");
    for (const pattern of forbiddenSource) {
      if (path === "src/portal-ui/project-find-model.ts" && pattern === forbiddenSource[0]) {
        continue;
      }
      if (pattern.test(body)) findings.push(`${path}: ${pattern.source}`);
    }
  }
  expect(findings).toEqual([]);

  const htmlSinks = (
    await Promise.all(
      sourcePaths.map(async (path) => {
        const body = await readFile(path, "utf8");
        return [...body.matchAll(/dangerouslySetInnerHTML/gu)].map(() => path);
      }),
    )
  ).flat();
  expect(htmlSinks).toEqual(["src/portal-ui/sanitized-markdown.tsx"]);

  const dependencyMetadata = JSON.parse(
    await readFile("dist/bundle-dependencies.json", "utf8"),
  ) as Readonly<{ bundles: Readonly<{ portal: Readonly<{ packages: readonly string[] }> }> }>;
  expect(
    dependencyMetadata.bundles.portal.packages.filter((name) =>
      /^(?:@mdit\/plugin-tasklist|markdown-it|sanitize-html|mdast-util-|micromark|yaml)@/u.test(
        name,
      ),
    ),
  ).toEqual([]);
});

test("local domain overlay keeps Setup vocabulary historical-only when present", async () => {
  let context: string;
  try {
    context = await readFile("CONTEXT.md", "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  expect(context.split("\n").filter((line) => /\bSetup\b/u.test(line))).toEqual([
    "**Historical-only Setup Journey Scenario**:",
    "Historical-only acceptance evidence for the retired Setup vocabulary. A separate scenario existed only when detected trust, required user decisions, permitted mutation, or terminal outcome differed; equivalent surface-file and tracker-driver combinations remained parameters. Current behavior is owned by Repository Configuration and its current validation matrix.",
  ]);
});

test("current docs and runtime use Repository Configuration vocabulary", async () => {
  const paths = [...(await currentProductFiles())];
  try {
    await access("CONTEXT.md");
    paths.push("CONTEXT.md");
  } catch {}
  const findings: string[] = [];
  for (const path of paths) {
    const lines = (await readFile(path, "utf8")).split("\n");
    for (const [index, line] of lines.entries()) {
      if (/\bSetup\b/u.test(line) && !/Historical-only/u.test(line)) {
        findings.push(`${path}:${index + 1}`);
      }
    }
  }
  expect(findings).toEqual([]);
});

test("CI isolation proof uses explicit Project Read Model operations", async () => {
  const paths = [
    ".github/workflows/ci.yml",
    "browser-tests/portal-isolation.playwright.config.ts",
    "browser-tests/project-isolation-real-host.spec.ts",
    "browser-tests/real-host-test-support.ts",
  ] as const;
  const retiredRunnableSurface =
    /(?:\bbearing sync\b|\["sync"|\/sync\b|project-sitemap\.md|sync-report\.md|sync-receipt\.json|project-generation\.json|--initialize-provider-observations)/u;
  const findings = (
    await Promise.all(
      paths.map(async (path) => {
        const match = (await readFile(path, "utf8")).match(retiredRunnableSurface);
        return match === null ? [] : [`${path}: ${match[0]}`];
      }),
    )
  ).flat();
  expect(findings).toEqual([]);
});
