import { expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import packageMetadata from "../package.json";
import { buildPortalAssetManifest, writePortalAssetManifest } from "../src/portal/assets";
import { startPortalServer } from "../src/portal/server";
import { makeTemporaryDirectory } from "./helpers";

const createPackageFixture = async (): Promise<string> => {
  const root = await makeTemporaryDirectory("bearing-portal-server-");
  const portalRoot = join(root, "dist/portal");
  await mkdir(portalRoot, { recursive: true });
  await Bun.write(join(root, "package.json"), JSON.stringify({ version: packageMetadata.version }));
  await Bun.write(join(portalRoot, "index.html"), '<!doctype html><div id="root"></div>');
  await writePortalAssetManifest(
    portalRoot,
    await buildPortalAssetManifest(portalRoot, packageMetadata.version),
  );
  return root;
};

const reservePort = async (): Promise<number> => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (address === null || typeof address === "string") throw new Error("No test port available.");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
};

test("starts on loopback, keeps data failures scoped, and closes gracefully", async () => {
  const packageRoot = await createPackageFixture();
  const homeDir = await makeTemporaryDirectory("bearing-portal-home-");
  const server = await startPortalServer({
    packageRoot,
    packageVersion: packageMetadata.version,
    homeDir,
    port: await reservePort(),
    sessionSecret: "ticket-10-server-test-session-secret-32-bytes",
  });
  try {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    const health = await fetch(`${server.url}/healthz`);
    const catalog = await fetch(`${server.url}/api/v1/catalog`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ state: "ready" });
    expect(await catalog.json()).toMatchObject({ state: "ready", entries: [] });
  } finally {
    await server.close();
    await rm(packageRoot, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
  await expect(fetch(`${server.url}/healthz`)).rejects.toThrow();
});
