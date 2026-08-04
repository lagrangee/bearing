import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import packageMetadata from "../package.json";
import { createPortalApp } from "../src/portal/app";
import {
  buildPortalAssetManifest,
  loadPortalAssets,
  PROJECT_SNAPSHOT_VERSION,
  writePortalAssetManifest,
} from "../src/portal/assets";
import { parsePortalPort } from "../src/portal/port";
import { portalCatalogEnvelopeSchema } from "../src/portal-catalog-wire";

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
const APP_JAVASCRIPT = `${"// Bearing Portal fixed asset\n".repeat(64)}document.querySelector('#root')?.append('Bearing Portal');`;
const TEST_SESSION_SECRET = "ticket-10-test-session-secret-with-32-bytes";
const LOCAL_ORIGIN = "http://127.0.0.1:4178";

const healthSchema = z.object({
  state: z.literal("ready"),
  packageVersion: z.string(),
  readModelVersion: z.number().int().positive(),
});

const createAssetRoot = async (packageVersion = packageMetadata.version): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "bearing-portal-assets-"));
  const portalRoot = join(root, "dist/portal");
  await mkdir(portalRoot, { recursive: true });
  await Bun.write(join(root, "package.json"), JSON.stringify({ version: packageVersion }));
  await Bun.write(join(portalRoot, "index.html"), INDEX_HTML);
  await Bun.write(join(portalRoot, "app.js"), APP_JAVASCRIPT);
  await writePortalAssetManifest(
    portalRoot,
    await buildPortalAssetManifest(portalRoot, packageVersion),
  );
  return root;
};

let assetRoot = "";
let assets: Awaited<ReturnType<typeof loadPortalAssets>>;

beforeAll(async () => {
  assetRoot = await createAssetRoot();
  assets = await loadPortalAssets(assetRoot, packageMetadata.version);
});

afterAll(async () => {
  if (assetRoot.length > 0) await rm(assetRoot, { recursive: true, force: true });
});

const createReadyApp = () =>
  createPortalApp({
    assets,
    sessions: { secret: TEST_SESSION_SECRET },
    readCatalog: async () => ({
      state: "ready" as const,
      entries: [
        {
          entryId: "entry-bearing",
          repoRoot: "/tmp/bearing",
          displayName: "Bearing",
          availability: "available" as const,
        },
      ],
    }),
  });

test("uses port 4178 when no CLI or environment override exists", () => {
  // Given no port override
  // When the Portal port is parsed
  const port = parsePortalPort([], {});
  // Then the accepted loopback default is selected
  expect(port).toBe(4178);
});

test("uses BEARING_PORT when no CLI override exists", () => {
  // Given an environment override
  // When the Portal port is parsed
  const port = parsePortalPort([], { BEARING_PORT: "4280" });
  // Then the environment port is selected
  expect(port).toBe(4280);
});

test("gives --port precedence over BEARING_PORT", () => {
  // Given both supported overrides
  // When the Portal port is parsed
  const port = parsePortalPort(["--port", "4380"], { BEARING_PORT: "4280" });
  // Then the explicit CLI value wins
  expect(port).toBe(4380);
});

test("reports Host and fixed-asset readiness independently of Catalog health", async () => {
  // Given a Host whose Catalog read fails
  const app = createPortalApp({
    assets,
    sessions: { secret: TEST_SESSION_SECRET },
    readCatalog: async () => ({
      state: "failed" as const,
      diagnostic: { code: "catalog-unavailable", message: "Catalog cannot be read." },
    }),
  });
  // When health is requested
  const response = await app.request("http://127.0.0.1:4178/healthz");
  // Then the supervisor-facing health remains ready
  expect(response.status).toBe(200);
  expect(healthSchema.parse(await response.json())).toEqual({
    state: "ready",
    packageVersion: packageMetadata.version,
    readModelVersion: PROJECT_SNAPSHOT_VERSION,
  });
});

