import type {
  PortalProviderApplicationRequest,
  PortalProviderApplicationResponse,
} from "../portal-provider-application-wire";
import {
  captureProjectProviderScopes,
  type ProviderOperationDependencies,
  refreshProjectProviderDetail,
  verifyAllProjectProviderScopes,
} from "../project-read-model/provider-operations";
import { inspectProjectReadModel, readProjectProviderEvidence } from "../project-read-model/store";
import {
  mattNativeBindingDefinitionKey,
  mattNativeSubjectForObject,
  sameMattNativeBindingDefinition,
} from "../providers/matt-skills-v1/native-subject";
import { mattObjects } from "../providers/matt-skills-v1/projection";
import { inspectRepositoryIntegrationLifecycle } from "../repository-integration-lifecycle";
import type { StructuralDiagnostic } from "../types";
import type { CatalogReadResult } from "./contract";
import { createProjectCoordinator, type ProjectOperation } from "./project-coordinator";
import { resolveProjectEntry } from "./project-entry";

type AttentionCondition = Extract<
  PortalProviderApplicationResponse,
  { state: "attention" }
>["condition"];

const conditionPresentation: Readonly<
  Record<AttentionCondition, Readonly<{ explanation: string; nextAction: string }>>
> = {
  "baseline-missing": {
    explanation: "No usable baseline is available for this exact source.",
    nextAction: "Open Bearing in the Agent Surface to inspect the Work Binding and evidence.",
  },
  "provider-auth": {
    explanation: "Provider authorization prevented this source refresh.",
    nextAction: "Open Bearing in the Agent Surface to restore provider authorization.",
  },
  "provider-rate-limit": {
    explanation: "The provider rate limit prevented this source refresh.",
    nextAction: "Open Bearing in the Agent Surface to inspect the provider limit and timing.",
  },
  "provider-network": {
    explanation: "The provider network was unavailable for this source refresh.",
    nextAction: "Open Bearing in the Agent Surface to diagnose provider connectivity.",
  },
  "provider-unavailable": {
    explanation: "The provider could not complete this source refresh.",
    nextAction: "Open Bearing in the Agent Surface to inspect the provider diagnostic.",
  },
  "storage-recovery-required": {
    explanation: "Project data storage requires explicit recovery.",
    nextAction: "Open Bearing in the Agent Surface to review and run cache recovery.",
  },
  "need-update": {
    explanation: "This project data requires a newer compatible Bearing runtime.",
    nextAction: "Open Bearing in the Agent Surface to update the installed Bearing kit.",
  },
  "removal-required": {
    explanation: "The repository integration is invalid or unsupported.",
    nextAction:
      "Open Bearing in the Agent Surface for reviewed platform removal before Fresh Configuration.",
  },
};

const providerFailureCondition = (
  diagnostics: readonly StructuralDiagnostic[],
): AttentionCondition => {
  const codes = diagnostics.map((diagnostic) => diagnostic.code.toLowerCase());
  if (codes.some((code) => /auth|permission/u.test(code))) return "provider-auth";
  if (codes.some((code) => /rate|limit/u.test(code))) return "provider-rate-limit";
  if (codes.some((code) => /network|timeout|connect/u.test(code))) return "provider-network";
  if (
    codes.some((code) =>
      /provider-scope-selection-invalid|provider-observation-unavailable|missing-provider/u.test(
        code,
      ),
    )
  ) {
    return "baseline-missing";
  }
  return diagnostics.length === 0 ? "baseline-missing" : "provider-unavailable";
};

const publicDiagnostics = (diagnostics: readonly StructuralDiagnostic[]) => [
  ...new Map(
    diagnostics.map((diagnostic) => [
      diagnostic.code,
      {
        reference: diagnostic.code,
        summary: "Source refresh needs Agent Surface attention.",
      },
    ]),
  ).values(),
];

const applicationDiagnostic = (
  code: string,
  target: string,
  message: string,
): StructuralDiagnostic => ({ code, impact: "blocking", target, message });

const observedEvidence = async (
  repoRoot: string,
  scopes: readonly string[],
  role: "bound" | "detail",
) => {
  const requested = new Set(scopes);
  return (await readProjectProviderEvidence(repoRoot, role))
    .filter((entry) => requested.has(entry.selection.nativeScope))
    .map((entry) => ({
      scope: entry.selection.nativeScope,
      disposition:
        entry.selection.latestAttempt?.outcome === "succeeded"
          ? ("captured" as const)
          : entry.observation === undefined
            ? ("unavailable" as const)
            : ("retained-after-failure" as const),
      ...(entry.observation?.observedAt === undefined
        ? {}
        : { observedAt: entry.observation.observedAt }),
    }));
};

const itemTargetAdmission = async (
  repoRoot: string,
  request: Extract<PortalProviderApplicationRequest, { action: "item-refresh" }>,
): Promise<
  | Readonly<{ state: "known" }>
  | Readonly<{
      state: "attention";
      condition: "baseline-missing" | "storage-recovery-required" | "need-update";
      diagnostic: StructuralDiagnostic;
    }>
