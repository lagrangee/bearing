import { Hono } from "hono";
import type { PortalCatalogEnvelope } from "../portal-catalog-wire";
import { type PortalAssets, PROJECT_SNAPSHOT_VERSION } from "./assets";
import type { CatalogReadResult } from "./contract";
import { registerProjectRoutes } from "./project-routes";
import {
  createProjectService,
  type ProjectOperationExecutorFactory,
  type ProjectService,
} from "./project-service";
import { createPortalSessionManager, type PortalSessionManager } from "./session";

type PortalAppOptions = Readonly<{
  assets: PortalAssets;
  readCatalog: () => Promise<CatalogReadResult>;
  sessions: Readonly<{ secret: string }> | PortalSessionManager;
  projectService?: ProjectService;
  operationExecutorFor?: ProjectOperationExecutorFactory;
}>;

const isSessionManager = (value: PortalAppOptions["sessions"]): value is PortalSessionManager =>
  "establish" in value;

const isCrossSiteBrowserRequest = (request: Request): boolean =>
  request.headers.get("sec-fetch-site") === "cross-site";

const PORTAL_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
].join("; ");

const assetPath = (pathname: string): string => (pathname === "/" ? "/index.html" : pathname);

const isSpaRoute = (pathname: string): boolean =>
  !pathname.startsWith("/api/") &&
  pathname !== "/healthz" &&
  !pathname.split("/").at(-1)?.includes(".");

const encodingQuality = (parameters: readonly string[]): number => {
  const quality = parameters
    .map((parameter) => /^q\s*=\s*(.*)$/iu.exec(parameter.trim()))
    .find((match) => match !== null)?.[1];
  if (quality === undefined) return 1;
  return /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.test(quality) ? Number(quality) : 0;
};

const acceptsGzip = (header: string | undefined): boolean => {
  let gzipQuality: number | undefined;
  let wildcardQuality: number | undefined;
  for (const member of header?.split(",") ?? []) {
    const [coding = "", ...parameters] = member.split(";");
    const normalized = coding.trim().toLowerCase();
    const quality = encodingQuality(parameters);
    if (normalized === "gzip") gzipQuality = Math.max(gzipQuality ?? 0, quality);
    if (normalized === "*") wildcardQuality = Math.max(wildcardQuality ?? 0, quality);
  }
  return (gzipQuality ?? wildcardQuality ?? 0) > 0;
};

export const createPortalApp = (options: PortalAppOptions): Hono => {
  const app = new Hono();
  const sessions = isSessionManager(options.sessions)
    ? options.sessions
    : createPortalSessionManager(options.sessions.secret);
  const projects =
    options.projectService ??
    createProjectService({
      readCatalog: options.readCatalog,
      packageVersion: options.assets.manifest.packageVersion,
      ...(options.operationExecutorFor === undefined
        ? {}
        : { operationExecutorFor: options.operationExecutorFor }),
    });

  app.onError((_error, context) => {
    if (new URL(context.req.url).pathname.startsWith("/api/")) {
      return context.json({ code: "request-failed", message: "Portal request failed." }, 500);
    }
    return context.text("Portal request failed.", 500);
  });

  app.use("*", async (context, next) => {
    context.header("Content-Security-Policy", PORTAL_CONTENT_SECURITY_POLICY);
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    await next();
  });

  app.use("/api/*", async (context, next) => {
    if (isCrossSiteBrowserRequest(context.req.raw)) {
      return context.json(
        { code: "cross-origin-request", message: "Cross-origin API request rejected." },
        403,
      );
    }
    return next();
  });

  app.get("/healthz", (context) =>
    context.json({
      state: "ready",
      packageVersion: options.assets.manifest.packageVersion,
      readModelVersion: PROJECT_SNAPSHOT_VERSION,
    }),
  );

  app.get("/favicon.ico", (context) => context.body(null, 204));

  app.get("/api/v1/catalog", async (context) => {
    context.header("Cache-Control", "no-store");
    const session = sessions.establish(context.req.header("cookie"));
    if (session.cookie !== undefined) context.header("Set-Cookie", session.cookie);
    context.header("X-Bearing-CSRF-Token", session.csrfToken);
    let result: CatalogReadResult;
    try {
      result = await options.readCatalog();
    } catch {
      result = {
        state: "failed",
        diagnostic: {
          code: "catalog-unavailable",
          message: "Project Catalog is unavailable.",
        },
      };
    }
    const base = { version: 1 as const, session: { csrfToken: session.csrfToken } };
    let response: PortalCatalogEnvelope;
    switch (result.state) {
      case "ready":
        response = {
          ...base,
          state: "ready",
          entries: result.entries,
        } satisfies PortalCatalogEnvelope;
        break;
      case "degraded":
        response = {
          ...base,
          state: "degraded",
          entries: result.entries,
          diagnostic: {
            code: result.diagnostic.code,
            message: "Project Catalog is using its last-known-good backup; run explicit repair.",
          },
        } satisfies PortalCatalogEnvelope;
        break;
      case "failed":
        response = {
          ...base,
          state: "failed",
          entries: [],
          diagnostic: {
            code: result.diagnostic.code,
            message: "No trustworthy Project Catalog is available.",
          },
        } satisfies PortalCatalogEnvelope;
        break;
    }
    return context.json(response);
  });

  registerProjectRoutes(app, { projects, sessions });

  app.all("/api/*", (context) =>
    context.json({ code: "not-found", message: "No such Portal product action." }, 404),
  );

  app.get("*", (context) => {
    const requested = assetPath(new URL(context.req.url).pathname);
    const asset =
      options.assets.get(requested) ??
      (isSpaRoute(requested) ? options.assets.get("/index.html") : undefined);
    if (asset === undefined) return context.text("Not found", 404);
    const useGzip =
      asset.gzipBytes !== undefined && acceptsGzip(context.req.header("accept-encoding"));
    context.header("Content-Type", asset.contentType);
    context.header("ETag", useGzip ? (asset.gzipEtag ?? asset.etag) : asset.etag);
    context.header(
      "Cache-Control",
      asset.immutable ? "public, max-age=31536000, immutable" : "no-cache",
    );
    if (asset.gzipBytes !== undefined) context.header("Vary", "Accept-Encoding");
    if (useGzip) context.header("Content-Encoding", "gzip");
    return context.body(new Uint8Array(useGzip ? (asset.gzipBytes ?? asset.bytes) : asset.bytes));
  });

  return app;
};
