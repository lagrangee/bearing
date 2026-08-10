import { isAbsolute, relative, resolve } from "node:path";
import {
  parseMarkdownDocument,
  queryMarkdownList,
  queryMarkdownSection,
} from "../src/markdown-document";

export type BundleDependency = Readonly<{
  name: string;
  version: string;
  license: string;
  bundles: readonly ("cli" | "portal")[];
  locators: readonly string[];
}>;

export type BundleDependencyMetadata = Readonly<{
  schemaVersion: 2;
  bundles: Readonly<{
    cli: Readonly<{ packages: readonly string[]; moduleCount: number }>;
    portal: Readonly<{ packages: readonly string[]; moduleCount: number }>;
  }>;
  packages: readonly BundleDependency[];
}>;

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
  if (withoutQuery.startsWith("node_modules/")) return withoutQuery;
  const absolute = isAbsolute(withoutQuery) ? withoutQuery : resolve(projectRoot, withoutQuery);
  const locator = relative(projectRoot, absolute).replaceAll("\\", "/");
  if (locator !== ".." && !locator.startsWith("../")) return locator;
  const nodeMarker = "/node_modules/";
  const nodeIndex = withoutQuery.lastIndexOf(nodeMarker);
  return nodeIndex === -1
    ? undefined
    : `node_modules/${withoutQuery.slice(nodeIndex + nodeMarker.length)}`;
};

export const bundlePackageLocatorFromModule = (moduleId: string): string | undefined => {
  if (!moduleId.startsWith("node_modules/")) return undefined;
  const segments = moduleId.split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  const firstName = segments[nodeModulesIndex + 1];
  if (nodeModulesIndex === -1 || firstName === undefined || firstName.length === 0)
    return undefined;
  const packageEnd = firstName.startsWith("@") ? nodeModulesIndex + 3 : nodeModulesIndex + 2;
  return segments.length < packageEnd ? undefined : segments.slice(0, packageEnd).join("/");
};

export const expectedNoticeInventory = (metadata: BundleDependencyMetadata): readonly string[] =>
  metadata.packages
    .map((dependency) => `${dependency.name}@${dependency.version} — ${dependency.license}`)
    .sort();

export const readNoticeInventory = (notices: string): readonly string[] => {
  const document = parseMarkdownDocument(notices);
  const inventory = queryMarkdownSection(document, {
    title: "Bundled dependency inventory",
    depth: 2,
  });
  if (inventory.state !== "found") return [];
  const list = queryMarkdownList(document, { within: inventory.value, ordered: false });
  return list.state === "found" ? list.value.items.map((item) => item.text).sort() : [];
};

export const findBundleNoticeMismatches = (
  metadata: BundleDependencyMetadata,
  notices: string,
): readonly string[] => {
  if (metadata.schemaVersion !== 2) return ["unsupported bundle dependency metadata schema"];
  const findings: string[] = [];
  const packageIdentities = metadata.packages.map(
    (dependency) => `${dependency.name}@${dependency.version}`,
  );
  if (
    new Set(packageIdentities).size !== packageIdentities.length ||
    [...packageIdentities].sort().join("\n") !== packageIdentities.join("\n")
  ) {
    findings.push("bundle dependency package identities must be unique and sorted");
  }
  const packageLocators = metadata.packages.flatMap((dependency) => dependency.locators);
  if (new Set(packageLocators).size !== packageLocators.length) {
    findings.push("bundle dependency locators must be unique");
  }
  for (const dependency of metadata.packages) {
    if (
      dependency.locators.length === 0 ||
      [...dependency.locators].sort().join("\n") !== dependency.locators.join("\n")
    ) {
      findings.push(`bundle dependency locators must be present and sorted: ${dependency.name}`);
    }
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
