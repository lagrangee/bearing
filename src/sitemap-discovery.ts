import { readdir, stat } from "node:fs/promises";
import { posix } from "node:path";
import type { DiscoveryResult } from "./discovery";
import { addWhenPresent, discoverPlanningAuditInputs, listFiles } from "./discovery";
import { probeContainedInput, retainContainedInputs } from "./input-boundary";
import { resolveRepositoryRoot } from "./path-boundary";
import type { StructuralDiagnostic } from "./types";

const ADVISORY_INPUTS = [
  ".bearing/state/planning-audit.md",
  ".bearing/state/next-work-guidance.md",
];

export const discoverProjectSitemapInputs = async (repoRoot: string): Promise<DiscoveryResult> => {
  const root = await resolveRepositoryRoot(repoRoot);
  const planning = await discoverPlanningAuditInputs(root);
  const inputs = new Set(planning.inputs);
  const diagnostics: StructuralDiagnostic[] = [...planning.diagnostics];
  for (const locator of ADVISORY_INPUTS) {
    await addWhenPresent(root, inputs, locator, diagnostics);
  }
  const scratch = await probeContainedInput(root, ".scratch");
  if (
    scratch.status === "blocked" &&
    !diagnostics.some(
      (diagnostic) =>
        diagnostic.code === scratch.diagnostic.code &&
        diagnostic.impact === scratch.diagnostic.impact &&
        diagnostic.target === scratch.diagnostic.target &&
        diagnostic.message === scratch.diagnostic.message,
    )
  )
    diagnostics.push(scratch.diagnostic);
  if (scratch.status === "available" && (await stat(scratch.path)).isDirectory()) {
    for (const scope of await readdir(scratch.path, { withFileTypes: true })) {
      if (!scope.isDirectory()) continue;
      const scopeRoot = posix.join(".scratch", scope.name);
      await addWhenPresent(root, inputs, posix.join(scopeRoot, "map.md"), diagnostics);
      for (const issue of await listFiles(root, posix.join(scopeRoot, "issues"), true, diagnostics))
        inputs.add(issue);
    }
  }
  const contained = await retainContainedInputs(root, [...inputs]);
  diagnostics.push(...contained.diagnostics);
  return { inputs: contained.inputs, diagnostics };
};
