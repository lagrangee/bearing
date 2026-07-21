import { readFile } from "node:fs/promises";
import { writeFileAtomically } from "../atomic-write";
import { inspectInstallPath } from "../install-boundary";
import { CatalogRecoveryRequiredError } from "./errors";
import type { CatalogLocation } from "./location";
import { type CatalogDocument, emptyCatalogDocument, parseCatalogDocument } from "./model";
import {
  type CatalogBackupState,
  type CatalogFileState,
  classifyCatalogPair,
} from "./pair-classification";

export type CatalogReadState =
  | Readonly<{ state: "ready"; document: CatalogDocument }>
  | Readonly<{
      state: "degraded";
      document: CatalogDocument;
      diagnostic: Readonly<{ code: "catalog-current-invalid"; message: string }>;
    }>
  | Readonly<{
      state: "failed";
      diagnostic: Readonly<{ code: "catalog-unusable"; message: string }>;
    }>;

const readCatalogFile = async (target: string): Promise<CatalogFileState> => {
  const state = await inspectInstallPath(target);
  if (state.kind === "missing") return { kind: "missing" };
  if (state.kind !== "file" || state.linkCount !== 1) {
    throw new Error(`Project Catalog must be one unlinked regular file: ${target}`);
  }
  try {
    return {
      kind: "available",
      document: parseCatalogDocument(JSON.parse(await readFile(target, "utf8"))),
    };
  } catch {
    return { kind: "invalid" };
  }
};

export const readCatalogStateAt = async (location: CatalogLocation): Promise<CatalogReadState> => {
  const current = await readCatalogFile(location.file);
  const backup: CatalogBackupState =
    current.kind === "available" ? { kind: "uninspected" } : await readCatalogFile(location.backup);
  const pair = classifyCatalogPair(current, backup);
  if (pair.kind === "current") return { state: "ready", document: pair.document };
  if (pair.kind === "empty") return { state: "ready", document: emptyCatalogDocument() };
  if (pair.kind === "backup") {
    return {
      state: "degraded",
      document: pair.document,
      diagnostic: {
        code: "catalog-current-invalid",
        message: "Project Catalog is using its last-known-good backup; run explicit repair.",
      },
    };
  }
  return {
    state: "failed",
    diagnostic: {
      code: "catalog-unusable",
      message: "No trustworthy Project Catalog or backup is available.",
    },
  };
};

export const readStrictCurrentCatalog = async (
  location: CatalogLocation,
): Promise<CatalogDocument> => {
  const current = await readCatalogFile(location.file);
  const backup: CatalogBackupState =
    current.kind === "missing" ? await readCatalogFile(location.backup) : { kind: "uninspected" };
  const pair = classifyCatalogPair(current, backup);
  if (pair.kind === "current") return pair.document;
  if (pair.kind === "empty") return emptyCatalogDocument();
  throw new CatalogRecoveryRequiredError();
};

export const writeCatalogDocument = async (
  target: string,
  document: CatalogDocument,
): Promise<void> => {
  const validated = parseCatalogDocument(document);
  await writeFileAtomically(target, Buffer.from(`${JSON.stringify(validated, null, 2)}\n`), 0o600);
};
