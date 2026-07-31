import type { Context, Hono } from "hono";
import { normalizeNativeReconciliationRequest } from "../native-reconciliation-contract";
import type { PortalDiagnostic } from "./contract";
import {
  type ProjectFailureView,
  type ProjectOperationError,
  type ProjectSnapshotApiResponse,
  type ProjectSyncApiResponse,
  type ProjectSyncRequest,
  projectDiscoveryRequestSchema,
  projectNativeReconciliationRequestSchema,
  projectNativeScopeInspectionRequestSchema,
  projectSyncRequestSchema,
} from "./project-contract";
import type { ProjectService } from "./project-service";
import type {
  ProjectReadServiceResult,
  ProjectSyncServiceResult,
} from "./project-service-contract";
import type { PortalSessionManager } from "./session";

type RouteOptions = Readonly<{
  projects: ProjectService;
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
const operationMessages: Readonly<Record<ProjectOperationError["code"], string>> = {
  "request-failed": "Portal request failed.",
  "project-unavailable": "The registered project is currently unavailable.",
  "unsafe-project-cache": "The project cache boundary is unsafe.",
  "input-validation-failed": "Project inputs could not be validated.",
  "sync-failed": "Project reconciliation failed.",
  "snapshot-materialization-failed": "Project Snapshot materialization failed.",
  "snapshot-write-failed": "Project cache could not be saved.",
};
const fixedError = (code: ProjectOperationError["code"]): ProjectOperationError => ({
  code,
  message: operationMessages[code],
});
const sanitizeError = (
  error: PortalDiagnostic,
  fallback: ProjectOperationError["code"] = "request-failed",
): ProjectOperationError => {
  const code = Object.hasOwn(operationMessages, error.code)
    ? (error.code as ProjectOperationError["code"])
    : fallback;
  return fixedError(code);
};
const validationUnavailable = { due: true, cooldownRemainingMs: 0, inFlight: false } as const;

const readResponse = (
  context: Context,
  result: ProjectReadServiceResult,
  session: Readonly<{ csrfToken: string }>,
): Response => {
  switch (result.kind) {
    case "ready": {
      const response: ProjectSnapshotApiResponse = {
        version: 1,
        state: "ready",
        view: result.view,
        validation: result.validation,
        session,
      };
      return context.json(response);
    }
    case "unavailable": {
      const response: ProjectSnapshotApiResponse = {
        version: 1,
        state: "unavailable",
        project: result.project,
        diagnostic: sanitizeError(result.diagnostic, "project-unavailable"),
        session,
      };
      return context.json(response);
    }
    case "invalid-id":
    case "not-found": {
      const response: ProjectSnapshotApiResponse = {
        version: 1,
        state: "failed",
        error: result.kind === "invalid-id" ? requestFailure() : fixedError("project-unavailable"),
        session,
      };
      return context.json(response, result.kind === "invalid-id" ? 400 : 404);
    }
    case "catalog-failed": {
      const response: ProjectSnapshotApiResponse = {
        version: 1,
        state: "failed",
        error: requestFailure(),
        session,
      };
      return context.json(response, 503);
    }
    case "read-failed":
      return context.json(
        {
          version: 1,
          state: "failed",
          error: sanitizeError(result.error),
          session,
        } satisfies ProjectSnapshotApiResponse,
        500,
      );
  }
};

const syncResponse = (
  context: Context,
  result: ProjectSyncServiceResult,
  requestedMode: ProjectSyncRequest["mode"],
): Response => {
  switch (result.kind) {
    case "completed": {
      const response = {
        version: 1,
        state: "completed",
        mode: result.mode,
        outcome: result.outcome,
        ...(result.reconciliation === undefined ? {} : { reconciliation: result.reconciliation }),
        snapshotDisposition: result.snapshotDisposition,
        view: result.view,
        validation: result.validation,
      } as ProjectSyncApiResponse;
      return context.json(response);
    }
    case "cooldown": {
      const response: ProjectSyncApiResponse = {
        version: 1,
        state: "cooldown",
        mode: result.mode,
        outcome: result.outcome,
        view: result.view,
        validation: result.validation,
      };
      return context.json(response);
    }
    case "failed": {
      const presentation: ProjectFailureView =
        result.view === undefined
          ? result.viewDisposition === "discard"
            ? { viewDisposition: "discard" }
            : {}
          : { view: result.view };
      const response: ProjectSyncApiResponse = {
        version: 1,
        state: "failed",
        mode: result.mode,
        outcome: result.outcome,
        error: sanitizeError(result.error),
        ...presentation,
        validation: result.validation,
      };
      return context.json(response);
    }
    case "unavailable":
      return context.json({
        version: 1,
        state: "unavailable",
        project: result.project,
        diagnostic: sanitizeError(result.diagnostic, "project-unavailable"),
      });
    case "invalid-id":
    case "not-found":
    case "catalog-failed": {
      const response: ProjectSyncApiResponse = {
        version: 1,
        state: "failed",
        mode: requestedMode,
        outcome: "failed",
        error: result.kind === "not-found" ? fixedError("project-unavailable") : requestFailure(),
        validation: validationUnavailable,
      };
      return context.json(response);
    }
  }
};

export const registerProjectRoutes = (app: Hono, options: RouteOptions): void => {
  app.get("/api/v1/projects/:entryId/snapshot", async (context) => {
    noStore(context);
    const session = establishSession(context, options.sessions);
    try {
      return readResponse(
        context,
        await options.projects.read(context.req.param("entryId")),
        session,
      );
    } catch {
      return context.json(
        {
          version: 1,
          state: "failed",
          error: requestFailure(),
          session,
        } satisfies ProjectSnapshotApiResponse,
        500,
      );
    }
  });

  app.post("/api/v1/projects/:entryId/sync", async (context) => {
    noStore(context);
    if (
      !options.sessions.verify(
        context.req.header("cookie"),
        context.req.header("x-bearing-csrf-token"),
      )
    ) {
      return context.json({ code: "invalid-csrf-token", message: "CSRF check failed." }, 403);
    }
    const mediaType = context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return context.json(
        { code: "unsupported-media-type", message: "Expected application/json." },
        415,
      );
    }
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ code: "invalid-request", message: "Request body is not JSON." }, 400);
    }
    const parsed = projectSyncRequestSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        { code: "invalid-request", message: "Project Sync request is invalid." },
        400,
      );
    }
    return syncResponse(
      context,
      await options.projects.sync(context.req.param("entryId"), parsed.data.mode),
      parsed.data.mode,
    );
  });

  app.post("/api/v1/projects/:entryId/discover-native-scopes", async (context) => {
    noStore(context);
    if (
      !options.sessions.verify(
        context.req.header("cookie"),
        context.req.header("x-bearing-csrf-token"),
      )
    ) {
      return context.json({ code: "invalid-csrf-token", message: "CSRF check failed." }, 403);
    }
    const mediaType = context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return context.json(
        { code: "unsupported-media-type", message: "Expected application/json." },
        415,
      );
    }
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ code: "invalid-request", message: "Request body is not JSON." }, 400);
    }
    if (!projectDiscoveryRequestSchema.safeParse(input).success) {
      return context.json(
        { code: "invalid-request", message: "Native Scope Discovery request is invalid." },
        400,
      );
    }
    return syncResponse(
      context,
      await options.projects.sync(context.req.param("entryId"), "force", "explicit-discovery"),
      "force",
    );
  });

  app.post("/api/v1/projects/:entryId/inspect-native-scope", async (context) => {
    noStore(context);
    if (
      !options.sessions.verify(
        context.req.header("cookie"),
        context.req.header("x-bearing-csrf-token"),
      )
    ) {
      return context.json({ code: "invalid-csrf-token", message: "CSRF check failed." }, 403);
    }
    const mediaType = context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return context.json(
        { code: "unsupported-media-type", message: "Expected application/json." },
        415,
      );
    }
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ code: "invalid-request", message: "Request body is not JSON." }, 400);
    }
    const parsed = projectNativeScopeInspectionRequestSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        { code: "invalid-request", message: "Native Scope Inspection request is invalid." },
        400,
      );
    }
    return syncResponse(
      context,
      await options.projects.sync(context.req.param("entryId"), "force", "ordinary-sync", {
        kind: "inspect",
        subject: parsed.data.subject,
        target: parsed.data.target,
        refresh: parsed.data.refresh,
      }),
      "force",
    );
  });

  app.post("/api/v1/projects/:entryId/reconcile-native", async (context) => {
    noStore(context);
    if (
      !options.sessions.verify(
        context.req.header("cookie"),
        context.req.header("x-bearing-csrf-token"),
      )
    ) {
      return context.json({ code: "invalid-csrf-token", message: "CSRF check failed." }, 403);
    }
    const mediaType = context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return context.json(
        { code: "unsupported-media-type", message: "Expected application/json." },
        415,
      );
    }
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ code: "invalid-request", message: "Request body is not JSON." }, 400);
    }
    const parsed = projectNativeReconciliationRequestSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        { code: "invalid-request", message: "Native reconciliation request is invalid." },
        400,
      );
    }
    return syncResponse(
      context,
      await options.projects.sync(context.req.param("entryId"), "force", "ordinary-sync", {
        kind: "reconcile",
        request: normalizeNativeReconciliationRequest(parsed.data),
      }),
      "force",
    );
  });
};
