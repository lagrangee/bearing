import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { normalizePath, type Plugin, build as viteBuild } from "vite";

let harnessBundle = "";

const catalogRefreshSeam = (projectRoot: string): Plugin => {
  const catalogPage = normalizePath(resolve(projectRoot, "src/portal-ui/catalog.tsx"));
  const catalogShell = normalizePath(resolve(projectRoot, "src/portal-ui/shell.tsx"));
  const virtualShell = "\0catalog-request-lifecycle-shell";
  return {
    name: "catalog-request-lifecycle-refresh-seam",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "./shell" || importer === undefined) return null;
      return normalizePath(importer) === catalogPage ? virtualShell : null;
    },
    load(id) {
      if (id !== virtualShell) return null;
      return [
        'import { createElement } from "react";',
        `import { CatalogShell as ProductionCatalogShell } from ${JSON.stringify(catalogShell)};`,
        "export function CatalogShell(props) {",
        "  globalThis.__catalogHarness.captureRefresh(props.onRefresh);",
        "  return createElement(ProductionCatalogShell, props);",
        "}",
      ].join("\n");
    },
  };
};

test.beforeAll(async () => {
  const browserTestsRoot = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(browserTestsRoot, "..");
  const built = await viteBuild({
    configFile: false,
    root: projectRoot,
    mode: "development",
    logLevel: "silent",
    plugins: [catalogRefreshSeam(projectRoot), react()],
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    build: {
      write: false,
      target: "es2022",
      minify: false,
      sourcemap: false,
      rollupOptions: {
        input: resolve(browserTestsRoot, "catalog-request-lifecycle-harness.ts"),
        output: {
          format: "iife",
          name: "CatalogRequestLifecycleHarness",
        },
      },
    },
  });
  if (!Array.isArray(built) && !("output" in built)) {
    await built.close();
    throw new Error("StrictMode browser harness unexpectedly started a watch build.");
  }
  const outputs = (Array.isArray(built) ? built : [built]).flatMap((result) => result.output);
  const entry = outputs.find((output) => output.type === "chunk" && output.isEntry);
  if (entry?.type !== "chunk")
    throw new Error("StrictMode browser harness emitted no entry chunk.");
  harnessBundle = entry.code;
});

test("StrictMode and consecutive refresh generations ignore aborted delayed responses", async ({
  page,
}) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: harnessBundle });

  await expect.poll(() => page.evaluate(() => window.__catalogHarness.count())).toBe(2);
  expect(await page.evaluate(() => window.__catalogHarness.aborted(0))).toBe(true);
  expect(await page.evaluate(() => window.__catalogHarness.aborted(1))).toBe(false);

  await page.evaluate(() => window.__catalogHarness.resolve(1, "Fresh StrictMode project"));
  await expect(page.getByText("Fresh StrictMode project", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__catalogHarness.resolve(0, "Stale StrictMode project"));
  await expect(page.getByText("Fresh StrictMode project", { exact: true })).toBeVisible();
  await expect(page.getByText("Stale StrictMode project", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Refresh registered projects" }).click();
  expect(await page.evaluate(() => window.__catalogHarness.aborted(1))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__catalogHarness.count())).toBe(3);

  await page.evaluate(() => window.__catalogHarness.triggerRefresh());
  await expect.poll(() => page.evaluate(() => window.__catalogHarness.count())).toBe(4);
  expect(await page.evaluate(() => window.__catalogHarness.aborted(2))).toBe(true);
  expect(await page.evaluate(() => window.__catalogHarness.aborted(3))).toBe(false);

  await page.evaluate(() => window.__catalogHarness.resolve(3, "Newest refresh project"));
  await expect(page.getByText("Newest refresh project", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__catalogHarness.resolve(2, "Stale refresh project"));
  await expect(page.getByText("Newest refresh project", { exact: true })).toBeVisible();
  await expect(page.getByText("Stale refresh project", { exact: true })).toHaveCount(0);
});
