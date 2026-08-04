import { expect, test } from "bun:test";
import { access, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { createPortalApp } from "../src/portal/app";
import type { PortalAssets } from "../src/portal/assets";
import type { CatalogReadResult } from "../src/portal/contract";
import type { ProjectView } from "../src/portal/project-contract";
import type { ProjectService } from "../src/portal/project-service";
import {
  projectSnapshotEnvelopeSchema,
  projectSyncEnvelopeSchema,
} from "../src/portal-ui/project-contract";
import { runSync } from "../src/sync";
import { createValidBearingRepo } from "./helpers";

const ORIGIN = "http://127.0.0.1:4178";
const SESSION_SECRET = "ticket-11-project-api-session-secret-32-bytes";
const PROJECT_ID = "project-1";

const assets: PortalAssets = {
  manifest: {
    schemaVersion: 1,
    packageVersion: "0.0.0-test",
    interfaceVersion: 1,
    projectSnapshotVersion: 19,
    entry: "index.html",
    buildId: "0".repeat(64),
    assets: [
      {
        path: "index.html",
        contentType: "text/html; charset=utf-8",
        byteLength: 0,
        sha256: "0".repeat(64),
      },
    ],
  },
  get: () => undefined,
};

const catalogFor =
  (repoRoot: string): (() => Promise<CatalogReadResult>) =>
  async () => ({
    state: "ready",
    entries: [
      {
        entryId: PROJECT_ID,
        displayName: "Fixture",
        repoRoot,
        availability: "available",
      },
    ],
  });

const appFor = (readCatalog: () => Promise<CatalogReadResult>, projectService?: ProjectService) =>
  createPortalApp({
    assets,
    readCatalog,
    sessions: { secret: SESSION_SECRET },
    operationExecutorFor: () => (operation) => operation((_phase, write) => write()),
    ...(projectService === undefined ? {} : { projectService }),
  });

const emptyView: ProjectView = {
  project: { entryId: PROJECT_ID, displayName: "Fixture", availability: "available" },
  cache: { snapshot: { state: "missing" }, receipt: null, retained: false },
  diagnosticCounts: null,
};

const establish = async (app: ReturnType<typeof createPortalApp>) => {
  const response = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/snapshot`);
  const cookie = response.headers.get("set-cookie");
  const csrfToken = response.headers.get("x-bearing-csrf-token");
  if (cookie === null || csrfToken === null) throw new Error("Session was not established.");
  return { response, cookie, csrfToken };
};

test("direct project GET establishes a session and remains strictly cache-only", async () => {
  const root = await realpath(await createValidBearingRepo());
  try {
    await runSync(root, {
      completedAt: "2026-07-13T12:00:00.000Z",
      providerObservationIntent: "initial-baseline",
    });
    const app = appFor(catalogFor(root));

    const { response } = await establish(app);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      version: 1,
      state: "ready",
      view: {
        project: { entryId: PROJECT_ID, displayName: "Fixture" },
        cache: { snapshot: { state: "missing" } },
      },
      validation: { due: true, inFlight: false },
    });
    expect(JSON.stringify(body)).not.toContain(root);
    expect(JSON.stringify(body)).not.toContain("repoRoot");
    await expect(access(join(root, ".bearing/cache/project-snapshot.json"))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GET read failures keep the typed server and browser contract aligned with the session", async () => {
  const root = await realpath(await createValidBearingRepo());
  const validation = { due: true, cooldownRemainingMs: 0, inFlight: false };
  const projects: ProjectService = {
    read: async () => ({
      kind: "read-failed",
      error: { code: "input-validation-failed", message: "Project inputs could not be validated." },
    }),
    sync: async (_entryId, mode) => ({
      kind: "failed",
      mode,
      outcome: "failed",
      error: { code: "input-validation-failed", message: "Project inputs could not be validated." },
      validation,
    }),
  };
  const app = appFor(catalogFor(root), projects);

  const response = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/snapshot`);
  const body = await response.json();
  const csrfToken = response.headers.get("x-bearing-csrf-token");

  expect(response.status).toBe(500);
  expect(response.headers.get("set-cookie")).toContain("bearing_session=");
  expect(body).toEqual({
    version: 1,
    state: "failed",
    error: { code: "input-validation-failed", message: "Project inputs could not be validated." },
    session: { csrfToken },
  });
  expect(projectSnapshotEnvelopeSchema.safeParse(body).success).toBe(true);
});

