import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import packageMetadata from "../package.json";
import lockfile from "../package-lock.json";
import {
  buildPortalAssetManifest,
  loadPortalAssets,
  writePortalAssetManifest,
} from "../src/portal/assets";
import {
  type BundleDependency,
  type BundleDependencyMetadata,
  bundlePackageLocatorFromModule,
  normalizeBundleModuleId,
} from "./bundle-dependency-boundary";
import { dependencyLicenseFor } from "./dependency-license-overrides";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const finalDist = join(projectRoot, "dist");

type LockPackage = Readonly<{ version?: string; license?: string }>;
type PackageLock = Readonly<{ packages?: Record<string, LockPackage> }>;

const packageLockEntries = (lockfile as PackageLock).packages ?? {};

const packageNameFromLocator = (locator: string): string | undefined => {
  const segments = locator.split("node_modules/").pop()?.split("/") ?? [];
  return segments[0]?.startsWith("@")
    ? segments[0] !== undefined && segments[1] !== undefined
      ? `${segments[0]}/${segments[1]}`
      : undefined
    : segments[0];
};

const createBundleDependencyMetadata = (
  cliModules: readonly string[],
  portalModules: readonly string[],
): BundleDependencyMetadata => {
  const bundleModules = {
    cli: [...new Set(cliModules)].sort(),
    portal: [...new Set(portalModules)].sort(),
  };
  const locatorBundles = new Map<string, Set<"cli" | "portal">>();
  for (const [bundle, modules] of Object.entries(bundleModules) as [
    "cli" | "portal",
    readonly string[],
  ][]) {
    for (const moduleId of modules) {
      const locator = bundlePackageLocatorFromModule(moduleId);
      if (locator === undefined) continue;
      const bundles = locatorBundles.get(locator) ?? new Set<"cli" | "portal">();
      bundles.add(bundle);
      locatorBundles.set(locator, bundles);
    }
  }
  const dependenciesByIdentity = new Map<string, BundleDependency>();
  for (const [locator, bundles] of locatorBundles) {
    const name = packageNameFromLocator(locator);
    const dependency = packageLockEntries[locator];
    if (name === undefined) throw new Error(`Bundled dependency locator is invalid: ${locator}.`);
    const license = dependencyLicenseFor(name, dependency?.version, dependency?.license);
    if (dependency?.version === undefined || license === undefined) {
      throw new Error(`Bundled dependency metadata is incomplete for ${locator}.`);
    }
    const identity = `${name}@${dependency.version}`;
    const prior = dependenciesByIdentity.get(identity);
    if (prior !== undefined && prior.license !== license) {
      throw new Error(`Bundled dependency license is inconsistent for ${identity}.`);
    }
    dependenciesByIdentity.set(identity, {
      name,
      version: dependency.version,
      license,
      bundles: [...new Set([...(prior?.bundles ?? []), ...bundles])].sort(),
      locators: [...new Set([...(prior?.locators ?? []), locator])].sort(),
    });
  }
  const packages: BundleDependency[] = [...dependenciesByIdentity.values()].sort((left, right) => {
    const leftIdentity = `${left.name}@${left.version}`;
    const rightIdentity = `${right.name}@${right.version}`;
    return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
  });
  const packageIdentities = (bundle: "cli" | "portal"): string[] =>
    packages
      .filter((dependency) => dependency.bundles.includes(bundle))
      .map((dependency) => `${dependency.name}@${dependency.version}`)
      .sort();
  return {
    schemaVersion: 2,
    bundles: {
      cli: { packages: packageIdentities("cli"), moduleCount: bundleModules.cli.length },
      portal: { packages: packageIdentities("portal"), moduleCount: bundleModules.portal.length },
    },
    packages,
  };
};

