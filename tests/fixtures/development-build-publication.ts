import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { publishAtomicDevelopmentBuild } from "../../src/development-build";

export const publishControlledBuild = async (
  controlRoot: string,
  marker: string,
): Promise<void> => {
  const stagedDist = join(controlRoot, ".bearing-test-build", "dist");
  await mkdir(stagedDist, { recursive: true });
  await writeFile(join(stagedDist, "build-marker"), marker);
  await publishAtomicDevelopmentBuild(stagedDist, join(controlRoot, "dist"));
};
