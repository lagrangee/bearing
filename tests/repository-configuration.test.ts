import { afterEach, expect, test } from "bun:test";
import packageMetadata from "../package.json";
import { PROJECT_GENERATION_VERSION } from "../src/project-generation/schema";
import { inspectPortalHandoff } from "../src/repository-configuration";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const health = (): Response =>
  Response.json({
    state: "ready",
    packageVersion: packageMetadata.version,
    readModelVersion: PROJECT_GENERATION_VERSION,
  });

test("Portal handoff reports compatible only for a readable current Catalog Entry", async () => {
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    return path === "/healthz"
      ? health()
      : Response.json({ state: "ready", entries: [{ entryId: "project-1" }] });
  }) as typeof fetch;

  await expect(inspectPortalHandoff("project-1", { BEARING_PORT: "4178" })).resolves.toEqual({
    state: "compatible",
    origin: "http://127.0.0.1:4178",
    projectUrl: "http://127.0.0.1:4178/projects/project-1",
  });
});

test("Portal handoff reports reachable invalid responses as incompatible", async () => {
  globalThis.fetch = (async () => new Response("not-json")) as unknown as typeof fetch;
  await expect(inspectPortalHandoff("project-1", { BEARING_PORT: "4178" })).resolves.toMatchObject({
    state: "incompatible",
    guidance: "stop-host-and-start-current-kit",
  });

  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    return path === "/healthz" ? health() : Response.json({ state: "ready", entries: [] });
  }) as typeof fetch;
  await expect(inspectPortalHandoff("project-1", { BEARING_PORT: "4178" })).resolves.toMatchObject({
    state: "incompatible",
  });
});

test("Portal handoff reports only a connection failure as absent", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("connection refused");
  }) as unknown as typeof fetch;
  await expect(inspectPortalHandoff("project-1", { BEARING_PORT: "4178" })).resolves.toEqual({
    state: "absent",
    origin: "http://127.0.0.1:4178",
    guidance: "run-bearing-portal-in-separate-terminal",
  });
});