const exists = async (target: string): Promise<boolean> => {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const assertProductionPortal = async (
  portalRoot: string,
  assetPaths: readonly string[],
): Promise<void> => {
  const forbidden = [
    ["React jsxDEV transform", "jsxDEV"],
    [
      "React DevTools development prompt",
      "Download the React DevTools for a better development experience",
    ],
    ["absolute repository source path", projectRoot],
    ["absolute file source URL", `file://${projectRoot}`],
    ["Vite modulepreload polyfill", "relList"],
  ] as const;
  for (const path of assetPaths) {
    if (![".css", ".html", ".js", ".json"].includes(extname(path))) continue;
    const output = await readFile(join(portalRoot, path), "utf8");
    for (const [label, marker] of forbidden) {
      if (output.includes(marker)) throw new Error(`Portal build contains ${label} in ${path}.`);
    }
  }
};

const assertPortalAuthoredContentBoundary = (moduleIds: readonly string[]): void => {
  const forbidden = [
    /(?:^|\/)src\/markdown-document\.ts$/u,
    /(?:^|\/)src\/providers\/matt-skills-v1\/(?:authored-document|spec-document|local-markdown|github)\.ts$/u,
    /(?:^|\/)node_modules\/(?:@mdit\/plugin-tasklist|markdown-it|sanitize-html|mdast-util-from-markdown|mdast-util-frontmatter|mdast-util-gfm|micromark(?:-extension-[^/]+)?|yaml)(?:\/|$)/u,
  ] as const;
  const findings = moduleIds.filter((moduleId) =>
    forbidden.some((pattern) => pattern.test(moduleId)),
  );
  if (findings.length > 0) {
    throw new Error(
      `Portal authored-content bundle contains a source parser or HTML renderer:\n${findings.join("\n")}`,
    );
  }
};

const build = async (): Promise<void> => {
  const identity = randomUUID();
  const stagingRoot = join(projectRoot, `.bearing-build-${identity}`);
  const stagingDist = join(stagingRoot, "dist");
  const portalRoot = join(stagingDist, "portal");
  const previousDist = join(projectRoot, `.bearing-dist-previous-${identity}`);
  await mkdir(portalRoot, { recursive: true });
  try {
    let portalModules: string[] = [];
    const inheritedNodeEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const portalBuild = await viteBuild({
        configFile: join(projectRoot, "vite.config.ts"),
        root: projectRoot,
        mode: "production",
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        build: {
          outDir: portalRoot,
          emptyOutDir: true,
          manifest: false,
          modulePreload: { polyfill: false },
          sourcemap: false,
        },
      });
      const portalOutputs = Array.isArray(portalBuild) ? portalBuild : [portalBuild];
      portalModules = portalOutputs.flatMap((output) =>
        "output" in output
          ? output.output.flatMap((artifact) =>
              artifact.type === "chunk" ? Object.keys(artifact.modules) : [],
            )
          : [],
      );
    } finally {
      if (inheritedNodeEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = inheritedNodeEnvironment;
    }
    assertPortalAuthoredContentBoundary(portalModules);
    const portalManifest = await buildPortalAssetManifest(portalRoot, packageMetadata.version);
    await assertProductionPortal(
      portalRoot,
      portalManifest.assets.map((asset) => asset.path),
    );
    await writePortalAssetManifest(portalRoot, portalManifest);

    const cli = await Bun.build({
      entrypoints: [join(projectRoot, "src/cli.ts")],
      outdir: stagingDist,
      naming: "cli.js",
      target: "node",
      format: "esm",
      minify: false,
      sourcemap: "none",
      metafile: true,
    });
    if (!cli.success) {
      throw new AggregateError(cli.logs, "Bearing CLI bundle failed.");
    }
    if (cli.metafile === undefined)
      throw new Error("Bearing CLI build did not produce a metafile.");
    const cliModules = Object.keys(cli.metafile.inputs);
    const dependencyMetadata = createBundleDependencyMetadata(
      cliModules
        .map((id) => normalizeBundleModuleId(id, projectRoot))
        .filter((value): value is string => value !== undefined),
      portalModules
        .map((id) => normalizeBundleModuleId(id, projectRoot))
        .filter((value): value is string => value !== undefined),
    );
    await Bun.write(
      join(stagingDist, "bundle-dependencies.json"),
      `${JSON.stringify(dependencyMetadata, null, 2)}\n`,
    );
    await chmod(join(stagingDist, "cli.js"), 0o755);
    await loadPortalAssets(stagingRoot, packageMetadata.version);

    const hadPrevious = await exists(finalDist);
    if (hadPrevious) await rename(finalDist, previousDist);
    try {
      await rename(stagingDist, finalDist);
    } catch (error) {
      if (hadPrevious) await rename(previousDist, finalDist);
      throw error;
    }
    if (hadPrevious) await rm(previousDist, { recursive: true, force: true });
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
    await rm(previousDist, { recursive: true, force: true });
  }
};

await build();