test("Catalog failure stays inside the sanitized public Project API contract", async () => {
  const privateDiagnostic = {
    code: "catalog-unusable",
    message: "Catalog failed at /Users/private/.bearing/catalog.json.",
  };
  const app = appFor(async () => ({ state: "failed", diagnostic: privateDiagnostic }));

  const established = await establish(app);
  const readBody = await established.response.json();

  expect(established.response.status).toBe(503);
  expect(readBody).toEqual({
    version: 1,
    state: "failed",
    error: { code: "request-failed", message: "Portal request failed." },
    session: { csrfToken: established.csrfToken },
  });
  expect(projectSnapshotEnvelopeSchema.safeParse(readBody).success).toBe(true);

  const syncResponse = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/sync`, {
    method: "POST",
    headers: {
      Cookie: established.cookie,
      "Content-Type": "application/json",
      "X-Bearing-CSRF-Token": established.csrfToken,
    },
    body: JSON.stringify({ version: 1, mode: "force" }),
  });
  const syncBody = await syncResponse.json();

  expect(syncResponse.status).toBe(200);
  expect(syncBody).toEqual({
    version: 1,
    state: "failed",
    mode: "force",
    outcome: "failed",
    error: { code: "request-failed", message: "Portal request failed." },
    validation: { due: true, cooldownRemainingMs: 0, inFlight: false },
  });
  expect(projectSyncEnvelopeSchema.safeParse(syncBody).success).toBe(true);
  expect(JSON.stringify([readBody, syncBody])).not.toContain("catalog-unusable");
  expect(JSON.stringify([readBody, syncBody])).not.toContain("/Users/private");
});

test("entry failures use only sanitized v1 error and diagnostic codes", async () => {
  const unavailable = {
    kind: "unavailable" as const,
    project: { entryId: PROJECT_ID, displayName: "Fixture", availability: "unreadable" as const },
    diagnostic: { code: "catalog-unusable", message: "Failed at /Users/private/repository." },
  };
  const projects: ProjectService = {
    read: async () => unavailable,
    sync: async () => unavailable,
  };
  const app = appFor(async () => ({ state: "ready", entries: [] }), projects);
  const established = await establish(app);
  const readBody = await established.response.json();

  expect(readBody).toMatchObject({
    version: 1,
    state: "unavailable",
    diagnostic: {
      code: "project-unavailable",
      message: "The registered project is currently unavailable.",
    },
    session: { csrfToken: established.csrfToken },
  });
  expect(projectSnapshotEnvelopeSchema.safeParse(readBody).success).toBe(true);

  const syncResponse = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/sync`, {
    method: "POST",
    headers: {
      Cookie: established.cookie,
      "Content-Type": "application/json",
      "X-Bearing-CSRF-Token": established.csrfToken,
    },
    body: JSON.stringify({ version: 1, mode: "ensure-current" }),
  });
  const syncBody = await syncResponse.json();

  expect(syncBody).toMatchObject({
    version: 1,
    state: "unavailable",
    diagnostic: {
      code: "project-unavailable",
      message: "The registered project is currently unavailable.",
    },
  });
  expect(projectSyncEnvelopeSchema.safeParse(syncBody).success).toBe(true);
  expect(JSON.stringify([readBody, syncBody])).not.toContain("catalog-unusable");
  expect(JSON.stringify([readBody, syncBody])).not.toContain("/Users/private");
});

test("unexpected project request exceptions stay typed and do not disclose internals", async () => {
  const root = await realpath(await createValidBearingRepo());
  const projects: ProjectService = {
    read: async () => {
      throw new Error(`Cannot read ${root}/private-cache`);
    },
    sync: async () => {
      throw new Error(`Cannot write ${root}/private-cache`);
    },
  };
  const app = appFor(catalogFor(root), projects);

  const failedRead = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/snapshot`);
  const failedReadBody = await failedRead.json();
  expect(failedRead.status).toBe(500);
  expect(failedReadBody).toMatchObject({
    version: 1,
    state: "failed",
    error: { code: "request-failed", message: "Portal request failed." },
    session: { csrfToken: expect.any(String) },
  });
  expect(JSON.stringify(failedReadBody)).not.toContain(root);

  const established = await app.request(`${ORIGIN}/api/v1/catalog`);
  const cookie = established.headers.get("set-cookie");
  const csrfToken = established.headers.get("x-bearing-csrf-token");
  if (cookie === null || csrfToken === null) throw new Error("Session was not established.");
  const failedSync = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/sync`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-Bearing-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ version: 1, mode: "force" }),
  });
  const failedSyncBody = await failedSync.json();
  expect(failedSync.status).toBe(500);
  expect(failedSyncBody).toEqual({ code: "request-failed", message: "Portal request failed." });
  expect(JSON.stringify(failedSyncBody)).not.toContain(root);
  expect((await app.request(`${ORIGIN}/api/v1/catalog`)).status).toBe(200);
});