test("returns the typed Catalog read model without accepting a repository path", async () => {
  // Given one explicitly registered Catalog entry
  const app = createReadyApp();
  // When the semantic Catalog endpoint is requested
  const response = await app.request("http://127.0.0.1:4178/api/v1/catalog");
  const body = portalCatalogEnvelopeSchema.parse(await response.json());
  // Then the entry is returned by opaque identity
  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    state: "ready",
    entries: [{ entryId: "entry-bearing", displayName: "Bearing", availability: "available" }],
  });
});

test("keeps previously trusted entries visible when the Catalog is degraded", async () => {
  // Given a trusted backup after the current Catalog becomes invalid
  const app = createPortalApp({
    assets,
    sessions: { secret: TEST_SESSION_SECRET },
    readCatalog: async () => ({
      state: "degraded" as const,
      entries: [
        {
          entryId: "entry-bearing",
          repoRoot: "/tmp/bearing",
          displayName: "Bearing",
          availability: "available" as const,
        },
      ],
      diagnostic: {
        code: "catalog-current-invalid",
        message: "Project Catalog is degraded; only previously trusted entries are shown.",
      },
    }),
  });

  // When the Catalog endpoint is requested
  const response = await app.request("http://127.0.0.1:4178/api/v1/catalog");

  // Then recovery truth and the trustworthy entry are both retained
  expect(response.status).toBe(200);
  expect(portalCatalogEnvelopeSchema.parse(await response.json())).toMatchObject({
    state: "degraded",
    entries: [{ entryId: "entry-bearing", displayName: "Bearing" }],
    diagnostic: {
      code: "catalog-current-invalid",
      message: "Project Catalog is degraded; only previously trusted entries are shown.",
    },
  });
});

