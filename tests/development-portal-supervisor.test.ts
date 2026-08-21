import { afterAll, expect, test } from "bun:test";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  developmentPortalHealthSchema,
  developmentPortalIdentitySchema,
} from "../src/development-portal-health";
import {
  DEVELOPMENT_PORTAL_PORT,
  DEVELOPMENT_PORTAL_RUNTIME_REQUIRED,
} from "../src/development-portal-supervisor";

const projectRoot = await realpath(join(import.meta.dir, ".."));
const harness = join(projectRoot, "tests/fixtures/development-portal-supervisor-harness.ts");
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

const temporaryDirectory = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

const reservePort = async (): Promise<number> => {
  const reservation = createNetServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (address === null || typeof address === "string") throw new Error("No test port available.");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
};

const spawnSupervisor = (
  repositoryRoot: string,
  publicHome: string,
  port: number,
  healthDelay = 0,
): ChildProcessWithoutNullStreams =>
  spawn("bun", [harness, repositoryRoot, String(port), String(healthDelay)], {
    cwd: projectRoot,
    detached: true,
    env: { ...process.env, HOME: publicHome },
    stdio: ["pipe", "pipe", "pipe"],
  });

type PublicStateSnapshot = Readonly<{
  catalog: string;
  state: string;
  cliLink: string;
  skillLink: string;
}>;

const readPublicState = async (home: string): Promise<PublicStateSnapshot> => ({
  catalog: await readFile(join(home, ".bearing/catalog.sqlite"), "utf8"),
  state: await readFile(join(home, ".bearing/state-sentinel.json"), "utf8"),
  cliLink: await readlink(join(home, ".bearing/bin/bearing")),
  skillLink: await readlink(join(home, ".agents/skills/bearing")),
});