test("POST rejects missing CSRF and malformed input before project work", async () => {
  const root = await realpath(await createValidBearingRepo());
  try {
    await runSync(root, {
      completedAt: "2026-07-13T12:00:00.000Z",
      providerObservationIntent: "initial-baseline",
    });
    const app = appFor(catalogFor(root));

    const missingCsrf = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, mode: "ensure-current" }),
    });
    expect(missingCsrf.status).toBe(403);
    const removedDiscovery = await app.request(
      `${ORIGIN}/api/v1/projects/${PROJECT_ID}/discover-native-scopes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1 }),
      },
    );
    expect(removedDiscovery.status).toBe(404);
    await expect(access(join(root, ".bearing/cache/project-snapshot.json"))).rejects.toThrow();

    const { cookie, csrfToken } = await establish(app);
    const wrongMediaType = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/sync`, {
      method: "POST",
      headers: { Cookie: cookie, "X-Bearing-CSRF-Token": csrfToken },
      body: JSON.stringify({ version: 1, mode: "ensure-current" }),
    });
    expect(wrongMediaType.status).toBe(415);

    const extraField = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/sync`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-Bearing-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ version: 1, mode: "ensure-current", repoRoot: root }),
    });
    expect(extraField.status).toBe(400);
    await expect(access(join(root, ".bearing/cache/project-snapshot.json"))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("POST rejects cross-session, forged-cookie, and cross-site browser authority before project work", async () => {
  const root = await realpath(await createValidBearingRepo());
  const validation = { due: true, cooldownRemainingMs: 0, inFlight: false };
  let syncCalls = 0;
  const projects: ProjectService = {
    read: async () => ({ kind: "ready", view: emptyView, validation }),
    sync: async (_entryId, mode) => {
      syncCalls += 1;
      return {
        kind: "failed",
        mode,
        outcome: "failed",
        error: { code: "request-failed", message: "Portal request failed." },
        validation,
      };
    },
  };
  const app = appFor(catalogFor(root), projects);
  const first = await establish(app);
  const second = await establish(app);
  const cookie = first.cookie.split(";", 1)[0] ?? first.cookie;
  const forgedCookie = `${cookie.slice(0, -1)}${cookie.endsWith("a") ? "b" : "a"}`;
  const request = (headers: Readonly<Record<string, string>>) =>
    app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ version: 1, mode: "force" }),
    });

  const crossSession = await request({
    Cookie: cookie,
    "X-Bearing-CSRF-Token": second.csrfToken,
  });
  const forged = await request({
    Cookie: forgedCookie,
    "X-Bearing-CSRF-Token": first.csrfToken,
  });
  const crossSite = await request({
    Cookie: cookie,
    "Sec-Fetch-Site": "cross-site",
    "X-Bearing-CSRF-Token": first.csrfToken,
  });

  expect(await crossSession.json()).toMatchObject({ code: "invalid-csrf-token" });
  expect(await forged.json()).toMatchObject({ code: "invalid-csrf-token" });
  expect(await crossSite.json()).toMatchObject({ code: "cross-origin-request" });
  expect([crossSession.status, forged.status, crossSite.status]).toEqual([403, 403, 403]);
  expect(syncCalls).toBe(0);
});

test("native scope inspection route validates authority and forwards one typed target intent", async () => {
  const root = await realpath(await createValidBearingRepo());
  const validation = { due: true, cooldownRemainingMs: 0, inFlight: false };
  const calls: unknown[][] = [];
  const projects: ProjectService = {
    read: async () => ({ kind: "ready", view: emptyView, validation }),
    sync: async (...args) => {
      calls.push(args);
      return {
        kind: "failed",
        mode: args[1],
        outcome: "failed",
        error: { code: "request-failed", message: "Portal request failed." },
        validation,
      };
    },
  };
  const app = appFor(catalogFor(root), projects);
  const { cookie, csrfToken } = await establish(app);
  const endpoint = `${ORIGIN}/api/v1/projects/${PROJECT_ID}/inspect-native-scope`;
  const request = (body: unknown, token = csrfToken) =>
    app.request(endpoint, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-Bearing-CSRF-Token": token,
      },
      body: JSON.stringify(body),
    });

  expect(
    (
      await request(
        {
          version: 1,
          subject: { kind: "native-scope", id: ".scratch/unbound" },
          target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
          refresh: false,
        },
        "invalid",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request({
        version: 1,
        subject: { kind: "effort", id: "effort:test" },
        target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
        refresh: false,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request({
        version: 1,
        subject: { kind: "native-scope", id: ".scratch/unbound\nforged" },
        target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
        refresh: false,
      })
    ).status,
  ).toBe(400);
  expect(calls).toEqual([]);

  const response = await request({
    version: 1,
    subject: { kind: "native-subject", id: ".scratch/unbound/issues/01-work.md" },
    target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
    refresh: true,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    version: 1,
    state: "failed",
    mode: "force",
  });
  expect(calls).toEqual([
    [
      PROJECT_ID,
      "force",
      {
        kind: "inspect",
        subject: {
          kind: "native-subject",
          id: ".scratch/unbound/issues/01-work.md",
        },
        target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
        refresh: true,
      },
    ],
  ]);
});

test("targeted native reconciliation route validates a bounded read set and forwards no mutation authority", async () => {
  const root = await realpath(await createValidBearingRepo());
  const validation = { due: true, cooldownRemainingMs: 0, inFlight: false };
  const calls: unknown[][] = [];
  const projects: ProjectService = {
    read: async () => ({ kind: "ready", view: emptyView, validation }),
    sync: async (...args) => {
      calls.push(args);
      return {
        kind: "failed",
        mode: args[1],
        outcome: "failed",
        error: { code: "request-failed", message: "Portal request failed." },
        validation,
      };
    },
  };
  const app = appFor(catalogFor(root), projects);
  const { cookie, csrfToken } = await establish(app);
  const endpoint = `${ORIGIN}/api/v1/projects/${PROJECT_ID}/reconcile-native`;
  const request = (body: unknown, token = csrfToken) =>
    app.request(endpoint, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-Bearing-CSRF-Token": token,
      },
      body: JSON.stringify(body),
    });
  const body = {
    schemaVersion: 1,
    binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
    subjects: [
      ".scratch/work/issues/02-follow-up.md",
      ".scratch/work/issues/01-finish.md",
      ".scratch/work/issues/02-follow-up.md",
    ],
    relations: [
      {
        kind: "blocked-by",
        source: ".scratch/work/issues/02-follow-up.md",
        target: ".scratch/work/issues/01-finish.md",
      },
      {
        kind: "blocked-by",
        source: ".scratch/work/issues/02-follow-up.md",
        target: ".scratch/work/issues/01-finish.md",
      },
    ],
  } as const;

  expect((await request(body, "invalid")).status).toBe(403);
  expect(
    (
      await request({
        ...body,
        subjects: [],
        relations: [],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request({
        ...body,
        mutation: { close: true },
      })
    ).status,
  ).toBe(400);
  expect(calls).toEqual([]);

  const response = await request(body);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    version: 1,
    state: "failed",
    mode: "force",
  });
  expect(calls).toEqual([
    [
      PROJECT_ID,
      "force",
      {
        kind: "reconcile",
        request: {
          ...body,
          subjects: [".scratch/work/issues/01-finish.md", ".scratch/work/issues/02-follow-up.md"],
          relations: [body.relations[0]],
        },
      },
    ],
  ]);
});

test("ensure-current, cooldown, and force return complete typed project views", async () => {
  const root = await realpath(await createValidBearingRepo());
  try {
    await runSync(root, {
      completedAt: "2026-07-13T12:00:00.000Z",
      providerObservationIntent: "initial-baseline",
    });
    const app = appFor(catalogFor(root));
    const { cookie, csrfToken } = await establish(app);
    const headers = {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-Bearing-CSRF-Token": csrfToken,
    };
    const sync = (mode: "ensure-current" | "force") =>
      app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/sync`, {
        method: "POST",
        headers,
        body: JSON.stringify({ version: 1, mode }),
      });

    const ensured = await sync("ensure-current");
    const ensuredBody = await ensured.json();
    expect(ensured.status).toBe(200);
    expect(ensuredBody).toMatchObject({
      version: 1,
      state: "completed",
      mode: "ensure-current",
      outcome: "materialized",
      snapshotDisposition: "materialized",
      view: { cache: { snapshot: { state: "available" } } },
    });
    expect(JSON.stringify(ensuredBody)).not.toContain(root);
    expect(ensuredBody.view.cache.snapshot.snapshot).toMatchObject({
      roadmaps: {
        validity: "available",
        items: [
          {
            id: "roadmap:test",
            focusedGateId: "gate:test",
            gateOrder: ["gate:test"],
            effortIds: ["effort:test"],
          },
        ],
      },
      gates: {
        validity: "available",
        items: [
          {
            id: "gate:test",
            exitCriteria: ["All fixture work resolves."],
            effortIds: ["effort:test"],
          },
        ],
      },
      efforts: {
        validity: "available",
        items: [
          {
            id: "effort:test",
            roadmapId: "roadmap:test",
            targetGateId: "gate:test",
            lifecycle: "active",
            workBinding: {
              provider: "matt-skills/v1",
              nativeScope: ".scratch/work",
            },
          },
        ],
      },
      providerObservations: [
        {
          provider: "matt-skills/v1",
          binding: { nativeScope: ".scratch/work" },
          state: "available",
          completion: "complete",
          projection: {
            map: { ref: ".scratch/work/map.md" },
            wayfinderTickets: [{ ref: ".scratch/work/issues/01-finish.md" }],
          },
        },
      ],
    });

    const removedDiscovery = await app.request(
      `${ORIGIN}/api/v1/projects/${PROJECT_ID}/discover-native-scopes`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ version: 1 }),
      },
    );
    expect(removedDiscovery.status).toBe(404);
    expect("nativeScopeDiscovery" in ensuredBody.view.cache.snapshot.snapshot).toBe(false);
    expect(
      await access(join(root, ".bearing/cache/native-scope-discovery.json")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);

    expect(await (await sync("ensure-current")).json()).toMatchObject({
      state: "cooldown",
      outcome: "cooldown",
    });
    expect(await (await sync("force")).json()).toMatchObject({
      state: "completed",
      mode: "force",
      outcome: "no-op",
      reconciliation: "no-op",
      view: { cache: { snapshot: { state: "available" } } },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project identity failures remain typed and never expose registered paths", async () => {
  const root = await realpath(await createValidBearingRepo());
  try {
    const unavailableCatalog = async (): Promise<CatalogReadResult> => ({
      state: "ready",
      entries: [
        {
          entryId: PROJECT_ID,
          displayName: "Fixture",
          repoRoot: root,
          availability: "missing",
        },
      ],
    });
    const app = appFor(unavailableCatalog);

    const unavailable = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/snapshot`);
    const unavailableBody = await unavailable.json();
    expect(unavailable.status).toBe(200);
    expect(unavailableBody).toMatchObject({
      version: 1,
      state: "unavailable",
      project: { entryId: PROJECT_ID, displayName: "Fixture", availability: "missing" },
      diagnostic: { code: "project-unavailable" },
    });
    expect(JSON.stringify(unavailableBody)).not.toContain(root);

    const unknown = await app.request(`${ORIGIN}/api/v1/projects/unknown/snapshot`);
    const unknownBody = await unknown.json();
    expect(unknown.status).toBe(404);
    expect(unknownBody).toEqual({
      version: 1,
      state: "failed",
      error: {
        code: "project-unavailable",
        message: "The registered project is currently unavailable.",
      },
      session: { csrfToken: expect.any(String) },
    });
    expect(projectSnapshotEnvelopeSchema.safeParse(unknownBody).success).toBe(true);

    const invalid = await app.request(`${ORIGIN}/api/v1/projects/%2E%2E%2Fescape/snapshot`);
    expect(invalid.status).toBe(400);
    expect(projectSnapshotEnvelopeSchema.safeParse(await invalid.json()).success).toBe(true);

    const { cookie, csrfToken } = await establish(app);
    const unknownSync = await app.request(`${ORIGIN}/api/v1/projects/unknown/sync`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-Bearing-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ version: 1, mode: "force" }),
    });
    const unknownSyncBody = await unknownSync.json();
    expect(unknownSyncBody).toMatchObject({
      state: "failed",
      mode: "force",
      error: { code: "project-unavailable" },
    });
    expect(projectSyncEnvelopeSchema.safeParse(unknownSyncBody).success).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serializes an explicit discard disposition when a relinked cache cannot be read", async () => {
  const root = await realpath(await createValidBearingRepo());
  try {
    const validation = { due: true, cooldownRemainingMs: 0, inFlight: false };
    const projects: ProjectService = {
      read: async () => ({ kind: "ready", view: emptyView, validation }),
      sync: async (_entryId, mode) => ({
        kind: "failed",
        mode,
        outcome: "failed",
        error: {
          code: "input-validation-failed",
          message: "The registered project location changed while this operation was in flight.",
        },
        viewDisposition: "discard",
        validation,
      }),
    };
    const app = appFor(catalogFor(root), projects);
    const { cookie, csrfToken } = await establish(app);

    const response = await app.request(`${ORIGIN}/api/v1/projects/${PROJECT_ID}/sync`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-Bearing-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ version: 1, mode: "ensure-current" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      version: 1,
      state: "failed",
      viewDisposition: "discard",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
