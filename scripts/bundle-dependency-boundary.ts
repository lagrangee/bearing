import { isAbsolute, relative, resolve } from "node:path";

export type BundleDependency = Readonly<{
  name: string;
  version: string;
  license: string;
  bundles: readonly ("cli" | "portal")[];
}>;

export type BundleDependencyMetadata = Readonly<{
  schemaVersion: 1;
  bundles: Readonly<{
    cli: Readonly<{ packages: readonly string[]; moduleCount: number }>;
    portal: Readonly<{ packages: readonly string[]; moduleCount: number }>;
  }>;
  packages: readonly BundleDependency[];
}>;

const inventoryHeading = "## Bundled dependency inventory";

const virtualModuleLocators: ReadonlyMap<string, string> = new Map([
  ["\0rolldown/runtime.js", "node_modules/rolldown/runtime.js"],
]);

export const normalizeBundleModuleId = (id: string, projectRoot: string): string | undefined => {
  const withoutQuery = id.split("?", 1)[0]?.replaceAll("\\", "/");
  if (withoutQuery === undefined || withoutQuery.length === 0) return undefined;
  if (withoutQuery.startsWith("\0")) {
    const classified = virtualModuleLocators.get(withoutQuery);
    if (classified === undefined) {
      throw new Error(`Unclassified virtual bundle module: ${JSON.stringify(withoutQuery)}.`);
    }
    return classified;
  }
  const nodeMarker = "/node_modules/";
  const nodeIndex = withoutQuery.lastIndexOf(nodeMarker);
  if (nodeIndex !== -1) return `node_modules/${withoutQuery.slice(nodeIndex + nodeMarker.length)}`;
  if (withoutQuery.startsWith("node_modules/")) return withoutQuery;
  const absolute = isAbsolute(withoutQuery) ? withoutQuery : resolve(projectRoot, withoutQuery);
  const locator = relative(projectRoot, absolute).replaceAll("\\", "/");
  if (locator === ".." || locator.startsWith("../")) return undefined;
  return locator;
};

export const expectedNoticeInventory = (metadata: BundleDependencyMetadata): readonly string[] =>
  metadata.packages
    .map((dependency) => `${dependency.name}@${dependency.version} — ${dependency.license}`)
    .sort();

export const readNoticeInventory = (notices: string): readonly string[] => {
  const start = notices.indexOf(`${inventoryHeading}\n`);
  if (start === -1) return [];
  const bodyStart = start + inventoryHeading.length + 1;
  const remainder = notices.slice(bodyStart);
  const nextHeading = remainder.indexOf("\n## ");
  const body = nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
  return body
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2))
    .sort();
};

export const findBundleNoticeMismatches = (
  metadata: BundleDependencyMetadata,
  notices: string,
): readonly string[] => {
  if (metadata.schemaVersion !== 1) return ["unsupported bundle dependency metadata schema"];
  const findings: string[] = [];
  const packageNames = metadata.packages.map((dependency) => dependency.name);
  if (
    new Set(packageNames).size !== packageNames.length ||
    [...packageNames].sort().join("\n") !== packageNames.join("\n")
  ) {
    findings.push("bundle dependency packages must be unique and sorted");
  }
  for (const bundle of ["cli", "portal"] as const) {
    const expectedPackages = metadata.packages
      .filter((dependency) => dependency.bundles.includes(bundle))
      .map((dependency) => `${dependency.name}@${dependency.version}`)
      .sort();
    const actualPackages = metadata.bundles[bundle].packages;
    if (
      metadata.bundles[bundle].moduleCount <= 0 ||
      expectedPackages.join("\n") !== actualPackages.join("\n")
    ) {
      findings.push(`${bundle} bundle package inventory does not match the package union`);
    }
  }
  const expected = expectedNoticeInventory(metadata);
  const actual = readNoticeInventory(notices);
  for (const identity of expected) {
    if (!actual.includes(identity)) findings.push(`THIRD_PARTY_NOTICES is missing ${identity}`);
  }
  for (const identity of actual) {
    if (!expected.includes(identity)) findings.push(`THIRD_PARTY_NOTICES has stale ${identity}`);
  }
  return findings;
};
