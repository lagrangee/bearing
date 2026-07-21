import type { CatalogDocument } from "./model";

export type CatalogFileState =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "available"; document: CatalogDocument }>
  | Readonly<{ kind: "invalid" }>;

export type CatalogBackupState = CatalogFileState | Readonly<{ kind: "uninspected" }>;

export type CatalogPairState =
  | Readonly<{ kind: "current"; document: CatalogDocument }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "backup"; document: CatalogDocument }>
  | Readonly<{ kind: "unusable" }>;

export const classifyCatalogPair = (
  current: CatalogFileState,
  backup: CatalogBackupState,
): CatalogPairState => {
  if (current.kind === "available") return { kind: "current", document: current.document };
  if (backup.kind === "available") return { kind: "backup", document: backup.document };
  if (current.kind === "missing" && backup.kind === "missing") return { kind: "empty" };
  return { kind: "unusable" };
};
