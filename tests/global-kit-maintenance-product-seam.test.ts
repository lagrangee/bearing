import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { installPackedProduct } from "./product-seams/installed-product";

const absent = async (target: string): Promise<void> => {
  await expect(access(target)).rejects.toThrow();
};

const controlledNpm = async (
  root: string,
): Promise<Readonly<{ binDirectory: string; log: string }>> => {
  const binDirectory = join(root, "controlled-npm");
  const executablePath = join(binDirectory, "npm");
  const log = join(root, "controlled-npm.jsonl");
  await mkdir(binDirectory);
  await writeFile(
    executablePath,
    `#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
await appendFile(process.env.BEARING_TEST_NPM_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "view") {
  if (process.env.BEARING_TEST_NPM_FAILURE === "registry") {
    process.stderr.write("controlled registry unavailable\\n");
    process.exit(1);
  }
  process.stdout.write(process.env.BEARING_TEST_NPM_METADATA + "\\n");
  process.exit(0);
}
process.exit(90);
`,
  );
  await chmod(executablePath, 0o755);
  return { binDirectory, log };
};

const runProcess = async (
  command: readonly string[],
  cwd: string,
): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> => {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const controlledRegistry = async (
  root: string,
  candidate: string,
): Promise<
  Readonly<{
    url: string;
    integrity: string;
    requests: string[];
    corruptArtifact: () => void;
    restoreArtifact: () => void;
    close: () => Promise<void>;
  }>
> => {
  const registryRoot = join(root, "controlled-registry");
  await mkdir(registryRoot);
  const packed = await runProcess(
    ["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", registryRoot, candidate],
    root,
  );
  if (packed.exitCode !== 0) throw new Error(packed.stderr);
  const [artifact] = JSON.parse(packed.stdout) as [{ filename: string; version: string }];
  const artifactBytes = await readFile(join(registryRoot, artifact.filename));
  const integrity = `sha512-${createHash("sha512").update(artifactBytes).digest("base64")}`;
  const shasum = createHash("sha1").update(artifactBytes).digest("hex");
  let servedArtifactBytes = artifactBytes;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://registry.test").pathname,
    );
    requests.push(pathname);
    if (pathname.endsWith(".tgz")) {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": servedArtifactBytes.length,
      });
      response.end(servedArtifactBytes);
      return;
    }
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Registry is not ready.");
    const manifest = {
      name: "@lagrangee/bearing",
      version: artifact.version,
      repository: { url: "git+https://github.com/lagrangee/bearing.git" },
      dist: {
        integrity,
        shasum,
        tarball: `http://127.0.0.1:${address.port}/@lagrangee/bearing/-/${artifact.filename}`,
      },
    };
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        name: manifest.name,
        "dist-tags": { latest: artifact.version },
        versions: { [artifact.version]: manifest },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Registry is not ready.");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    integrity,
    requests,
    corruptArtifact: () => {
      servedArtifactBytes = Buffer.concat([artifactBytes, Buffer.from("tampered")]);
    },
    restoreArtifact: () => {
      servedArtifactBytes = artifactBytes;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
};