const seedPublicState = async (home: string): Promise<PublicStateSnapshot> => {
  await Promise.all([
    mkdir(join(home, ".bearing/bin"), { recursive: true }),
    mkdir(join(home, ".bearing/kit/current/dist"), { recursive: true }),
    mkdir(join(home, ".bearing/kit/current/skills/bearing"), { recursive: true }),
    mkdir(join(home, ".agents/skills"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(home, ".bearing/catalog.sqlite"), "public-catalog-sentinel\n"),
    writeFile(join(home, ".bearing/state-sentinel.json"), '{"owner":"public"}\n'),
    writeFile(join(home, ".bearing/kit/current/dist/cli.js"), "public-cli-sentinel\n"),
    writeFile(
      join(home, ".bearing/kit/current/skills/bearing/SKILL.md"),
      "public-skill-sentinel\n",
    ),
  ]);
  await Promise.all([
    symlink("../kit/current/dist/cli.js", join(home, ".bearing/bin/bearing")),
    symlink("../../.bearing/kit/current/skills/bearing", join(home, ".agents/skills/bearing")),
  ]);
  return readPublicState(home);
};

const waitForLine = async (
  child: ChildProcessWithoutNullStreams,
  prefix: string,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => reject(new Error(`Supervisor readiness timed out: ${stderr.trim()}`)),
      10_000,
    );
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      const line = stdout.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
      if (line !== undefined) {
        clearTimeout(timeout);
        resolve(line);
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Supervisor exited ${code ?? "without status"}: ${stderr.trim()}`));
    });
  });

const stopSupervisor = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("close", () => resolve())),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("Supervisor shutdown exceeded five seconds.")), 5_000),
    ),
  ]);
};

const waitForSupervisorExit = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () => resolve());
    }),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("Supervisor did not exit after shutdown signals.")), 7_000),
    ),
  ]);
};

const waitForHealth = async (port: number): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("Development Portal child health did not become reachable.");
};

const runSupervisorToExit = async (
  repositoryRoot: string,
  publicHome: string,
  port: number,
): Promise<Readonly<{ code: number | null; stderr: string }>> => {
  const child = spawnSupervisor(repositoryRoot, publicHome, port);
  child.stdin.end();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await Promise.race([
    new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    }),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("Supervisor failure did not settle.")), 10_000),
    ),
  ]);
  return { code, stderr };
};

test("the source-only Development Portal command owns fixed port 4188", () => {
  expect(DEVELOPMENT_PORTAL_PORT).toBe(4188);
});

test("a public or external repository cannot start the Development Portal command", async () => {
  const publicHome = await temporaryDirectory("bearing-ticket-09-public-home-");
  const publicState = await seedPublicState(publicHome);
  const stableRepository = await temporaryDirectory("bearing-ticket-09-stable-repo-");
  const result = Bun.spawnSync(
    ["node", join(projectRoot, "dist/cli.js"), "development", "portal", "--repo", stableRepository],
    { cwd: projectRoot, env: { ...process.env, HOME: publicHome } },
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString().trim()).toBe(DEVELOPMENT_PORTAL_RUNTIME_REQUIRED);
  expect(await readPublicState(publicHome)).toEqual(publicState);
});

test("one foreground supervisor proves health and releases only its owned Development child", async () => {
  const publicHome = await temporaryDirectory("bearing-ticket-09-public-home-");
  const publicState = await seedPublicState(publicHome);
  const port = await reservePort();
  const unrelated = createHttpServer((_request, response) => response.end("public-listener"));
  await new Promise<void>((resolve) => unrelated.listen(0, "127.0.0.1", resolve));
  const unrelatedAddress = unrelated.address();
  if (unrelatedAddress === null || typeof unrelatedAddress === "string") {
    throw new Error("Unrelated listener did not bind.");
  }
  try {
    const child = spawnSupervisor(projectRoot, publicHome, port);
    child.stdin.end();
    try {
      const runtimeInspect = Bun.spawnSync(
        ["node", join(projectRoot, "dist/cli.js"), "runtime", "inspect", "--repo", projectRoot],
        { cwd: projectRoot, env: { ...process.env, HOME: publicHome } },
      );
      expect(runtimeInspect.exitCode).toBe(0);
      const runtime = JSON.parse(runtimeInspect.stdout.toString()) as {
        outcome: "resolved";
        context: {
          receipt: {
            runtimeIdentity: string;
            stateRootIdentity: string;
            portalBuildId: string;
          };
        };
      };
      const prefix = "Bearing Development Portal current: ";
      const line = await waitForLine(child, prefix);
      const reported = developmentPortalIdentitySchema.parse(
        JSON.parse(line.slice(prefix.length)) as unknown,
      );
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      const health = developmentPortalHealthSchema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(health.development).toEqual(reported);
      expect(health.development).toEqual({
        schemaVersion: 1,
        channel: "development",
        runtimeIdentity: runtime.context.receipt.runtimeIdentity,
        stateRootIdentity: runtime.context.receipt.stateRootIdentity,
        portalBuildIdentity: runtime.context.receipt.portalBuildId,
      });
      expect(JSON.stringify(health)).not.toContain(projectRoot);
      expect(await readPublicState(publicHome)).toEqual(publicState);
    } finally {
      await stopSupervisor(child);
    }
    expect(await (await fetch(`http://127.0.0.1:${unrelatedAddress.port}`)).text()).toBe(
      "public-listener",
    );
    expect(await readPublicState(publicHome)).toEqual(publicState);
    const released = createNetServer();
    await new Promise<void>((resolve) => released.listen(port, "127.0.0.1", resolve));
    await new Promise<void>((resolve, reject) =>
      released.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      unrelated.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
}, 20_000);

test("shutdown during child health validation absorbs repeated signals and releases the child", async () => {
  const publicHome = await temporaryDirectory("bearing-ticket-09-public-home-");
  const publicState = await seedPublicState(publicHome);
  const port = await reservePort();
  const child = spawnSupervisor(projectRoot, publicHome, port, 5_000);
  child.stdin.end();
  await waitForHealth(port);

  child.kill("SIGTERM");
  child.kill("SIGTERM");
  await waitForSupervisorExit(child);

  const released = createNetServer();
  await new Promise<void>((resolve) => released.listen(port, "127.0.0.1", resolve));
  await new Promise<void>((resolve, reject) =>
    released.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  expect(await readPublicState(publicHome)).toEqual(publicState);
}, 20_000);

test("an unknown listener produces an exact conflict without termination or adoption", async () => {
  const publicHome = await temporaryDirectory("bearing-ticket-09-public-home-");
  const publicState = await seedPublicState(publicHome);
  const sentinel = createHttpServer((_request, response) => response.end("unknown-listener"));
  await new Promise<void>((resolve) => sentinel.listen(0, "127.0.0.1", resolve));
  const address = sentinel.address();
  if (address === null || typeof address === "string") throw new Error("Sentinel did not bind.");
  try {
    const result = await runSupervisorToExit(projectRoot, publicHome, address.port);
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe(
      `Development Portal port conflict: 127.0.0.1:${address.port} is already owned by another process. The process was not inspected, terminated, or adopted.`,
    );
    expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe("unknown-listener");
    expect(await readPublicState(publicHome)).toEqual(publicState);
  } finally {
    await new Promise<void>((resolve, reject) =>
      sentinel.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
}, 20_000);
