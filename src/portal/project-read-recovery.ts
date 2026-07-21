import type { ProjectEntryResult } from "./project-entry";
import type { ProjectReadServiceResult, ProjectValidation } from "./project-service-contract";
import { composeProjectView, type ProjectRepoView } from "./project-view";

type Resolve = (entryId: string) => Promise<ProjectEntryResult>;
type ReadRepo = (repoRoot: string) => Promise<ProjectRepoView>;
const requestFailed = (): ProjectReadServiceResult => ({
  kind: "read-failed",
  error: { code: "request-failed", message: "Portal request failed." },
});

export const readCurrentProject = async (options: {
  readonly entryId: string;
  readonly resolve: Resolve;
  readonly readRepo: ReadRepo;
  readonly validation: (entryId: string, repoRoot: string) => ProjectValidation;
}): Promise<ProjectReadServiceResult> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resolved = await options.resolve(options.entryId);
    if (resolved.kind !== "available") return resolved;
    let repoView: ProjectRepoView | undefined;
    try {
      repoView = await options.readRepo(resolved.entry.repoRoot);
    } catch {
      repoView = undefined;
    }
    const latest = await options.resolve(options.entryId);
    if (latest.kind !== "available") return latest;
    if (latest.entry.repoRoot !== resolved.entry.repoRoot) continue;
    if (repoView !== undefined) {
      return {
        kind: "ready",
        view: composeProjectView(latest.entry, repoView),
        validation: options.validation(options.entryId, latest.entry.repoRoot),
      };
    }
    return requestFailed();
  }
  return requestFailed();
};
