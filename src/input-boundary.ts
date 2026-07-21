import { resolve } from "node:path";
import {
  isRepositoryPathBoundaryError,
  readContainedFile,
  resolveContainedPath,
} from "./path-boundary";
import type { StructuralDiagnostic } from "./types";

export type ContainedInputs = Readonly<{
  inputs: readonly string[];
  diagnostics: readonly StructuralDiagnostic[];
}>;

export type ContainedInputProbe =
  | Readonly<{ status: "available"; path: string }>
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "blocked"; diagnostic: StructuralDiagnostic }>;

export type ContainedInputRead =
  | Readonly<{ status: "available"; bytes: Buffer }>
  | Readonly<{ status: "blocked"; diagnostic: StructuralDiagnostic }>;

const isSystemError = (error: unknown): error is Error & Readonly<{ code: string }> =>
  error instanceof Error && "code" in error && typeof error.code === "string";

const genericBoundaryDiagnostic = (locator: string): StructuralDiagnostic => ({
  code: "repository-input-outside-boundary",
  impact: "blocking",
  target: locator,
  message: "Repository input is unavailable or resolves outside the repository.",
});

const boundaryDiagnostic = (locator: string, error?: unknown): StructuralDiagnostic => {
  if (!isRepositoryPathBoundaryError(error)) return genericBoundaryDiagnostic(locator);
  if (error.reason === "shared-file") {
    return {
      code: "repository-input-shared-file",
      impact: "blocking",
      target: locator,
      message: "Repository input must be one unlinked regular file.",
    };
  }
  if (error.reason === "unsupported-shape") {
    return {
      code: "unsupported-input-shape",
      impact: "blocking",
      target: locator,
      message: "Repository input has an unsupported filesystem shape.",
    };
  }
  return genericBoundaryDiagnostic(locator);
};

export const probeContainedInput = async (
  repoRoot: string,
  locator: string,
): Promise<ContainedInputProbe> => {
  try {
    return {
      status: "available",
      path: await resolveContainedPath(repoRoot, resolve(repoRoot, locator)),
    };
  } catch (error) {
    if (isSystemError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return { status: "missing" };
    }
    if (!isSystemError(error) && !isRepositoryPathBoundaryError(error)) throw error;
    return { status: "blocked", diagnostic: boundaryDiagnostic(locator, error) };
  }
};

export const readContainedInput = async (
  repoRoot: string,
  locator: string,
): Promise<ContainedInputRead> => {
  try {
    const target = resolve(repoRoot, locator);
    return {
      status: "available",
      bytes: await readContainedFile(repoRoot, target),
    };
  } catch (error) {
    if (!isSystemError(error) && !isRepositoryPathBoundaryError(error)) throw error;
    return { status: "blocked", diagnostic: boundaryDiagnostic(locator, error) };
  }
};

export const retainContainedInputs = async (
  repoRoot: string,
  inputs: readonly string[],
): Promise<ContainedInputs> => {
  const retained: string[] = [];
  const diagnostics: StructuralDiagnostic[] = [];
  for (const locator of inputs) {
    const probe = await probeContainedInput(repoRoot, locator);
    if (probe.status === "available") {
      retained.push(locator);
    } else {
      diagnostics.push(
        probe.status === "blocked" ? probe.diagnostic : genericBoundaryDiagnostic(locator),
      );
    }
  }
  return { inputs: retained, diagnostics };
};
