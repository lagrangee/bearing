import { expect, test } from "bun:test";
import { createPortalApp } from "../src/portal/app";
import type { PortalAssets } from "../src/portal/assets";
import type { CatalogReadResult } from "../src/portal/contract";
import type { PortalProviderApplicationService } from "../src/portal/provider-application";
import { portalProviderApplicationResponseSchema } from "../src/portal-provider-application-wire";

const ORIGIN = "http://127.0.0.1:4178";
const PROJECT_ID = "project-1";

const assets: PortalAssets = {
  manifest: {
    schemaVersion: 1,
    packageVersion: "0.0.0-test",
    interfaceVersion: 1,
    projectGenerationVersion: 20,
    entry: "index.html",
    buildId: "0".repeat(64),
    assets: [],
  },
  get: () => undefined,
};

const catalog: () => Promise<CatalogReadResult> = async () => ({
  state: "ready",
  entries: [
    {
      entryId: PROJECT_ID,
      displayName: "Fixture",
      repoRoot: "/fixture",
      availability: "available",
    },
  ],
});

const appFor = (application: PortalProviderApplicationService) =>
  createPortalApp({
    assets,
    readCatalog: catalog,
    sessions: { secret: "ticket-12-provider-application-session" },
    providerApplicationService: application,
  });

const session = async (app: ReturnType<typeof createPortalApp>) => {
  const response = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/read-model`);
  const cookie = response.headers.get("set-cookie");
  const token = response.headers.get("x-bearing-csrf-token");
  if (cookie === null || token === null) throw new Error("Portal session was not established.");
  return { cookie, token };
};

test("Portal forwards one exact item refresh to the in-process Provider Application service", async () => {
  const calls: unknown[] = [];
  const application: PortalProviderApplicationService = {
    apply: async (entryId, request) => {
      calls.push([entryId, request]);
      return {
        version: 1,
        state: "completed",
        action: "item-refresh",
        acquisitionCount: 1,
        observations: [
          {
            scope: ".scratch/work",
            disposition: "captured",
            observedAt: "2026-08-08T10:00:00.000Z",
          },
        ],
        diagnostics: [],
      };
    },
  };
  const app = appFor(application);
  const { cookie, token } = await session(app);
  const response = await app.request(
    `${ORIGIN}/api/v1/projects/${PROJECT_ID}/provider-observation`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-Bearing-CSRF-Token": token,
      },
      body: JSON.stringify({
        version: 1,
        action: "item-refresh",
        binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
        subject: ".scratch/work/issues/12-refresh.md",
      }),
    },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    state: "completed",
    action: "item-refresh",
    acquisitionCount: 1,
  });
  expect(calls).toEqual([
    [
      PROJECT_ID,
      {
        version: 1,
        action: "item-refresh",
        binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
        subject: ".scratch/work/issues/12-refresh.md",
      },
    ],
  ]);
});

test("all-sources refresh requires the exact high-cost confirmation", async () => {
  let calls = 0;
  const application: PortalProviderApplicationService = {
    apply: async () => {
      calls += 1;
      throw new Error("Unreachable without valid confirmation.");
    },
  };
  const app = appFor(application);
  const { cookie, token } = await session(app);
  const response = await app.request(
    `${ORIGIN}/api/v1/projects/${PROJECT_ID}/provider-observation`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-Bearing-CSRF-Token": token,
      },
      body: JSON.stringify({
        version: 1,
        action: "all-sources-refresh",
        confirmation: "yes",
      }),
    },
  );

  expect(response.status).toBe(400);
  expect(calls).toBe(0);
});

test("Portal requires the established session for every Provider Application action", async () => {
  let calls = 0;
  const application: PortalProviderApplicationService = {
    apply: async () => {
      calls += 1;
      throw new Error("Unreachable without CSRF.");
    },
  };
  const response = await appFor(application).request(
    `${ORIGIN}/api/v1/projects/${PROJECT_ID}/provider-observation`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        action: "source-load",
        binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
      }),
    },
  );

  expect(response.status).toBe(403);
  expect(calls).toBe(0);
});

test("Portal rejects unsafe native references before Provider Application work", async () => {
  let calls = 0;
  const application: PortalProviderApplicationService = {
    apply: async () => {
      calls += 1;
      throw new Error("Unreachable with an invalid native reference.");
    },
  };
  const app = appFor(application);
  const { cookie, token } = await session(app);
  for (const request of [
    {
      version: 1,
      action: "item-refresh",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
      subject: "\uD800",
    },
    {
      version: 1,
      action: "source-load",
      binding: { provider: "matt-skills/v1", nativeScope: "scope\ncontrol" },
    },
    {
      version: 1,
      action: "item-refresh",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
      subject: "é".repeat(3_000),
    },
  ]) {
    const response = await app.request(
      `${ORIGIN}/api/v1/projects/${PROJECT_ID}/provider-observation`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          "X-Bearing-CSRF-Token": token,
        },
        body: JSON.stringify(request),
      },
    );
    expect(response.status).toBe(400);
  }
  expect(calls).toBe(0);
});

test("Provider Application responses require safe scopes and offset ISO observation times", () => {
  const response = {
    version: 1,
    state: "completed",
    action: "source-load",
    acquisitionCount: 1,
    observations: [
      { scope: ".scratch/work", disposition: "captured", observedAt: "2026-08-08T10:00:00Z" },
    ],
    diagnostics: [],
  } as const;
  expect(portalProviderApplicationResponseSchema.safeParse(response).success).toBe(true);
  expect(
    portalProviderApplicationResponseSchema.safeParse({
      ...response,
      observations: [{ ...response.observations[0], scope: "scope\ncontrol" }],
    }).success,
  ).toBe(false);
  expect(
    portalProviderApplicationResponseSchema.safeParse({
      ...response,
      observations: [{ ...response.observations[0], observedAt: "2026-08-08T10:00:00" }],
    }).success,
  ).toBe(false);
});
