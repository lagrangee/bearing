import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { developmentPortalIdentitySchema } from "../../src/development-portal-health";
import { startPortalServer } from "../../src/portal/server";

const identityPath = process.env["BEARING_TEST_DEVELOPMENT_IDENTITY"];
const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex === -1 ? undefined : process.argv[portIndex + 1]);
if (identityPath === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("Development Portal child harness configuration is invalid.");
}
await access(join(dirname(identityPath), "fail-start")).then(
  () => {
    throw new Error("Test Development Portal child startup failed.");
  },
  () => undefined,
);
const value = JSON.parse(await readFile(identityPath, "utf8")) as {
  receipt: {
    runtimeIdentity: string;
    stateRootIdentity: string;
    portalBuildId: string;
  };
  packageRoot?: string;
  packageVersion?: string;
  homeDir?: string;
  context?: {
    homeDir: string;
    projectReadModelPath: string;
  };
};
const development = developmentPortalIdentitySchema.parse({
  schemaVersion: 1,
  channel: "development",
  runtimeIdentity: value.receipt.runtimeIdentity,
  stateRootIdentity: value.receipt.stateRootIdentity,
  portalBuildIdentity: value.receipt.portalBuildId,
});
const instance = randomUUID();
if (
  value.packageRoot !== undefined &&
  value.packageVersion !== undefined &&
  value.homeDir !== undefined
) {
  const portal = await startPortalServer({
    packageRoot: value.packageRoot,
    packageVersion: value.packageVersion,
    homeDir: value.homeDir,
    port,
    developmentRuntimeIdentity: development,
  });
  process.stdout.write(`Bearing Portal ready: ${portal.url}\n`);
  const shutdown = async (): Promise<void> => {
    await portal.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/healthz") {
      response.end(
        JSON.stringify({
          state: "ready",
          packageVersion: "test",
          readModelVersion: 1,
          development,
        }),
      );
      return;
    }
    if (request.url === "/instance") {
      response.end(JSON.stringify({ instance }));
      return;
    }
    if (request.url === "/state" && value.context !== undefined) {
      const [catalog, state, projectReadModel] = await Promise.all([
        readFile(join(value.context.homeDir, ".bearing/catalog.sqlite"), "utf8"),
        readFile(join(value.context.homeDir, ".bearing/state/sentinel.json"), "utf8"),
        readFile(value.context.projectReadModelPath, "utf8"),
      ]);
      response.end(JSON.stringify({ catalog, state, projectReadModel }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ state: "not-found" }));
  });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Bearing Portal ready: http://127.0.0.1:${port}\n`);
  });
  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