test("packed update reports a verified same-version latest candidate as an up-to-date no-op", async () => {
  const product = await installPackedProduct();
  const controlled = await controlledNpm(product.root);

  try {
    await product.run(["install"]);
    const currentPackage = JSON.parse(
      await readFile(join(product.homeDir, ".bearing/kit/current/package.json"), "utf8"),
    );
    const update = await product.run(["update"], {
      observeRoots: [product.homeDir],
      environment: {
        PATH: `${controlled.binDirectory}:${process.env["PATH"] ?? ""}`,
        BEARING_TEST_NPM_LOG: controlled.log,
        BEARING_TEST_NPM_METADATA: JSON.stringify({
          version: currentPackage.version,
          "dist.integrity": `sha512-${"A".repeat(86)}==`,
          "repository.url": "git+https://github.com/lagrangee/bearing.git",
        }),
      },
    });

    expect(update.exitClass).toBe("success");
    expect(update.stdout).toContain(`Bearing ${currentPackage.version} is up to date.`);
    expect(update.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(
      (await readFile(controlled.log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      [
        "view",
        "@lagrangee/bearing@latest",
        "version",
        "dist.integrity",
        "repository.url",
        "--json",
      ],
    ]);
  } finally {
    await product.dispose();
  }
}, 60_000);

test("packed update requires separate confirmation and hands a verified exact candidate its owned surfaces", async () => {
  const product = await installPackedProduct();
  const current = join(product.homeDir, ".bearing/kit/current");
  const agentSkillDirectory = join(product.homeDir, ".agents/skills");
  const claudeSkillDirectory = join(product.homeDir, ".claude/skills");
  const repository = join(product.root, "repository");
  const targetVersion = "0.1.3";
  const candidate = join(product.root, "candidate");
  let registry: Awaited<ReturnType<typeof controlledRegistry>> | undefined;

  try {
    await Promise.all([
      mkdir(agentSkillDirectory, { recursive: true }),
      mkdir(claudeSkillDirectory, { recursive: true }),
      mkdir(repository),
    ]);
    await writeFile(join(repository, "sentinel"), "repository bytes\n");
    await product.run(["install", "--surface", "agent-skills"]);
    const currentMetadata = JSON.parse(await readFile(join(current, "package.json"), "utf8"));
    await cp(current, candidate, { recursive: true });
    await writeFile(
      join(candidate, "package.json"),
      `${JSON.stringify({ ...currentMetadata, version: targetVersion }, null, 2)}\n`,
    );
    registry = await controlledRegistry(product.root, candidate);
    const environment = {
      npm_config_registry: registry.url,
      npm_config_cache: join(product.root, "controlled-registry-cache"),
    };

    const nonInteractive = await product.run(["update"], {
      observeRoots: [product.homeDir, repository],
      environment,
    });
    expect(nonInteractive.exitClass).toBe("product-outcome");
    expect(nonInteractive.stdout).toContain(
      `Update available: ${currentMetadata.version} → ${targetVersion}`,
    );
    expect(nonInteractive.stdout).toMatch(/confirmation/iu);
    expect(nonInteractive.effects).toEqual({ created: [], changed: [], removed: [] });

    const declined = await product.runTerminal(["update"], "n\r", {
      observeRoots: [product.homeDir, repository],
      environment,
    });
    expect(declined.exitClass).toBe("success");
    expect(declined.stdout).toContain("Update declined");
    expect(declined.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.parse(await readFile(join(current, "package.json"), "utf8"))).toMatchObject({
      version: currentMetadata.version,
    });

    const cancelled = await product.runTerminal(["update"], "\r", {
      observeRoots: [product.homeDir, repository],
      environment,
    });
    expect(cancelled.exitClass).toBe("success");
    expect(cancelled.stdout).toContain("Update declined");
    expect(cancelled.effects).toEqual({ created: [], changed: [], removed: [] });

    registry.corruptArtifact();
    const integrityFailure = await product.runTerminal(["update"], "y\r", {
      observeRoots: [product.homeDir, repository],
      environment: {
        ...environment,
        npm_config_cache: join(product.root, "controlled-registry-corrupt-cache"),
      },
    });
    expect(integrityFailure.exitClass).toBe("product-outcome");
    expect(`${integrityFailure.stdout}\n${integrityFailure.stderr}`).toContain(
      "exact candidate acquisition failed",
    );
    expect(integrityFailure.effects).toEqual({ created: [], changed: [], removed: [] });
    registry.restoreArtifact();

    const confirmed = await product.runTerminal(["update"], "y\r", {
      observeRoots: [product.homeDir, repository],
      environment,
    });
    expect(confirmed.exitClass, `${confirmed.stdout}\n${confirmed.stderr}`).toBe("success");
    expect(confirmed.stdout).toContain(
      `Global Kit updated: ${currentMetadata.version} → ${targetVersion}`,
    );
    expect(confirmed.stdout).not.toContain("Detected Agent Surface Skill Directories");
    expect(JSON.parse(await readFile(join(current, "package.json"), "utf8"))).toMatchObject({
      version: targetVersion,
    });
    expect(await readlink(join(agentSkillDirectory, "bearing"))).toBe(
      join(current, "skills/bearing"),
    );
    await absent(join(claudeSkillDirectory, "bearing"));
    expect(await readFile(join(repository, "sentinel"), "utf8")).toBe("repository bytes\n");
    expect(registry.requests.some((request) => request.endsWith(".tgz"))).toBe(true);
  } finally {
    await registry?.close();
    await product.dispose();
  }
}, 60_000);

test("packed update keeps the current Kit byte-identical for registry and candidate verification failures", async () => {
  const product = await installPackedProduct();
  const controlled = await controlledNpm(product.root);

  try {
    await product.run(["install"]);
    const currentPackage = JSON.parse(
      await readFile(join(product.homeDir, ".bearing/kit/current/package.json"), "utf8"),
    );
    const baseEnvironment = {
      PATH: `${controlled.binDirectory}:${process.env["PATH"] ?? ""}`,
      BEARING_TEST_NPM_LOG: controlled.log,
    };
    const cases = [
      {
        label: "registry failure",
        metadata: {},
        extra: { BEARING_TEST_NPM_FAILURE: "registry" },
        expected: "controlled registry unavailable",
      },
      {
        label: "missing integrity",
        metadata: {
          version: "0.1.3",
          "repository.url": "git+https://github.com/lagrangee/bearing.git",
        },
        extra: {},
        expected: "candidate is unverifiable",
      },
      {
        label: "repository identity mismatch",
        metadata: {
          version: "0.1.3",
          "dist.integrity": `sha512-${"C".repeat(86)}==`,
          "repository.url": "git+https://github.com/example/not-bearing.git",
        },
        extra: {},
        expected: "candidate is unverifiable",
      },
      {
        label: "invalid exact published version",
        metadata: {
          version: "latest",
          "dist.integrity": `sha512-${"D".repeat(86)}==`,
          "repository.url": "git+https://github.com/lagrangee/bearing.git",
        },
        extra: {},
        expected: "candidate is unverifiable",
      },
    ] as const;

    for (const scenario of cases) {
      const update = await product.run(["update"], {
        observeRoots: [product.homeDir],
        environment: {
          ...baseEnvironment,
          ...scenario.extra,
          BEARING_TEST_NPM_METADATA: JSON.stringify(scenario.metadata),
        },
      });
      expect(update.exitClass, scenario.label).toBe("product-outcome");
      expect(`${update.stdout}\n${update.stderr}`, scenario.label).toContain(scenario.expected);
      expect(update.effects, scenario.label).toEqual({ created: [], changed: [], removed: [] });
      expect(
        JSON.parse(
          await readFile(join(product.homeDir, ".bearing/kit/current/package.json"), "utf8"),
        ),
      ).toMatchObject({ version: currentPackage.version });
    }
  } finally {
    await product.dispose();
  }
}, 60_000);

test("packed update blocks an older latest and refuses an unverifiable current Kit without writes", async () => {
  const product = await installPackedProduct();
  const controlled = await controlledNpm(product.root);
  const currentPackagePath = join(product.homeDir, ".bearing/kit/current/package.json");

  try {
    await product.run(["install"]);
    const environment = {
      PATH: `${controlled.binDirectory}:${process.env["PATH"] ?? ""}`,
      BEARING_TEST_NPM_LOG: controlled.log,
      BEARING_TEST_NPM_METADATA: JSON.stringify({
        version: "0.1.1",
        "dist.integrity": `sha512-${"E".repeat(86)}==`,
        "repository.url": "git+https://github.com/lagrangee/bearing.git",
      }),
    };
    const older = await product.run(["update"], {
      observeRoots: [product.homeDir],
      environment,
    });
    expect(older.exitClass).toBe("product-outcome");
    expect(older.stderr).toContain("Older Candidate Blocked");
    expect(older.stderr).not.toContain("--confirm-downgrade");
    expect(older.stderr).not.toContain("--force");
    expect(older.effects).toEqual({ created: [], changed: [], removed: [] });

    await writeFile(currentPackagePath, "{untrustworthy\n");
    const unverifiable = await product.run(["update"], {
      observeRoots: [product.homeDir],
      environment,
    });
    expect(unverifiable.exitClass).toBe("product-outcome");
    expect(unverifiable.stderr).toContain("Current Kit Unverifiable");
    expect(unverifiable.stderr).toContain("bearing uninstall");
    expect(unverifiable.stderr).toContain("Fresh Install");
    expect(unverifiable.stderr).not.toContain("Repair");
    expect(unverifiable.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(await readFile(currentPackagePath, "utf8")).toBe("{untrustworthy\n");
  } finally {
    await product.dispose();
  }
}, 60_000);

test("packed install detects complete Skill Directories and accepts a three-surface keyboard selection", async () => {
  const product = await installPackedProduct();
  const home = product.homeDir;
  const currentSkill = join(home, ".bearing/kit/current/skills/bearing");
  const agentSkills = join(home, ".agents/skills");
  const claudeSkills = join(home, ".claude/skills");
  const workbuddySkills = join(home, ".workbuddy/skills");

  try {
    await Promise.all([
      mkdir(agentSkills, { recursive: true }),
      mkdir(join(home, ".claude"), { recursive: true }),
      mkdir(join(home, ".workbuddy"), { recursive: true }),
    ]);

    const zeroSelected = await product.runTerminal(["install"], "\r", {
      observeRoots: [home],
    });
    expect(zeroSelected.exitClass).toBe("success");
    expect(zeroSelected.stdout).toContain(agentSkills);
    expect(zeroSelected.stdout).not.toContain(claudeSkills);
    expect(zeroSelected.stdout).not.toContain(workbuddySkills);
    expect(zeroSelected.stdout).toMatch(/up\/down[\s\S]*Space[\s\S]*Enter/iu);
    await absent(join(agentSkills, "bearing"));
    await absent(claudeSkills);
    await absent(workbuddySkills);

    await Promise.all([
      mkdir(claudeSkills, { recursive: true }),
      mkdir(workbuddySkills, { recursive: true }),
    ]);
    const allSelected = await product.runTerminal(["install"], " \u001b[B \u001b[B \r", {
      observeRoots: [home],
    });
    expect(allSelected.exitClass).toBe("success");
    for (const root of [agentSkills, claudeSkills, workbuddySkills]) {
      expect(allSelected.stdout).toContain(root);
      expect(await readlink(join(root, "bearing"))).toBe(currentSkill);
    }
    expect(allSelected.stdout).toContain("Agent Surface Integration:");
    expect(allSelected.stdout).toContain("agent-skills: applied");
    expect(allSelected.stdout).toContain("claude: applied");
    expect(allSelected.stdout).toContain("workbuddy: applied");
  } finally {
    await product.dispose();
  }
}, 60_000);

test("packed install repairs owned links and isolates each surface conflict after Kit success", async () => {
  const product = await installPackedProduct();
  const home = product.homeDir;
  const current = join(home, ".bearing/kit/current");
  const currentSkill = join(current, "skills/bearing");
  const targets = {
    "agent-skills": join(home, ".agents/skills/bearing"),
    claude: join(home, ".claude/skills/bearing"),
    workbuddy: join(home, ".workbuddy/skills/bearing"),
  };
  const external = join(product.root, "user-owned-skill");

  try {
    await Promise.all([
      mkdir(join(home, ".agents/skills"), { recursive: true }),
      mkdir(join(home, ".claude/skills"), { recursive: true }),
      mkdir(join(home, ".workbuddy/skills"), { recursive: true }),
      mkdir(external),
    ]);
    const installed = await product.run(["install"], { observeRoots: [home] });
    expect(installed.exitClass).toBe("success");

    await symlink(join(home, ".bearing/kit/0.1.1/skills/bearing"), targets["agent-skills"], "dir");
    await symlink(external, targets.claude, "dir");
    const partial = await product.run(
      ["install", "--surface", "agent-skills", "--surface", "claude", "--surface", "workbuddy"],
      { observeRoots: [home] },
    );
    expect(partial.exitClass).toBe("product-outcome");
    expect(partial.stdout).toContain("Outcome: partial");
    expect(partial.stdout).toContain("Global Kit: no-op");
    expect(partial.stdout).toContain("agent-skills: applied");
    expect(partial.stdout).toContain("claude: conflict");
    expect(partial.stdout).toContain("workbuddy: applied");
    expect(await readlink(targets["agent-skills"])).toBe(currentSkill);
    expect(await readlink(targets.claude)).toBe(external);
    expect(await readlink(targets.workbuddy)).toBe(currentSkill);
    await access(current);

    const currentOwned = await product.run(["install", "--surface", "agent-skills"], {
      observeRoots: [home],
    });
    expect(currentOwned.exitClass).toBe("success");
    expect(currentOwned.stdout).toContain("Outcome: no-op");
    expect(currentOwned.stdout).toContain("agent-skills: no-op");

    await rm(targets.claude);
    await writeFile(targets.claude, "user-owned file\n");
    const regularFile = await product.run(["install", "--surface", "claude"]);
    expect(regularFile.exitClass).toBe("product-outcome");
    expect(regularFile.stdout).toContain("Regular file is preserved");
    expect(await readFile(targets.claude, "utf8")).toBe("user-owned file\n");

    await rm(targets.claude);
    await mkdir(targets.claude);
    const directory = await product.run(["install", "--surface", "claude"]);
    expect(directory.exitClass).toBe("product-outcome");
    expect(directory.stdout).toContain("Directory is preserved");

    await rm(targets.claude, { recursive: true });
    const namespaceLookalike = join(home, ".bearing/kit/not-skills/bearing");
    await symlink(namespaceLookalike, targets.claude, "dir");
    const lookalike = await product.run(["install", "--surface", "claude"]);
    expect(lookalike.exitClass).toBe("product-outcome");
    expect(lookalike.stdout).toContain("Non-owned symbolic link is preserved");
    expect(await readlink(targets.claude)).toBe(namespaceLookalike);

    await rm(join(home, ".workbuddy/skills"), { recursive: true });
    const missing = await product.run(["install", "--surface", "workbuddy"]);
    expect(missing.exitClass).toBe("product-outcome");
    expect(missing.stdout).toContain("Skill Directory is not an existing directory");
    await absent(join(home, ".workbuddy/skills"));
    await access(current);
  } finally {
    await product.dispose();
  }
}, 60_000);

test("packed CLI keeps help read-only and exposes explicit Global Kit primitives", async () => {
  const product = await installPackedProduct();
  const home = product.homeDir;
  const repository = join(product.root, "repository");
  const current = join(home, ".bearing/kit/current");
  const cli = join(home, ".bearing/bin/bearing");
  const skill = join(home, ".agents/skills/bearing");

  try {
    await Promise.all([
      mkdir(join(repository, ".bearing/state"), { recursive: true }),
      mkdir(join(repository, ".bearing/integration"), { recursive: true }),
      mkdir(join(repository, ".bearing/executor-profiles"), { recursive: true }),
      mkdir(join(repository, "evidence"), { recursive: true }),
    ]);
    await writeFile(join(repository, ".bearing/state/project-summary.md"), "canonical state\n");
    await writeFile(
      join(repository, ".bearing/integration/provider.json"),
      "provider configuration\n",
    );
    await writeFile(join(repository, ".bearing/executor-profiles/agent.json"), "profile\n");
    await writeFile(join(repository, "evidence/artifact.md"), "durable artifact\n");

    const help = await product.run([], { observeRoots: [home, repository] });
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage:");
    expect(help.stdout).toContain("bearing install");
    expect(help.stdout).toContain("bearing update");
    expect(help.stdout).toContain("bearing uninstall");
    expect(help.stdout).not.toContain("maintenance wizard");
    expect(help.stdout).not.toContain("Repair");
    expect(help.effects).toEqual({ created: [], changed: [], removed: [] });

    const installed = await product.run(["install"], { observeRoots: [home, repository] });
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain("Outcome: applied");
    expect(installed.stdout).toContain('export PATH="$HOME/.bearing/bin:$PATH"');
    expect(installed.stdout).toMatch(/current session/iu);
    expect(installed.stdout).toMatch(/startup profile/iu);
    expect(await readlink(cli)).toBe(join(current, "dist/cli.js"));
    await absent(skill);
    expect(
      [
        ...installed.effects.created,
        ...installed.effects.changed,
        ...installed.effects.removed,
      ].filter((locator) => locator.startsWith("root-1/")),
    ).toEqual([]);

    await mkdir(join(home, ".agents/skills"), { recursive: true });
    const integrated = await product.run(["install", "--surface", "agent-skills"], {
      observeRoots: [home, repository],
    });
    expect(integrated.exitCode).toBe(0);
    expect(await readlink(skill)).toBe(join(current, "skills/bearing"));
    expect(
      [
        ...integrated.effects.created,
        ...integrated.effects.changed,
        ...integrated.effects.removed,
      ].filter((locator) => locator.startsWith("root-1/")),
    ).toEqual([]);

    const catalog = join(home, ".bearing/catalog.sqlite");
    const nativeWork = join(repository, ".scratch/work.md");
    const unmanagedSurfaceEntry = join(home, ".claude/skills/bearing");
    await mkdir(join(repository, ".scratch"), { recursive: true });
    await mkdir(join(home, ".claude/skills"), { recursive: true });
    await writeFile(catalog, "catalog sentinel\n");
    await writeFile(nativeWork, "native work\n");
    await writeFile(unmanagedSurfaceEntry, "user-owned Claude entry\n");

    const uninstalled = await product.run(["uninstall"], {
      observeRoots: [home, repository],
    });
    expect(uninstalled.exitCode).toBe(0);
    expect(uninstalled.stdout).toContain("Outcome: applied");
    await absent(current);
    await absent(cli);
    await absent(skill);
    expect(await readFile(catalog, "utf8")).toBe("catalog sentinel\n");
    expect(await readFile(join(repository, ".bearing/state/project-summary.md"), "utf8")).toBe(
      "canonical state\n",
    );
    expect(await readFile(join(repository, ".bearing/integration/provider.json"), "utf8")).toBe(
      "provider configuration\n",
    );
    expect(await readFile(join(repository, ".bearing/executor-profiles/agent.json"), "utf8")).toBe(
      "profile\n",
    );
    expect(await readFile(join(repository, "evidence/artifact.md"), "utf8")).toBe(
      "durable artifact\n",
    );
    expect(await readFile(nativeWork, "utf8")).toBe("native work\n");
    expect(await readFile(unmanagedSurfaceEntry, "utf8")).toBe("user-owned Claude entry\n");
    expect(
      [
        ...uninstalled.effects.created,
        ...uninstalled.effects.changed,
        ...uninstalled.effects.removed,
      ].filter((locator) => locator.startsWith("root-1/")),
    ).toEqual([]);

    const repeatedUninstall = await product.run(["uninstall"], {
      observeRoots: [home, repository],
    });
    expect(repeatedUninstall.exitCode).toBe(0);
    expect(repeatedUninstall.stdout).toContain("Outcome: no-op");
    expect(repeatedUninstall.effects).toEqual({ created: [], changed: [], removed: [] });

    await mkdir(join(home, ".agents/skills"), { recursive: true });
    await writeFile(skill, "user-owned skill\n");
    const conflicted = await product.run(["install", "--surface", "agent-skills"], {
      observeRoots: [home, repository],
    });
    expect(conflicted.exitCode).not.toBe(0);
    expect(`${conflicted.stdout}\n${conflicted.stderr}`).toContain("Regular file is preserved");
    expect(await readFile(skill, "utf8")).toBe("user-owned skill\n");
    await access(current);
    await rm(skill);

    const explicit = await product.run(["install", "--surface", "agent-skills"], {
      observeRoots: [home, repository],
    });
    expect(explicit.exitCode).toBe(0);
    expect(explicit.stdout).toContain("Outcome: applied");
    expect(explicit.stdout).not.toContain("Select an action");
    expect(await readlink(skill)).toBe(join(current, "skills/bearing"));
  } finally {
    await product.dispose();
  }
}, 60_000);

test("packed exact-candidate install blocks older and unverifiable current Kits without writes", async () => {
  const product = await installPackedProduct();
  const home = product.homeDir;
  const installedPackage = join(home, ".bearing/kit/current/package.json");

  try {
    const installed = await product.run(["install"], { observeRoots: [home] });
    expect(installed.exitCode).toBe(0);
    const metadata = JSON.parse(await readFile(installedPackage, "utf8"));

    await writeFile(installedPackage, `${JSON.stringify({ ...metadata, version: "0.2.0" })}\n`);
    const older = await product.run(["install"], { observeRoots: [home] });
    expect(older.exitCode).not.toBe(0);
    expect(older.stderr).toContain("Older Candidate Blocked");
    expect(older.stderr).toContain("0.2.0");
    expect(older.stderr).toContain(metadata.version);
    expect(older.stderr).not.toContain("confirm-downgrade");
    expect(older.effects).toEqual({ created: [], changed: [], removed: [] });

    await writeFile(
      installedPackage,
      `${JSON.stringify({ ...metadata, name: "not-the-bearing-package" })}\n`,
    );
    const wrongIdentity = await product.run(["install"], { observeRoots: [home] });
    expect(wrongIdentity.exitCode).not.toBe(0);
    expect(wrongIdentity.stderr).toContain("Current Kit Unverifiable");
    expect(wrongIdentity.stderr).toContain(installedPackage);
    expect(wrongIdentity.effects).toEqual({ created: [], changed: [], removed: [] });

    await writeFile(installedPackage, "{untrustworthy\n");
    const unverifiable = await product.run(["install"], { observeRoots: [home] });
    expect(unverifiable.exitCode).not.toBe(0);
    expect(unverifiable.stderr).toContain("Current Kit Unverifiable");
    expect(unverifiable.stderr).toContain(installedPackage);
    expect(unverifiable.stderr).toContain("bearing uninstall");
    expect(unverifiable.stderr).toContain("Fresh Install");
    expect(unverifiable.stderr).not.toContain("Repair");
    expect(unverifiable.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(await readFile(installedPackage, "utf8")).toBe("{untrustworthy\n");
  } finally {
    await product.dispose();
  }
}, 60_000);
