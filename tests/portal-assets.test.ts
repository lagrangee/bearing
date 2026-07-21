import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  buildPortalAssetManifest,
  loadPortalAssets,
  writePortalAssetManifest,
} from "../src/portal/assets";
import { makeTemporaryDirectory } from "./helpers";

const createAssetFixture = async (): Promise<string> => {
  const packageRoot = await makeTemporaryDirectory("bearing-portal-assets-");
  const portalRoot = join(packageRoot, "dist/portal");
  await mkdir(join(portalRoot, "assets"), { recursive: true });
  await writeFile(join(portalRoot, "index.html"), '<!doctype html><div id="root"></div>\n');
  await writeFile(join(portalRoot, "assets/app-abc123.js"), "console.log('portal');\n".repeat(64));
  await writeFile(join(portalRoot, "assets/app-abc123.css"), "body { color: black; }\n");
  await writeFile(
    join(packageRoot, "package.json"),
    `${JSON.stringify({ name: "fixture", version: "1.2.3" })}\n`,
  );
  return packageRoot;
};

describe("fixed Portal asset contract", () => {
  test("builds a deterministic strict manifest and loads immutable startup bytes", async () => {
    const packageRoot = await createAssetFixture();
    try {
      const portalRoot = join(packageRoot, "dist/portal");
      const manifest = await buildPortalAssetManifest(portalRoot, "1.2.3");
      await writePortalAssetManifest(portalRoot, manifest);
      const loaded = await loadPortalAssets(packageRoot, "1.2.3");

      expect(manifest.assets.map((asset) => asset.path)).toEqual([
        "assets/app-abc123.css",
        "assets/app-abc123.js",
        "index.html",
      ]);
      expect(loaded.manifest).toEqual(manifest);
      expect(loaded.get("/index.html")?.contentType).toBe("text/html; charset=utf-8");
      expect(loaded.get("/assets/app-abc123.js")?.bytes.toString("utf8")).toContain("portal");
      const javascript = loaded.get("/assets/app-abc123.js");
      const gzipBytes = javascript?.gzipBytes;
      expect(javascript?.gzipBytes).toBeInstanceOf(Buffer);
      if (javascript === undefined || gzipBytes === undefined) {
        throw new Error("Expected a useful precompressed JavaScript representation.");
      }
      expect(gunzipSync(gzipBytes).toString("utf8")).toBe(javascript.bytes.toString("utf8"));
      expect(loaded.get("/assets/app-abc123.css")?.gzipBytes).toBeUndefined();
      expect(loaded.get("/index.html")?.gzipBytes).toBeUndefined();

      await writeFile(join(portalRoot, "assets/app-abc123.js"), "tampered\n");
      expect(loaded.get("/assets/app-abc123.js")?.bytes.toString("utf8")).toContain("portal");
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });

  test("rejects version mismatch, modified assets, and unlisted files before startup", async () => {
    const packageRoot = await createAssetFixture();
    try {
      const portalRoot = join(packageRoot, "dist/portal");
      const manifest = await buildPortalAssetManifest(portalRoot, "1.2.3");
      await writePortalAssetManifest(portalRoot, manifest);

      await expect(loadPortalAssets(packageRoot, "9.9.9")).rejects.toThrow("package version");
      await writeFile(join(portalRoot, "assets/app-abc123.js"), "tampered\n");
      await expect(loadPortalAssets(packageRoot, "1.2.3")).rejects.toThrow("asset contract");

      await writePortalAssetManifest(portalRoot, manifest);
      await writeFile(join(portalRoot, "unexpected.txt"), "not listed\n");
      await expect(loadPortalAssets(packageRoot, "1.2.3")).rejects.toThrow("asset set");
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });
});
