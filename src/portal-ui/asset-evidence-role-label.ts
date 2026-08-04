import type { AssetProjection } from "../project-snapshot/contract";

export const assetEvidenceRoleLabel = (role: AssetProjection["evidenceRoles"][number]): string =>
  ({
    "execution-evidence": "Execution Evidence",
    "planning-citation": "Planning Citation",
    "authority-adoption": "Authority Adoption",
    "passage-evidence": "Passage Evidence",
  })[role];
