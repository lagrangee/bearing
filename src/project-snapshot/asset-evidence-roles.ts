export const ASSET_EVIDENCE_ROLES = [
  "execution-evidence",
  "planning-citation",
  "authority-adoption",
  "passage-evidence",
] as const;

export type AssetEvidenceRole = (typeof ASSET_EVIDENCE_ROLES)[number];

export const deriveAssetEvidenceRoles = (
  input: Readonly<{
    kind: string;
    citations: readonly unknown[];
    authorityAdoptions: readonly unknown[];
    passageEvidence: readonly unknown[];
  }>,
): readonly AssetEvidenceRole[] => [
  ...(input.kind === "execution-evidence" ? (["execution-evidence"] as const) : []),
  ...(input.citations.length > 0 ? (["planning-citation"] as const) : []),
  ...(input.authorityAdoptions.length > 0 ? (["authority-adoption"] as const) : []),
  ...(input.passageEvidence.length > 0 ? (["passage-evidence"] as const) : []),
];
