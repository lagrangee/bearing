import { readdir, stat } from "node:fs/promises";
import { posix } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { probeContainedInput, readContainedInput, retainContainedInputs } from "./input-boundary";
import { resolveRepositoryRoot } from "./path-boundary";
import type { StructuralDiagnostic } from "./types";

const INTERPRETATION_INPUTS = [
  ".bearing/manifest.json",
  ".bearing/state/project-summary.md",
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
      files.push(...(await listFiles(repoRoot, locator, markdownOnly, diagnostics)));
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

const discoverNativeScope = async (
  repoRoot: string,
  inputs: Set<string>,
  scope: string,
  diagnostics: StructuralDiagnostic[],
): Promise<void> => {
  await addWhenPresent(repoRoot, inputs, posix.join(scope, "PRD.md"), diagnostics);
  await addWhenPresent(repoRoot, inputs, posix.join(scope, "map.md"), diagnostics);
  const issues = await listFiles(repoRoot, posix.join(scope, "issues"), true, diagnostics);
  for (const issue of issues) inputs.add(issue);
};

const discoverLegacyEfforts = async (
  repoRoot: string,
  inputs: Set<string>,
  diagnostics: StructuralDiagnostic[],
): Promise<void> => {
  const scratchRoot = await probeContainedInput(repoRoot, ".scratch");
  if (scratchRoot.status === "missing") return;
  if (scratchRoot.status === "blocked") {
    diagnostics.push(scratchRoot.diagnostic);
    return;
  }
  if (!(await stat(scratchRoot.path)).isDirectory()) {
    diagnostics.push({
      code: "invalid-input-directory",
      impact: "blocking",
      target: ".scratch",
      message: "Repository input must be a directory.",
    });
    return;
  }
  const scopes = await readdir(scratchRoot.path, { withFileTypes: true });
  for (const scope of scopes) {
    if (!scope.isDirectory()) {
      continue;
    }
    const effort = posix.join(".scratch", scope.name, "effort.md");
    const effortProbe = await probeContainedInput(repoRoot, effort);
    if (effortProbe.status === "missing") continue;
    if (effortProbe.status === "blocked") {
      diagnostics.push(effortProbe.diagnostic);
      continue;
    }
    if (!(await stat(effortProbe.path)).isFile()) {
      diagnostics.push({
        code: "invalid-input-file",
        impact: "blocking",
        target: effort,
        message: "Repository input must be a file.",
      });
      continue;
    }
    inputs.add(effort);
    await discoverNativeScope(repoRoot, inputs, posix.join(".scratch", scope.name), diagnostics);
  }
};

const discoverCanonicalEffortScopes = async (
  repoRoot: string,
  inputs: Set<string>,
  diagnostics: StructuralDiagnostic[],
): Promise<void> => {
  const efforts = await listFiles(repoRoot, ".bearing/state/efforts", true, diagnostics);
  for (const effort of efforts) {
    const source = await readContainedInput(repoRoot, effort);
    if (source.status === "blocked") {
      diagnostics.push(source.diagnostic);
      continue;
    }
    const parsed = parseFrontmatter(source.bytes.toString("utf8"));
    if (!parsed.ok) continue;
    const workBinding = parsed.data["Work binding"];
    if (
      typeof workBinding !== "object" ||
      workBinding === null ||
      !("Native scope" in workBinding) ||
      typeof workBinding["Native scope"] !== "string"
    ) {
      continue;
    }
    await discoverNativeScope(repoRoot, inputs, workBinding["Native scope"], diagnostics);
  }
};

const usesCanonicalEffortStorage = async (
  repoRoot: string,
  diagnostics: StructuralDiagnostic[],
): Promise<boolean | undefined> => {
  const probe = await probeContainedInput(repoRoot, ".bearing/manifest.json");
  if (probe.status !== "available") return false;
  const source = await readContainedInput(repoRoot, ".bearing/manifest.json");
  if (source.status === "blocked") {
    diagnostics.push(source.diagnostic);
    return undefined;
  }
  try {
    const parsed = JSON.parse(source.bytes.toString("utf8")) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "status" in parsed &&
      (parsed.status === "active" || parsed.status === "deactivated")
    );
  } catch {
    return false;
  }
};

export const discoverPlanningAuditInputs = async (repoRoot: string): Promise<DiscoveryResult> => {
  const root = await resolveRepositoryRoot(repoRoot);
  const inputs = new Set<string>();
  const diagnostics: StructuralDiagnostic[] = [];
  for (const locator of INTERPRETATION_INPUTS) {
    await addWhenPresent(root, inputs, locator, diagnostics);
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
  const canonicalEffortStorage = await usesCanonicalEffortStorage(root, diagnostics);
  if (canonicalEffortStorage === true) {
    await discoverCanonicalEffortScopes(root, inputs, diagnostics);
  } else if (canonicalEffortStorage === false) {
    await discoverLegacyEfforts(root, inputs, diagnostics);
  }
  const contained = await retainContainedInputs(root, [...inputs]);
  diagnostics.push(...contained.diagnostics);
  return { inputs: contained.inputs, diagnostics };
};
