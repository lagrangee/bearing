import type { PlanningLineageSubject } from "../planning-lineage-route";
import type { PortalProjectSection } from "../portal-project-read-wire";
import {
  PortalProjectReadModelUnavailableError,
  queryPortalProjectRows,
  searchPortalProjectRows,
} from "../project-read-model/portal";
import { probeExactAssetSource } from "./asset-source-probe";
import type { CatalogReadResult } from "./contract";
import { resolveProjectEntry } from "./project-entry";

export const createPortalProjectQueryService = (options: {
  readonly readCatalog: () => Promise<CatalogReadResult>;
  readonly readRows?: typeof queryPortalProjectRows;
  readonly probeAssetSource?: typeof probeExactAssetSource;
}) => ({
  read: async (
    entryId: string,
    section: PortalProjectSection,
    target?: PlanningLineageSubject | undefined,
  ) => {
    const entry = await resolveProjectEntry({ entryId, readCatalog: options.readCatalog });
    if (entry.kind !== "available") return entry;
    try {
      const rows = await (options.readRows ?? queryPortalProjectRows)(
        entry.entry.repoRoot,
        section,
        target,
      );
      const assetSourceProbe =
        section === "lineage" && target?.kind === "asset"
          ? await (() => {
              const asset = rows.objects.find(
                (object) => object.kind === "asset" && object.value.id === target.id,
              );
              return asset?.kind !== "asset"
                ? undefined
                : (options.probeAssetSource ?? probeExactAssetSource)(
                    entry.entry.repoRoot,
                    asset.value.sourceLocator,
                  );
            })()
          : undefined;
      return {
        kind: "ready" as const,
        project: {
          entryId: entry.entry.entryId,
          displayName: entry.entry.displayName,
          availability: "available" as const,
        },
        rows: assetSourceProbe === undefined ? rows : { ...rows, assetSourceProbe },
      };
    } catch (error) {
      if (error instanceof PortalProjectReadModelUnavailableError) {
        return {
          kind: "read-model-unavailable" as const,
          error: {
            code:
              error.reason === "need-rebuild"
                ? "project-data-needs-rebuild"
                : "project-data-needs-update",
            message:
              error.reason === "need-rebuild"
                ? "Project data needs an explicit rebuild."
                : "Project data needs a compatible Bearing runtime.",
          },
        };
      }
      return {
        kind: "read-failed" as const,
        error: { code: "project-read-model-unavailable", message: "Project data is unavailable." },
      };
    }
  },
  search: async (entryId: string, query: string) => {
    const entry = await resolveProjectEntry({ entryId, readCatalog: options.readCatalog });
    if (entry.kind !== "available") return entry;
    try {
      return {
        kind: "ready" as const,
        find: await searchPortalProjectRows(entry.entry.repoRoot, entryId, query, 20),
      };
    } catch (error) {
      if (error instanceof PortalProjectReadModelUnavailableError) {
        return {
          kind: "read-model-unavailable" as const,
          error: {
            code:
              error.reason === "need-rebuild"
                ? "project-data-needs-rebuild"
                : "project-data-needs-update",
            message:
              error.reason === "need-rebuild"
                ? "Project Find needs an explicit project data rebuild."
                : "Project Find needs a compatible Bearing runtime.",
          },
        };
      }
      return {
        kind: "read-failed" as const,
        error: { code: "project-read-model-unavailable", message: "Project Find is unavailable." },
      };
    }
  },
});

export type PortalProjectQueryService = ReturnType<typeof createPortalProjectQueryService>;
