import type { DiscoveryResult } from "./discovery";
import { addWhenPresent, discoverPlanningAuditInputs } from "./discovery";
import { retainContainedInputs } from "./input-boundary";
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
  const contained = await retainContainedInputs(root, [...inputs]);
  diagnostics.push(...contained.diagnostics);
  return { inputs: contained.inputs, diagnostics };
};
