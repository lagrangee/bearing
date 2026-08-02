import { readdir, stat } from "node:fs/promises";
import { posix } from "node:path";
import { probeContainedInput, readContainedInput, retainContainedInputs } from "./input-boundary";
import { resolveRepositoryRoot } from "./path-boundary";
import { decodeMattProviderConfiguration } from "./provider-configuration";
import type { StructuralDiagnostic } from "./types";

const INTERPRETATION_INPUTS = [
  ".bearing/manifest.json",
  ".bearing/provider.json",
  ".bearing/state/project-summary.md",
  ".bearing/state/project-brief.md",
  "CONTEXT.md",
  "docs/agents/issue-tracker.md",
  "docs/agents/triage-labels.md",
  "docs/agents/domain.md",
];

const STATE_DIRECTORIES = [
  ".bearing/state/efforts",
  ".bearing/state/roadmaps",
  ".bearing/state/milestone-gates",
  ".bearing/state/authorities",
  ".bearing/state/alignment-checks",
  ".bearing/state/planning-reviews",
];

export type DiscoveryResult = Readonly<{
  inputs: readonly string[];
  diagnostics: readonly StructuralDiagnostic[];
}>;

export const listFiles = async (
  repoRoot: string,
  directory: string,
  markdownOnly: boolean,
  diagnostics: StructuralDiagnostic[],
): Promise<string[]> => {
  const probe = await probeContainedInput(repoRoot, directory);
  if (probe.status === "missing") return [];
  if (probe.status === "blocked") {
    diagnostics.push(probe.diagnostic);
    return [];
  }
  const metadata = await stat(probe.path);
  if (!metadata.isDirectory()) {
    diagnostics.push({
      code: "invalid-input-directory",
      impact: "blocking",
      target: directory,
      message: "Repository input must be a directory.",
    });
    return [];
  }
  const entries = await readdir(probe.path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const locator = posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase().endsWith(".md")) {
        diagnostics.push({
          code: "invalid-input-file",
          impact: "blocking",
          target: locator,
          message: "Repository input must be a file.",
        });
      } else {
        files.push(...(await listFiles(repoRoot, locator, markdownOnly, diagnostics)));
      }
    } else if (entry.isFile() && (!markdownOnly || entry.name.toLowerCase().endsWith(".md"))) {
      files.push(locator);
    } else if (!entry.isFile()) {
      diagnostics.push({
        code: "unsupported-input-shape",
        impact: "blocking",
        target: locator,
        message: "Repository input has an unsupported filesystem shape.",
      });
    }
  }
  return files;
};

export const addWhenPresent = async (
  repoRoot: string,
  inputs: Set<string>,
  locator: string,
  diagnostics: StructuralDiagnostic[],
): Promise<void> => {
  const probe = await probeContainedInput(repoRoot, locator);
  if (probe.status === "available") {
    if ((await stat(probe.path)).isFile()) {
      inputs.add(locator);
    } else {
      diagnostics.push({
        code: "invalid-input-file",
        impact: "blocking",
        target: locator,
        message: "Repository input must be a file.",
      });
    }
  } else if (probe.status === "blocked") diagnostics.push(probe.diagnostic);
};

export const discoverPlanningAuditInputs = async (repoRoot: string): Promise<DiscoveryResult> => {
  const root = await resolveRepositoryRoot(repoRoot);
  const inputs = new Set<string>();
  const diagnostics: StructuralDiagnostic[] = [];
  for (const locator of INTERPRETATION_INPUTS) {
    await addWhenPresent(root, inputs, locator, diagnostics);
  }
  const provider = await readContainedInput(root, ".bearing/provider.json");
  if (provider.status === "available") {
    const parsed = decodeMattProviderConfiguration(provider.bytes.toString("utf8"));
    if (parsed !== undefined) {
      await addWhenPresent(root, inputs, parsed.contractLocator, diagnostics);
      await addWhenPresent(
        root,
        inputs,
        posix.join(posix.dirname(parsed.contractLocator), "triage-labels.md"),
        diagnostics,
      );
    }
  }
  for (const locator of await listFiles(root, "docs/adr", true, diagnostics)) {
    inputs.add(locator);
  }
  await addWhenPresent(root, inputs, ".bearing/state/roadmap-index.md", diagnostics);
  await addWhenPresent(root, inputs, ".bearing/state/assets.md", diagnostics);
  for (const directory of STATE_DIRECTORIES) {
    for (const locator of await listFiles(root, directory, true, diagnostics)) {
      inputs.add(locator);
    }
  }
  const contained = await retainContainedInputs(root, [...inputs]);
  diagnostics.push(...contained.diagnostics);
  return { inputs: contained.inputs, diagnostics };
};
