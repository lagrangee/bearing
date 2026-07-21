import type { CatalogReadResult } from "./contract";
import { type ProjectEntryResult, resolveProjectEntry } from "./project-entry";

type InternalProjectEntryResult = Readonly<{
  result: ProjectEntryResult;
  locatorRevision?: string;
}>;

export const createProjectEntryResolver = (
  readCatalog: () => Promise<CatalogReadResult>,
): Readonly<{
  resolve(entryId: string): Promise<ProjectEntryResult>;
  resolveWithLocator(entryId: string): Promise<InternalProjectEntryResult>;
}> => {
  const resolveWithLocator = async (entryId: string): Promise<InternalProjectEntryResult> => {
    let observed: CatalogReadResult | undefined;
    const result = await resolveProjectEntry({
      entryId,
      readCatalog: async () => {
        observed = await readCatalog();
        return observed;
      },
    });
    const locatorRevision =
      observed?.state === "ready" || observed?.state === "degraded"
        ? observed.entries.find((entry) => entry.entryId === entryId)?.repoRoot
        : undefined;
    return { result, ...(locatorRevision === undefined ? {} : { locatorRevision }) };
  };
  return {
    resolve: async (entryId) => (await resolveWithLocator(entryId)).result,
    resolveWithLocator,
  };
};

export type ProjectEntryResolver = ReturnType<typeof createProjectEntryResolver>;
