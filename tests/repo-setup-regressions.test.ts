import { describe, expect, test } from "bun:test";
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { BEARING_POINTER } from "../src/agent-surface-entry";
import { applyInstallPlans } from "../src/installer";
import { setupRepository } from "../src/repo-setup";
import { LOCAL_MATT_CONTRACT, makeTemporaryDirectory, standardMattAgentSurface } from "./helpers";

const pointer = BEARING_POINTER;
const contractLocator = "docs/agents/issue-tracker.md";
const mattAgentSurface = standardMattAgentSurface(contractLocator);
const provider = { key: "matt-skills/v1" as const, contractLocator };

const writeMattProviderContract = async (repoRoot: string): Promise<void> => {
  await mkdir(join(repoRoot, "docs/agents"), { recursive: true });
  await writeFile(join(repoRoot, contractLocator), LOCAL_MATT_CONTRACT);
};

describe("repository setup review regressions", () => {
  test("keeps Bearing nomination contextual and explicit", () => {
    expect(pointer.trim().split(/\s+/u).length).toBeLessThanOrEqual(100);
    expect(pointer).not.toMatch(/[\u3400-\u9fff]/u);
    expect(pointer).toContain("explicit Bearing concepts");
    expect(pointer).toContain("reasonable material planning/governance relevance");
    expect(pointer).toContain("ordinary non-governance code/documentation work");
    expect(pointer).toContain("Explicit `/bearing`");
    expect(pointer).toContain("reliable Bearing orientation");
    expect(pointer).toContain("repository-independent conversation");
    expect(pointer).toContain("contextual guidance, not an executable hook");
    expect(pointer).not.toContain("bearing configure inspect");
    expect(pointer).not.toContain("activation check");
  });

  test("creates state and cache namespaces and removes an unselected surface pointer", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await writeMattProviderContract(repoRoot);
    await writeFile(join(repoRoot, "AGENTS.md"), `# Agent rules\n\n${mattAgentSurface}`);
    await writeFile(join(repoRoot, "CLAUDE.md"), `# Claude rules\n\n${mattAgentSurface}`);
    await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills", "claude"],
      profiles: [],
      provider,
    });

    await access(join(repoRoot, ".bearing/state"));
    await access(join(repoRoot, ".bearing/cache"));
    expect(await readFile(join(repoRoot, "CLAUDE.md"), "utf8")).toContain(pointer);

    const reconciled = await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider,
      confirmRepair: true,
    });
    const claude = await readFile(join(repoRoot, "CLAUDE.md"), "utf8");
    const manifest = JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8"));

    expect(reconciled.outcome).toBe("applied");
    expect(claude).toContain("# Claude rules");
    expect(claude).not.toContain(pointer);
    expect(manifest.surfaces).toEqual(["agent-skills"]);
    const rerun = await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider,
    });
    expect(rerun.outcome).toBe("no-op");
  });

  test("preserves the mode of an existing target on a successful write", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const target = join(homeDir, "private.txt");
    await writeFile(target, "before\n");
    await chmod(target, 0o600);

    await applyInstallPlans(homeDir, [
      { target, bytes: Buffer.from("after\n"), executable: false },
    ]);

    expect(await readFile(target, "utf8")).toBe("after\n");
    expect((await stat(target)).mode & 0o7777).toBe(0o600);
  });

  test("rejects a linked root pointer before reading its target", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    const outside = await makeTemporaryDirectory("bearing-outside-");
    await writeMattProviderContract(repoRoot);
    await symlink(outside, join(repoRoot, "AGENTS.md"));

    await expect(
      setupRepository({
        repoRoot,
        packageRoot: process.cwd(),
        surfaces: ["agent-skills"],
        profiles: [],
        provider,
      }),
    ).rejects.toThrow("symbolic link");
    await expect(access(join(repoRoot, ".bearing/manifest.json"))).rejects.toThrow();
  });

  test("rejects a hard-linked target instead of breaking link topology", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const target = join(homeDir, "target.txt");
    const peer = join(homeDir, "peer.txt");
    await writeFile(target, "shared\n");
    await link(target, peer);

    await expect(
      applyInstallPlans(homeDir, [
        { target, bytes: Buffer.from("replacement\n"), executable: false },
      ]),
    ).rejects.toThrow("hard-linked");
    expect((await lstat(target)).ino).toBe((await lstat(peer)).ino);
    expect(await readFile(peer, "utf8")).toBe("shared\n");
  });

  test("rejects duplicate managed marker blocks", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    const block = `<!-- bearing:managed-start -->\n${pointer}\n<!-- bearing:managed-end -->`;
    await writeMattProviderContract(repoRoot);
    await writeFile(join(repoRoot, "AGENTS.md"), `${mattAgentSurface}\n${block}\n${block}\n`);

    await expect(
      setupRepository({
        repoRoot,
        packageRoot: process.cwd(),
        surfaces: ["agent-skills"],
        profiles: [],
        provider,
      }),
    ).rejects.toThrow("malformed Bearing managed block");
  });

  test("preserves surrounding root pointer bytes across selection and removal", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await writeMattProviderContract(repoRoot);
    const original = `# Agent rules\n\n${mattAgentSurface}\n  `;
    await writeFile(join(repoRoot, "AGENTS.md"), original);
    await writeFile(join(repoRoot, "CLAUDE.md"), mattAgentSurface);

    await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider,
    });
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toStartWith(original);

    await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["claude"],
      profiles: [],
      provider,
      confirmRepair: true,
    });
    const removed = await readFile(join(repoRoot, "AGENTS.md"), "utf8");
    expect(removed).toStartWith(original);
    expect(removed).not.toContain(pointer);
  });
});
