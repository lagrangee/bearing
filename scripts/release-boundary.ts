import { parseMarkdownDocument, queryMarkdownLinks } from "../src/markdown-document.ts";

export const forbiddenPackagePaths = [
  /^src\//u,
  /^tests\//u,
  /^browser-tests\//u,
  /^scripts\//u,
  /^\.github\//u,
  /^\.bearing\//u,
  /^\.scratch\//u,
  /^\.omo\//u,
  /^node_modules\//u,
  /^test-results\//u,
  /\.map$/u,
  /\.tgz$/u,
] as const;

export const requiredPackagePaths = [
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "dist/cli.js",
  "dist/bundle-dependencies.json",
  "dist/portal/asset-manifest.json",
  "docs/cli.md",
  "docs/cli.zh-CN.md",
  "docs/data-and-security.md",
  "docs/data-and-security.zh-CN.md",
  "docs/agent-installation.md",
  "docs/everyday-workflows.md",
  "docs/everyday-workflows.zh-CN.md",
  "docs/getting-started.md",
  "docs/getting-started.zh-CN.md",
  "docs/troubleshooting.md",
  "docs/troubleshooting.zh-CN.md",
  "package.json",
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES",
  "skills/bearing/SKILL.md",
] as const;

const assertSafeReadmeTarget = (target: string): void => {
  const segments = target.split("/");
  if (
    target.length === 0 ||
    target.startsWith("/") ||
    target.includes("\\") ||
    target.includes("\0") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`unsafe packaged README target: ${target}`);
  }
};

export const readmeRelativeTargets = (source: string): readonly string[] => {
  const targets = new Set<string>();
  for (const link of queryMarkdownLinks(parseMarkdownDocument(source))) {
    let target = link.target.trim();
    if (target.startsWith("#")) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target)) continue;
    target = target.split("#", 1)[0]?.split("?", 1)[0] ?? "";
    try {
      target = decodeURIComponent(target);
    } catch {
      throw new Error(`invalid encoded packaged README target: ${target}`);
    }
    assertSafeReadmeTarget(target);
    targets.add(target);
  }
  return [...targets].sort();
};

export const assertPackagedReadmeTargets = (
  paths: readonly string[],
  readmes: readonly string[],
): void => {
  const packaged = new Set(paths);
  for (const readme of readmes) {
    for (const target of readmeRelativeTargets(readme)) {
      if (!packaged.has(target)) throw new Error(`missing packaged README target: ${target}`);
    }
  }
};

export const assertAllowedPackagePaths = (paths: readonly string[]): void => {
  for (const path of paths) {
    if (forbiddenPackagePaths.some((pattern) => pattern.test(path))) {
      throw new Error(`forbidden package path: ${path}`);
    }
  }
};

export const assertCanonicalPackageBoundary = (paths: readonly string[]): void => {
  assertAllowedPackagePaths(paths);
  for (const required of requiredPackagePaths) {
    if (!paths.includes(required)) throw new Error(`missing package path: ${required}`);
  }
};
