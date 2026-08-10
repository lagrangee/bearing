import type { Context, Hono } from "hono";
import { planningLineageSubjectSchema } from "../planning-lineage-route";
import { portalProjectSectionSchema } from "../portal-project-read-wire";
import { portalProviderApplicationRequestSchema } from "../portal-provider-application-wire";
import {
  ASSET_PREVIEW_CONTENT_SECURITY_POLICY,
  type AssetPreviewService,
  assetPreviewUnavailableDocument,
} from "./asset-preview";
import {
  type LinkedContentPreviewResolution,
  type LinkedContentPreviewService,
  linkedContentPreviewUnavailableDocument,
} from "./linked-content-preview";
import type { PortalProjectQueryService } from "./project-query-service";
import type { PortalProviderApplicationService } from "./provider-application";
import type { PortalSessionManager } from "./session";

type RouteOptions = Readonly<{
  assetPreview: AssetPreviewService;
  linkedContentPreview: LinkedContentPreviewService;
  projectQueries: PortalProjectQueryService;
  providerApplication: PortalProviderApplicationService;
  sessions: PortalSessionManager;
}>;

const noStore = (context: Context): void => {
  context.header("Cache-Control", "no-store");
};

const establishSession = (context: Context, sessions: PortalSessionManager) => {
  const session = sessions.establish(context.req.header("cookie"));
  if (session.cookie !== undefined) context.header("Set-Cookie", session.cookie);
  context.header("X-Bearing-CSRF-Token", session.csrfToken);
  return { csrfToken: session.csrfToken };
};

const requestFailure = () => ({
  code: "request-failed" as const,
  message: "Portal request failed.",
});

