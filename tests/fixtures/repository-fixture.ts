import { cp, mkdtemp, readdir, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ROOT = fileURLToPath(new URL("./repositories/portal-project/", import.meta.url));

export const copyPortalProjectFixture = async (
  directoryName = "portal-project",
): Promise<string> => {
  const parent = await mkdtemp(join(tmpdir(), "bearing-repository-fixture-"));
  const target = join(parent, directoryName);
  await cp(FIXTURE_ROOT, target, { recursive: true, errorOnExist: true });
  await rename(join(target, "_bearing"), join(target, ".bearing"));
  await rename(join(target, "_scratch"), join(target, ".scratch"));
  return target;
};

export const readRepositorySourceBytes = async (
  root: string,
): Promise<Readonly<Record<string, string>>> => {
  const bytes: Record<string, string> = {};
  const visit = async (directory: string, prefix = ""): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      const locator = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (locator === ".bearing/cache") continue;
      const target = join(directory, entry.name);
      if (entry.isDirectory()) await visit(target, locator);
      else if (entry.isFile()) bytes[locator] = (await readFile(target)).toString("base64");
      else throw new Error(`Fixture contains an unsupported entry: ${locator}`);
    }
  };
  await visit(root);
  return bytes;
};
