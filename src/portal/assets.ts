import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join, posix, relative, sep } from "node:path";
import { constants, gzipSync } from "node:zlib";
import { z } from "zod";
import { writeFileAtomically } from "../atomic-write";
import { PROJECT_SNAPSHOT_VERSION } from "../project-snapshot/schema";

export const PORTAL_INTERFACE_VERSION = 1 as const;
export { PROJECT_SNAPSHOT_VERSION };

const MANIFEST_NAME = "asset-manifest.json";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
} as const;

const assetPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value !== MANIFEST_NAME &&
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value === posix.normalize(value) &&
      !value.startsWith("../"),
    { message: "Portal asset path must be a normalized relative POSIX path." },
  );

const assetRecordSchema = z.strictObject({
  path: assetPathSchema,
  contentType: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const portalAssetManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    packageVersion: z.string().min(1),
    interfaceVersion: z.literal(PORTAL_INTERFACE_VERSION),
    projectSnapshotVersion: z.literal(PROJECT_SNAPSHOT_VERSION),
    entry: z.literal("index.html"),
    buildId: z.string().regex(/^[a-f0-9]{64}$/u),
    assets: z.array(assetRecordSchema),
  })
  .superRefine((value, context) => {
    const paths = value.assets.map((asset) => asset.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({ code: "custom", message: "Portal asset paths must be unique." });
    }
    if (!paths.includes(value.entry)) {
      context.addIssue({ code: "custom", message: "Portal entry must be listed as an asset." });
    }
  });

export type PortalAssetManifest = z.infer<typeof portalAssetManifestSchema>;

export type PortalAsset = Readonly<{
  bytes: Buffer;
  gzipBytes?: Buffer;
  gzipEtag?: string;
  contentType: string;
  etag: string;
  immutable: boolean;
}>;

export type PortalAssets = Readonly<{
  manifest: PortalAssetManifest;
  get(pathname: string): PortalAsset | undefined;
}>;

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const assetContentType = (path: string): string => {
  const extension = extname(path) as keyof typeof contentTypes;
  const contentType = contentTypes[extension];
  if (contentType === undefined) throw new Error(`Unsupported Portal asset type: ${path}`);
  return contentType;
};

const isCompressibleContentType = (contentType: string): boolean =>
  contentType.startsWith("text/") ||
  contentType === "application/json; charset=utf-8" ||
  contentType === "image/svg+xml";

const listAssetFiles = async (root: string, directory = root): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Portal asset cannot be a symbolic link: ${absolute}`);
    if (entry.isDirectory()) files.push(...(await listAssetFiles(root, absolute)));
    else if (entry.isFile()) files.push(relative(root, absolute).split(sep).join("/"));
    else throw new Error(`Portal asset has unsupported filesystem type: ${absolute}`);
  }
  return files.filter((path) => path !== MANIFEST_NAME).sort((a, b) => a.localeCompare(b, "en"));
};

const canonicalBuildId = (assets: PortalAssetManifest["assets"]): string =>
  sha256(JSON.stringify(assets));

export const buildPortalAssetManifest = async (
  portalRoot: string,
  packageVersion: string,
): Promise<PortalAssetManifest> => {
  const assets = await Promise.all(
    (await listAssetFiles(portalRoot)).map(async (path) => {
      const bytes = await readFile(join(portalRoot, path));
      return {
        path,
        contentType: assetContentType(path),
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      };
    }),
  );
  return portalAssetManifestSchema.parse({
    schemaVersion: 1,
    packageVersion,
    interfaceVersion: PORTAL_INTERFACE_VERSION,
    projectSnapshotVersion: PROJECT_SNAPSHOT_VERSION,
    entry: "index.html",
    buildId: canonicalBuildId(assets),
    assets,
  });
};

export const writePortalAssetManifest = async (
  portalRoot: string,
  manifest: PortalAssetManifest,
): Promise<void> => {
  const validated = portalAssetManifestSchema.parse(manifest);
  await writeFileAtomically(
    join(portalRoot, MANIFEST_NAME),
    Buffer.from(`${JSON.stringify(validated, null, 2)}\n`),
    0o644,
  );
};

const parseManifest = async (portalRoot: string): Promise<PortalAssetManifest> => {
  try {
    return portalAssetManifestSchema.parse(
      JSON.parse(await readFile(join(portalRoot, MANIFEST_NAME), "utf8")),
    );
  } catch (error) {
    throw new Error("Portal asset manifest is missing or invalid.", { cause: error });
  }
};

export const loadPortalAssets = async (
  packageRoot: string,
  expectedPackageVersion: string,
): Promise<PortalAssets> => {
  const portalRoot = join(packageRoot, "dist/portal");
  const manifest = await parseManifest(portalRoot);
  if (manifest.packageVersion !== expectedPackageVersion) {
    throw new Error("Portal package version does not match the asset manifest.");
  }
  const actualPaths = await listAssetFiles(portalRoot);
  const expectedPaths = manifest.assets
    .map((asset) => asset.path)
    .sort((a, b) => a.localeCompare(b, "en"));
  if (
    actualPaths.length !== expectedPaths.length ||
    actualPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    throw new Error("Portal asset set does not match the fixed manifest.");
  }
  if (manifest.buildId !== canonicalBuildId(manifest.assets)) {
    throw new Error("Portal asset contract build identifier is invalid.");
  }

  const privateAssets = new Map<string, Omit<PortalAsset, "bytes"> & { bytes: Buffer }>();
  for (const record of manifest.assets) {
    const absolute = join(portalRoot, record.path);
    const metadata = await lstat(absolute);
    const bytes = await readFile(absolute);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      record.contentType !== assetContentType(record.path) ||
      record.byteLength !== bytes.byteLength ||
      record.sha256 !== sha256(bytes)
    ) {
      throw new Error(`Portal asset contract failed for ${record.path}.`);
    }
    const immutable = record.path !== manifest.entry;
    const gzipCandidate =
      immutable && isCompressibleContentType(record.contentType)
        ? gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION })
        : undefined;
    const gzipBytes =
      gzipCandidate !== undefined && gzipCandidate.byteLength < bytes.byteLength
        ? gzipCandidate
        : undefined;
    privateAssets.set(`/${record.path}`, {
      bytes: Buffer.from(bytes),
      ...(gzipBytes === undefined ? {} : { gzipBytes, gzipEtag: `"sha256-${sha256(gzipBytes)}"` }),
      contentType: record.contentType,
      etag: `"sha256-${record.sha256}"`,
      immutable,
    });
  }

  return Object.freeze({
    manifest: Object.freeze(manifest),
    get(pathname: string): PortalAsset | undefined {
      const asset = privateAssets.get(pathname);
      return asset === undefined
        ? undefined
        : Object.freeze({
            ...asset,
            bytes: Buffer.from(asset.bytes),
            ...(asset.gzipBytes === undefined ? {} : { gzipBytes: Buffer.from(asset.gzipBytes) }),
          });
    },
  });
};