export const registerProjectRoutes = (app: Hono, options: RouteOptions): void => {
  const parseAction = async (context: Context): Promise<unknown | Response> => {
    const mediaType = context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return context.json(
        { code: "unsupported-media-type", message: "Expected application/json." },
        415,
      );
    }
    try {
      return await context.req.json();
    } catch {
      return context.json({ code: "invalid-request", message: "Request body is not JSON." }, 400);
    }
  };
  const previewHeaders = (
    context: Context,
    result: Awaited<ReturnType<AssetPreviewService["resolve"]>> | LinkedContentPreviewResolution,
  ): void => {
    context.header("Cache-Control", "no-store");
    context.header(
      "Content-Security-Policy",
      result.kind === "available"
        ? result.contentSecurityPolicy
        : ASSET_PREVIEW_CONTENT_SECURITY_POLICY,
    );
    context.header("Cross-Origin-Opener-Policy", "same-origin");
    context.header("Cross-Origin-Resource-Policy", "same-origin");
    context.header("Referrer-Policy", "no-referrer");
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
    if (result.kind === "available") {
      context.header("X-Bearing-Preview-Policy", String(result.policyVersion));
      context.header("X-Bearing-Preview-Source", result.source);
      context.header("X-Bearing-Preview-Surface", result.surface);
    } else {
      context.header("X-Bearing-Preview-Availability", result.availability);
    }
  };

  const previewResponse = (
    context: Context,
    result: Awaited<ReturnType<AssetPreviewService["resolve"]>>,
    entryId: string,
    assetId: string,
  ): Response => {
    previewHeaders(context, result);
    if (result.kind === "available") {
      context.header("Content-Type", result.contentType);
      return context.body(new Uint8Array(result.body));
    }
    const status =
      result.code === "asset-not-registered" ||
      result.code === "project-unavailable" ||
      result.code === "preview-not-offered"
        ? 404
        : 409;
    return context.html(assetPreviewUnavailableDocument(entryId, assetId, result), status);
  };

  app.get("/preview/projects/:entryId/assets/:assetId", async (context) => {
    const result = await options.assetPreview.resolve(
      context.req.param("entryId"),
      context.req.param("assetId"),
    );
    return previewResponse(
      context,
      result,
      context.req.param("entryId"),
      context.req.param("assetId"),
    );
  });

  const linkedPreviewResponse = (
    context: Context,
    result: LinkedContentPreviewResolution,
  ): Response => {
    previewHeaders(context, result);
    if (result.kind === "available") {
      context.header("Content-Type", result.contentType);
      return context.body(new Uint8Array(result.body));
    }
    return context.html(
      linkedContentPreviewUnavailableDocument(result),
      result.code === "content-missing" || result.code === "project-unavailable" ? 404 : 409,
    );
  };

  app.get("/preview/projects/:entryId/linked/:token", async (context) =>
    linkedPreviewResponse(
      context,
      await options.linkedContentPreview.resolve(
        context.req.param("entryId"),
        context.req.param("token"),
        "preview",
      ),
    ),
  );

  app.get("/preview/projects/:entryId/linked/:token/content", async (context) =>
    linkedPreviewResponse(
      context,
      await options.linkedContentPreview.resolve(
        context.req.param("entryId"),
        context.req.param("token"),
        "content",
      ),
    ),
  );

  app.get("/api/v1/projects/:entryId/read-model", async (context) => {
    noStore(context);
    const session = establishSession(context, options.sessions);
    try {
      const section = portalProjectSectionSchema.safeParse(
        context.req.query("section") ?? "overview",
      );
      if (!section.success) {
        return context.json({ version: 1, state: "failed", error: requestFailure(), session }, 400);
      }
      const targetKind = context.req.query("targetKind");
      const targetId = context.req.query("targetId");
      const target =
        targetKind === undefined && targetId === undefined
          ? undefined
          : planningLineageSubjectSchema.safeParse({ kind: targetKind, id: targetId });
      if (
        (target !== undefined && !target.success) ||
        (section.data !== "lineage" && target !== undefined)
      ) {
        return context.json({ version: 1, state: "failed", error: requestFailure(), session }, 400);
      }
      const result = await options.projectQueries.read(
        context.req.param("entryId"),
        section.data,
        target?.data,
      );
      switch (result.kind) {
        case "ready":
          return context.json({
            version: 1,
            state: "ready",
            project: result.project,
            rows: result.rows,
            session,
          });
        case "unavailable":
          return context.json({
            version: 1,
            state: "unavailable",
            project: result.project,
            diagnostic: result.diagnostic,
            session,
          });
        case "invalid-id":
        case "not-found":
          return context.json(
            { version: 1, state: "failed", error: requestFailure(), session },
            result.kind === "invalid-id" ? 400 : 404,
          );
        case "catalog-failed":
        case "read-failed":
          return context.json(
            { version: 1, state: "failed", error: requestFailure(), session },
            503,
          );
        case "read-model-unavailable":
          return context.json({ version: 1, state: "failed", error: result.error, session }, 503);
      }
    } catch {
      return context.json(
        {
          version: 1,
          state: "failed",
          error: requestFailure(),
          session,
        },
        500,
      );
    }
  });

  app.get("/api/v1/projects/:entryId/find", async (context) => {
    noStore(context);
    const query = context.req.query("query") ?? "";
    if (query.length > 200) {
      return context.json({ version: 1, state: "failed", error: requestFailure() }, 400);
    }
    const result = await options.projectQueries.search(context.req.param("entryId"), query);
    if (result.kind === "ready") {
      return context.json({ version: 1, state: "ready", ...result.find });
    }
    if (result.kind === "read-model-unavailable") {
      return context.json({ version: 1, state: "failed", error: result.error }, 503);
    }
    const status = result.kind === "invalid-id" ? 400 : result.kind === "not-found" ? 404 : 503;
    return context.json({ version: 1, state: "failed", error: requestFailure() }, status);
  });

  app.post("/api/v1/projects/:entryId/provider-observation", async (context) => {
    noStore(context);
    if (
      !options.sessions.verify(
        context.req.header("cookie"),
        context.req.header("x-bearing-csrf-token"),
      )
    ) {
      return context.json({ code: "invalid-csrf-token", message: "CSRF check failed." }, 403);
    }
    const input = await parseAction(context);
    if (input instanceof Response) return input;
    const parsed = portalProviderApplicationRequestSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        { code: "invalid-request", message: "Provider observation request is invalid." },
        400,
      );
    }
    return context.json(
      await options.providerApplication.apply(context.req.param("entryId"), parsed.data),
    );
  });
};