test("keeps a Catalog-level failure inside a typed HTTP 200 semantic response", async () => {
  // Given an unusable current and backup Catalog
  const app = createPortalApp({
    assets,
    sessions: { secret: TEST_SESSION_SECRET },
    readCatalog: async () => ({
      state: "failed" as const,
      diagnostic: { code: "catalog-invalid", message: "No trustworthy Catalog is available." },
    }),
  });
  // When the Catalog endpoint is requested
  const response = await app.request("http://127.0.0.1:4178/api/v1/catalog");
  // Then the Host stays healthy and reports the data failure semantically
  expect(response.status).toBe(200);
  expect(portalCatalogEnvelopeSchema.parse(await response.json())).toMatchObject({
    state: "failed",
    diagnostic: {
      code: "catalog-invalid",
      message: "No trustworthy Project Catalog is available.",
    },
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test("does not expose an internal Catalog failure path", async () => {
  const app = createPortalApp({
    assets,
    sessions: { secret: TEST_SESSION_SECRET },
    readCatalog: async () => {
      throw new Error("Cannot read /Users/private/.bearing/catalog.sqlite");
    },
  });

  const response = await app.request("http://127.0.0.1:4178/api/v1/catalog");
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("/Users/private");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test("establishes a same-origin session and CSRF foundation for browser actions", async () => {
  // Given the same-origin Catalog surface
  const app = createReadyApp();
  // When a browser establishes its first API session
  const response = await app.request("http://127.0.0.1:4178/api/v1/catalog");
  // Then the response carries an HTTP-only strict session and a CSRF token
  expect(response.headers.get("set-cookie")).toContain("bearing_session=");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
  expect(response.headers.get("x-bearing-csrf-token")).toMatch(/^[A-Za-z0-9_-]{32,}$/);
});

test("accepts local aliases and user-owned reverse proxy origins without configuration", async () => {
  // Given the loopback Host reached directly or through a user-owned reverse proxy
  const app = createReadyApp();
  // When callers use the localhost alias or a private proxy preserves its browser Origin
  const localhost = await app.request("http://localhost:4178/api/v1/catalog");
  const privateProxy = await app.request(`${LOCAL_ORIGIN}/api/v1/catalog`, {
    headers: {
      Origin: "http://bearing.example.ts.net",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  // Then transport choice does not require a second Portal origin configuration
  expect(localhost.status).toBe(200);
  expect(privateProxy.status).toBe(200);
});

test("rejects a browser-declared cross-site semantic API request", async () => {
  // Given an outside browser origin
  const app = createReadyApp();
  // When it requests the Catalog API
  const response = await app.request("http://127.0.0.1:4178/api/v1/catalog", {
    headers: { Origin: "https://outside.invalid", "Sec-Fetch-Site": "cross-site" },
  });
  // Then Fetch Metadata enforcement rejects the request without CORS authority
  expect(response.status).toBe(403);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});

test("does not grant CORS authority to user-owned proxy origins", async () => {
  // Given a private proxy origin that can reach the loopback Host
  const app = createReadyApp();
  // When it makes a same-origin browser request through that proxy
  const response = await app.request("http://bearing.example.ts.net/api/v1/catalog", {
    headers: { Origin: "http://bearing.example.ts.net", "Sec-Fetch-Site": "same-origin" },
  });
  // Then the request works without enabling cross-origin reads
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});

test("applies the accepted browser security policy to every Portal response surface", async () => {
  // Given the complete Host surface, including a redacted failure
  const failedApp = createPortalApp({
    assets,
    sessions: { secret: TEST_SESSION_SECRET },
    readCatalog: async () => ({ state: "ready" as const, entries: [] }),
    projectService: {
      read: async () => {
        throw new Error("private failure detail");
      },
      sync: async () => {
        throw new Error("private failure detail");
      },
    },
  });
  const responses = await Promise.all([
    createReadyApp().request("http://127.0.0.1:4178/"),
    createReadyApp().request("http://127.0.0.1:4178/app.js"),
    createReadyApp().request("http://127.0.0.1:4178/api/v1/catalog"),
    createReadyApp().request("http://127.0.0.1:4178/healthz"),
    createReadyApp().request("http://127.0.0.1:4178/favicon.ico"),
    createReadyApp().request("http://127.0.0.1:4178/api/v1/missing"),
    failedApp.request("http://127.0.0.1:4178/api/v1/projects/entry-bearing/snapshot"),
  ]);

  // When each response is inspected, then one bounded policy governs the Host
  for (const response of responses) {
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
        "form-action 'self'; script-src 'self'; style-src 'self'; " +
        "style-src-elem 'self' 'unsafe-inline'; style-src-attr 'none'; img-src 'self'; " +
        "font-src 'self'; connect-src 'self'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  }
});

test("serves only the frozen manifest assets and uses index.html for SPA navigation", async () => {
  // Given assets loaded and frozen at Host startup
  const root = await createAssetRoot();
  try {
    const frozenAssets = await loadPortalAssets(root, packageMetadata.version);
    await writeFile(join(root, "dist/portal/index.html"), "changed after startup", "utf8");
    const app = createPortalApp({
      assets: frozenAssets,
      sessions: { secret: TEST_SESSION_SECRET },
      readCatalog: async () => ({ state: "ready" as const, entries: [] }),
    });
    // When a client requests an asset and a client-side route
    const assetResponse = await app.request("http://127.0.0.1:4178/app.js");
    const routeResponse = await app.request("http://127.0.0.1:4178/projects/entry-bearing");
    const nativeRouteResponse = await app.request(
      "http://127.0.0.1:4178/projects/entry-bearing/lineage/native-subject/.scratch%2Fscope%2Fmap.md",
    );
    const missingAssetResponse = await app.request("http://127.0.0.1:4178/missing.js");
    // Then only startup bytes are served and navigation falls back to the fixed entrypoint
    expect(await assetResponse.text()).toBe(APP_JAVASCRIPT);
    expect(await routeResponse.text()).toBe(INDEX_HTML);
    expect(await nativeRouteResponse.text()).toBe(INDEX_HTML);
    expect(missingAssetResponse.status).toBe(404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstraps the API-scoped Portal session before concurrent API reads", async () => {
  const app = createReadyApp();

  const entrypoint = await app.request(`${LOCAL_ORIGIN}/projects/entry-bearing`);
  const bootstrap = await app.request(`${LOCAL_ORIGIN}/api/v1/bootstrap`);
  const cookie = bootstrap.headers.get("set-cookie");
  if (cookie === null) throw new Error("Expected the bootstrap script to establish a session.");
  const requestCookie = cookie.split(";", 1)[0] ?? cookie;
  const [catalog, project] = await Promise.all([
    app.request(`${LOCAL_ORIGIN}/api/v1/catalog`, { headers: { Cookie: requestCookie } }),
    app.request(`${LOCAL_ORIGIN}/api/v1/projects/entry-bearing/snapshot`, {
      headers: { Cookie: requestCookie },
    }),
  ]);

  expect(entrypoint.headers.get("set-cookie")).toBeNull();
  expect(bootstrap.headers.get("cache-control")).toBe("no-store");
  expect(bootstrap.status).toBe(200);
  expect(await bootstrap.json()).toEqual({ version: 1, state: "ready" });
  expect(cookie).toContain("bearing_session=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  expect(catalog.headers.get("set-cookie")).toBeNull();
  expect(project.headers.get("set-cookie")).toBeNull();
  expect(catalog.headers.get("x-bearing-csrf-token")).toBe(
    project.headers.get("x-bearing-csrf-token"),
  );
});

test("serves an immutable fixed asset as gzip when the client accepts it", async () => {
  const app = createReadyApp();
  const rawAsset = assets.get("/app.js");
  if (rawAsset === undefined) throw new Error("Expected the fixed JavaScript asset.");

  const response = await app.request("http://127.0.0.1:4178/app.js", {
    headers: { "Accept-Encoding": "br, gzip;q=0.6" },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-encoding")).toBe("gzip");
  expect(response.headers.get("vary")).toBe("Accept-Encoding");
  expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(response.headers.get("etag")).not.toBe(rawAsset.etag);
  expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8")).toBe(
    APP_JAVASCRIPT,
  );
});

test.each([
  ["an explicit gzip exclusion", "gzip;q=0"],
  ["identity only", "identity"],
  ["an explicit exclusion plus a permissive wildcard", "gzip;q=0, *;q=1"],
] as const)("serves identity bytes for %s", async (_case, acceptEncoding) => {
  const app = createReadyApp();
  const rawAsset = assets.get("/app.js");
  if (rawAsset === undefined) throw new Error("Expected the fixed JavaScript asset.");

  const response = await app.request("http://127.0.0.1:4178/app.js", {
    headers: { "Accept-Encoding": acceptEncoding },
  });

  expect(response.headers.get("content-encoding")).toBeNull();
  expect(response.headers.get("vary")).toBe("Accept-Encoding");
  expect(response.headers.get("etag")).toBe(rawAsset.etag);
  expect(await response.text()).toBe(APP_JAVASCRIPT);
});

test("does not run fixed-asset compression over the entrypoint or semantic JSON", async () => {
  const app = createReadyApp();
  const request = { headers: { "Accept-Encoding": "gzip" } };

  const entrypoint = await app.request("http://127.0.0.1:4178/projects/entry-bearing", request);
  const health = await app.request("http://127.0.0.1:4178/healthz", request);
  const catalog = await app.request("http://127.0.0.1:4178/api/v1/catalog", request);

  for (const response of [entrypoint, health, catalog]) {
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("vary")).toBeNull();
  }
  expect(entrypoint.headers.get("cache-control")).toBe("no-cache");
  expect(await entrypoint.text()).toBe(INDEX_HTML);
  expect(healthSchema.parse(await health.json()).state).toBe("ready");
  expect(portalCatalogEnvelopeSchema.parse(await catalog.json()).state).toBe("ready");
});

test("answers the browser favicon probe without a console-visible 404", async () => {
  const app = createReadyApp();

  const response = await app.request("http://127.0.0.1:4178/favicon.ico");

  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
});

test("does not expose a generic repository or filesystem read endpoint", async () => {
  // Given the Portal Host semantic surface
  const app = createReadyApp();
  // When an arbitrary path is submitted to an invented file endpoint
  const response = await app.request("http://127.0.0.1:4178/api/v1/file?path=%2Fetc%2Fpasswd");
  // Then no generic file capability exists
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain("root:");
});

test("refuses startup when the package and asset manifest versions disagree", async () => {
  // Given an asset manifest from a different package version
  const root = await createAssetRoot("99.0.0-mismatch");
  try {
    // When the fixed asset set is loaded, then startup is refused
    await expect(loadPortalAssets(root, packageMetadata.version)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