> => {
  const state = await inspectProjectReadModel(repoRoot);
  if (state.state === "need-update") {
    return {
      state: "attention",
      condition: "need-update",
      diagnostic: {
        code: "project-read-model-need-update",
        impact: "blocking",
        target: request.subject,
        message: "Project Read Model requires a newer Bearing version.",
      },
    };
  }
  if (state.state === "recovery-required") {
    return {
      state: "attention",
      condition: "storage-recovery-required",
      diagnostic: {
        code: "project-read-model-recovery-required",
        impact: "blocking",
        target: request.subject,
        message: state.reason,
      },
    };
  }
  const evidence =
    state.state === "missing" ? [] : await readProjectProviderEvidence(repoRoot, "bound");
  const selected = evidence.find(
    (entry) =>
      sameMattNativeBindingDefinition(entry.selection, request.binding) &&
      entry.observation !== undefined,
  );
  const known =
    selected?.observation !== undefined &&
    mattObjects(selected.observation).some(
      (object) => mattNativeSubjectForObject(object).id === request.subject,
    );
  return known
    ? { state: "known" }
    : {
        state: "attention",
        condition: "baseline-missing",
        diagnostic: {
          code: "portal-item-refresh-target-unavailable",
          impact: "blocking",
          target: request.subject,
          message: "Item Refresh requires an exact subject from the selected provider observation.",
        },
      };
};

const attention = (
  action: PortalProviderApplicationRequest["action"],
  condition: AttentionCondition,
  acquisitionCount: number,
  observations: PortalProviderApplicationResponse["observations"],
  diagnostics: readonly StructuralDiagnostic[],
): PortalProviderApplicationResponse => ({
  version: 1,
  state: "attention",
  action,
  condition,
  acquisitionCount,
  observations,
  diagnostics: publicDiagnostics(diagnostics),
  ...conditionPresentation[condition],
});

export const createPortalProviderApplicationService = (options: {
  readonly readCatalog: () => Promise<CatalogReadResult>;
  readonly providerDependencies?: ProviderOperationDependencies;
}) => {
  const applyDirect = async (
    entryId: string,
    request: PortalProviderApplicationRequest,
  ): Promise<PortalProviderApplicationResponse> => {
    const resolved = await resolveProjectEntry({ entryId, readCatalog: options.readCatalog });
    if (resolved.kind !== "available") {
      const condition =
        resolved.kind === "unavailable" && resolved.project.availability === "invalid-manifest"
          ? "removal-required"
          : resolved.kind === "catalog-failed"
            ? "provider-unavailable"
            : "baseline-missing";
      const code =
        condition === "removal-required"
          ? "repository-integration-removal-required"
          : resolved.kind === "catalog-failed"
            ? resolved.diagnostic.code
            : "provider-baseline-unavailable";
      return attention(
        request.action,
        condition,
        0,
        [],
        [applicationDiagnostic(code, entryId, conditionPresentation[condition].explanation)],
      );
    }
    const repoRoot = resolved.entry.repoRoot;
    const lifecycle = await inspectRepositoryIntegrationLifecycle(repoRoot);
    if (lifecycle.kind !== "active") {
      const condition =
        lifecycle.kind === "invalid-or-unsupported" ? "removal-required" : "baseline-missing";
      return attention(
        request.action,
        condition,
        0,
        [],
        [
          applicationDiagnostic(
            condition === "removal-required"
              ? "repository-integration-removal-required"
              : "provider-baseline-unavailable",
            entryId,
            lifecycle.reason,
          ),
        ],
      );
    }
    if (request.action === "item-refresh") {
      const admission = await itemTargetAdmission(repoRoot, request);
      if (admission.state === "attention") {
        return attention(request.action, admission.condition, 0, [], [admission.diagnostic]);
      }
    }

    const operation =
      request.action === "item-refresh"
        ? await refreshProjectProviderDetail(
            repoRoot,
            {
              binding: request.binding,
              subject: request.subject,
            },
            options.providerDependencies,
          )
        : request.action === "source-load"
          ? await captureProjectProviderScopes(
              repoRoot,
              [request.binding.nativeScope],
              options.providerDependencies,
            )
          : await verifyAllProjectProviderScopes(repoRoot, options.providerDependencies);
    const acquisitionCount = operation.result.acquisitionCount;
    const scopes =
      request.action === "all-sources-refresh"
        ? "scopes" in operation.result
          ? operation.result.scopes.map((scope) => scope.scope)
          : []
        : [request.binding.nativeScope];
    const observations =
      operation.outcome === "recovery-required" || operation.outcome === "need-update"
        ? []
        : await observedEvidence(
            repoRoot,
            scopes,
            request.action === "item-refresh" ? "detail" : "bound",
          );
    if (operation.outcome === "complete") {
      return {
        version: 1,
        state: "completed",
        action: request.action,
        acquisitionCount,
        observations,
        diagnostics: [],
      };
    }
    const condition =
      operation.outcome === "recovery-required"
        ? "storage-recovery-required"
        : operation.outcome === "need-update"
          ? "need-update"
          : providerFailureCondition(operation.diagnostics);
    return attention(
      request.action,
      condition,
      acquisitionCount,
      observations,
      operation.diagnostics,
    );
  };

  type ApplicationOperation = ProjectOperation &
    Readonly<{ request: PortalProviderApplicationRequest }>;
  const coordinator = createProjectCoordinator<
    PortalProviderApplicationResponse,
    ApplicationOperation
  >({
    cooldownMs: 0,
    operationKey: ({ request }) =>
      request.action === "all-sources-refresh"
        ? request.action
        : `${request.action}\0${mattNativeBindingDefinitionKey(request.binding)}${
            request.action === "item-refresh" ? `\0${request.subject}` : ""
          }`,
    run: ({ entryId, request }) => applyDirect(entryId, request),
  });
  return {
    apply: async (
      entryId: string,
      request: PortalProviderApplicationRequest,
    ): Promise<PortalProviderApplicationResponse> => {
      const result = await coordinator.execute({ entryId, mode: "force", request });
      if (result.kind === "cooldown") {
        throw new Error("Provider Application coordinator returned an impossible cooldown.");
      }
      return result.value;
    },
  };
};

export type PortalProviderApplicationService = ReturnType<
  typeof createPortalProviderApplicationService
>;
