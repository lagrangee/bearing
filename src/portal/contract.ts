import type { ProbedCatalogEntry } from "../catalog/model";

export type PortalDiagnostic = Readonly<{
  code: string;
  message: string;
}>;

export type CatalogReadResult =
  | Readonly<{
      state: "ready";
      entries: readonly ProbedCatalogEntry[];
    }>
  | Readonly<{
      state: "degraded";
      entries: readonly ProbedCatalogEntry[];
      diagnostic: PortalDiagnostic;
    }>
  | Readonly<{
      state: "failed";
      diagnostic: PortalDiagnostic;
    }>;
