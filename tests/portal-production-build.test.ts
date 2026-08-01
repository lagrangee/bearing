import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

type AssetManifest = Readonly<{
  assets: readonly Readonly<{ path: string }>[];
}>;

test("the Portal build contains production React and no local source paths", async () => {
  const projectRoot = resolve(import.meta.dir, "..");
  const portalRoot = join(projectRoot, "dist/portal");
  const manifest = JSON.parse(
    await readFile(join(portalRoot, "asset-manifest.json"), "utf8"),
  ) as AssetManifest;
  const textAssets = manifest.assets.filter((asset) =>
    [".css", ".html", ".js", ".json"].includes(extname(asset.path)),
  );
  expect(textAssets.length).toBeGreaterThan(0);

  const output = (
    await Promise.all(textAssets.map((asset) => readFile(join(portalRoot, asset.path), "utf8")))
  ).join("\n");
  expect(output).not.toContain("jsxDEV");
  expect(output).not.toContain("Download the React DevTools for a better development experience");
  expect(output).not.toContain(projectRoot);
  expect(output).not.toContain(`file://${projectRoot}`);
});

test("the production entrypoint owns the API session bootstrap", async () => {
  const projectRoot = resolve(import.meta.dir, "..");
  const entrypoint = await readFile(join(projectRoot, "dist/portal/index.html"), "utf8");
  const scriptPath = /<script type="module"[^>]* src="([^"]+)"/u.exec(entrypoint)?.[1];
  if (scriptPath === undefined) throw new Error("Expected one Portal entry module.");
  const entryModule = await readFile(join(projectRoot, "dist/portal", scriptPath), "utf8");
  const bootstrapAt = entryModule.indexOf("/api/v1/bootstrap");

  expect(bootstrapAt).toBeGreaterThan(-1);
});
