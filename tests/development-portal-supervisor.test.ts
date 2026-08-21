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
  observeDevelopmentBuildPublications,
} from "../src/development-portal-supervisor";
import type { RuntimeReceipt } from "../src/runtime-context";

const projectRoot = await realpath(join(import.meta.dir, ".."));
const harness = join(projectRoot, "tests/fixtures/development-portal-supervisor-harness.ts");
const temporaryRoots: string[] = [];
type ControlledDevelopmentReceipt = RuntimeReceipt &
  Readonly<{
    channel: "development";
    buildIdentity: string;
    portalBuildId: string;
  }>;

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

const temporaryDirectory = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

const prepareControlledDevelopmentRuntime = async (
  publicHome: string,
): Promise<Readonly<{ controlRoot: string; receipt: ControlledDevelopmentReceipt }>> => {
  const controlRoot = await temporaryDirectory("bearing-development-runtime-control-");
  const receipt: ControlledDevelopmentReceipt = {
    schemaVersion: 1,
    channel: "development",
    runtimeIdentity: `sha256:${"9".repeat(64)}`,
    stateRootIdentity: `sha256:${"7".repeat(64)}`,
    buildIdentity: `sha256:${"8".repeat(64)}`,
    portalBuildId: "a".repeat(64),
  };
  await Promise.all([
    writeFile(join(controlRoot, "publication"), "0\n"),
    writeFile(
      join(controlRoot, "runtime.json"),
      `${JSON.stringify({
        outcome: "resolved",
        receipt,
        context: {
          homeDir: publicHome,
          projectReadModelPath: join(controlRoot, "project-read-model.sqlite"),
        },
      })}\n`,
    ),
  ]);
  return { controlRoot, receipt };
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
  controlRoot?: string,
  useBuiltPortalChild = false,
): ChildProcessWithoutNullStreams =>
  spawn(
    "bun",
    [
      harness,
      repositoryRoot,
      String(port),
      String(healthDelay),
      ...(controlRoot ? [controlRoot] : []),
    ],
    {
      cwd: projectRoot,
      detached: true,
      env: {
        ...process.env,
        HOME: publicHome,
        ...(controlRoot === undefined
          ? {}
          : { BEARING_TEST_DEVELOPMENT_IDENTITY: join(controlRoot, "runtime.json") }),
        ...(useBuiltPortalChild
          ? {
              BEARING_TEST_DEVELOPMENT_CHILD_EXECUTABLE: Bun.which("node") ?? "node",
              BEARING_TEST_DEVELOPMENT_CHILD_LOCATOR: join(projectRoot, "dist/cli.js"),
            }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

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

const readInstance = async (port: number): Promise<string> => {
  const response = await fetch(`http://127.0.0.1:${port}/instance`);
  const value = (await response.json()) as { instance: string };
  return value.instance;
};

type DevelopmentStateSnapshot = Readonly<{
  catalog: string;
  state: string;
  projectReadModel: string;
}>;

const readDevelopmentState = async (port: number): Promise<DevelopmentStateSnapshot> => {
  const response = await fetch(`http://127.0.0.1:${port}/state`);
  return (await response.json()) as DevelopmentStateSnapshot;
};

const waitForInstanceChange = async (port: number, initial: string): Promise<string> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const current = await readInstance(port);
      if (current !== initial) return current;
    } catch {
      // A bounded interruption is expected while the owned child is replaced.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Development Portal child was not replaced.");
};

const waitForResolutionReadback = async (
  controlRoot: string,
  expected: (value: { outcome: string; receipt?: RuntimeReceipt }) => boolean,
): Promise<void> => {
  const path = join(controlRoot, "resolution-readback.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as {
        outcome: string;
        receipt?: RuntimeReceipt;
      };
      if (expected(value)) return;
    } catch {
      // The controlled resolver has not completed this publication yet.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Development Runtime resolution readback timed out.");
};

const runSupervisorToExit = async (
  repositoryRoot: string,
  publicHome: string,
  port: number,
  controlRoot?: string,
  useBuiltPortalChild = false,
): Promise<Readonly<{ code: number | null; stderr: string }>> => {
  const child = spawnSupervisor(
    repositoryRoot,
    publicHome,
    port,
    0,
    controlRoot,
    useBuiltPortalChild,
  );
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

test("build publication observation follows the atomic dist entry", async () => {
  const root = await temporaryDirectory("bearing-ticket-10-observer-");
  await mkdir(join(root, "dist"));
  const controller = new AbortController();
  const iterator = observeDevelopmentBuildPublications(root, controller.signal)[
    Symbol.asyncIterator
  ]();
  const publication = iterator.next();
  await rm(join(root, "dist"), { recursive: true });
  await mkdir(join(root, "dist"));
  const published = await Promise.race([
    publication.then((result) => !result.done),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  controller.abort();
  expect(published).toBe(true);
});

test("one real supervisor keeps its child until a different coherent Build Identity is published", async () => {
  const publicHome = await temporaryDirectory("bearing-ticket-10-public-home-");
  const publicState = await seedPublicState(publicHome);
  const controlRoot = await temporaryDirectory("bearing-ticket-10-control-");
  const developmentHome = join(controlRoot, "runtime-home");
  const developmentStateRoot = join(developmentHome, ".bearing");
  const projectReadModelPath = join(controlRoot, "cache/development/project-read-model.sqlite");
  await Promise.all([
    mkdir(join(developmentStateRoot, "state"), { recursive: true }),
    mkdir(join(controlRoot, "cache/development"), { recursive: true }),
  ]);
  const sentinels = {
    catalog: join(developmentStateRoot, "catalog.sqlite"),
    state: join(developmentStateRoot, "state/sentinel.json"),
    projectReadModel: projectReadModelPath,
  };
  await Promise.all([
    writeFile(sentinels.catalog, "development-catalog\n"),
    writeFile(sentinels.state, "development-state\n"),
    writeFile(
      sentinels.projectReadModel,
      `${JSON.stringify({ providerEvidence: "current-provider-evidence", acquisitionCount: 0 })}\n`,
    ),
    writeFile(join(controlRoot, "publication"), "0\n"),
  ]);
  const selected: RuntimeReceipt = {
    schemaVersion: 1,
    channel: "development",
    runtimeIdentity: `sha256:${"7".repeat(64)}`,
    stateRootIdentity: `sha256:${"7".repeat(64)}`,
    buildIdentity: `sha256:${"7".repeat(64)}`,
    portalBuildId: "7".repeat(64),
  };
  const initial = {
    ...selected,
    buildIdentity: `sha256:${"8".repeat(64)}`,
    runtimeIdentity: `sha256:${"9".repeat(64)}`,
    portalBuildId: "a".repeat(64),
  };
  await writeFile(
    join(controlRoot, "runtime.json"),
    `${JSON.stringify({
      outcome: "resolved",
      commandReceipt: selected,
      receipt: initial,
      context: { homeDir: developmentHome, projectReadModelPath },
    })}\n`,
  );
  let retainedState = await Promise.all(
    Object.values(sentinels).map((path) => readFile(path, "utf8")),
  );
  const publicListener = createHttpServer((_request, response) => response.end("public-portal"));
  await new Promise<void>((resolve) => publicListener.listen(0, "127.0.0.1", resolve));
  const publicAddress = publicListener.address();
  if (publicAddress === null || typeof publicAddress === "string") {
    throw new Error("Public listener did not bind.");
  }
  const port = await reservePort();
  const supervisor = spawnSupervisor(projectRoot, publicHome, port, 0, controlRoot);
  supervisor.stdin.end();
  let stdout = "";
  let stderr = "";
  supervisor.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  supervisor.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  try {
    await waitForLine(supervisor, "Bearing Development Portal current: ");
    const firstInstance = await readInstance(port);
    const firstHealth = developmentPortalHealthSchema.parse(
      await (await fetch(`http://127.0.0.1:${port}/healthz`)).json(),
    );
    expect(firstHealth.development.portalBuildIdentity).toBe(initial.portalBuildId);
    const firstDevelopmentState = await readDevelopmentState(port);
    expect(firstDevelopmentState).toEqual({
      catalog: "development-catalog\n",
      state: "development-state\n",
      projectReadModel: `${JSON.stringify({
        providerEvidence: "current-provider-evidence",
        acquisitionCount: 0,
      })}\n`,
    });

    const updatedProjectReadModel = `${JSON.stringify({
      providerEvidence: "updated-provider-evidence",
      acquisitionCount: 0,
    })}\n`;
    await writeFile(sentinels.projectReadModel, updatedProjectReadModel);
    await rm(join(controlRoot, "resolution-readback.json"), { force: true });
    await writeFile(join(controlRoot, "publication"), "provider-evidence-only\n");
    await waitForResolutionReadback(
      controlRoot,
      (value) => value.receipt?.buildIdentity === initial.buildIdentity,
    );
    expect(await readInstance(port)).toBe(firstInstance);
    expect(await readDevelopmentState(port)).toEqual({
      ...firstDevelopmentState,
      projectReadModel: updatedProjectReadModel,
    });
    retainedState = await Promise.all(
      Object.values(sentinels).map((path) => readFile(path, "utf8")),
    );

    await Promise.all([
      writeFile(join(controlRoot, "skill-only.md"), "live skill changed\n"),
      writeFile(join(controlRoot, ".bearing-build-staging"), "incomplete build\n"),
    ]);

    const sameBuild = {
      ...initial,
      runtimeIdentity: `sha256:${"a".repeat(64)}`,
      sourceProvenance: { gitHead: "a".repeat(40), dirty: false },
    };
    await writeFile(
      join(controlRoot, "runtime.json"),
      `${JSON.stringify({
        outcome: "resolved",
        receipt: sameBuild,
        context: { homeDir: developmentHome, projectReadModelPath },
      })}\n`,
    );
    await rm(join(controlRoot, "resolution-readback.json"), { force: true });
    await writeFile(join(controlRoot, "publication"), "same-build\n");
    await waitForResolutionReadback(
      controlRoot,
      (value) => value.receipt?.runtimeIdentity === sameBuild.runtimeIdentity,
    );
    expect(await readInstance(port)).toBe(firstInstance);

    await writeFile(
      join(controlRoot, "runtime.json"),
      `${JSON.stringify({
        outcome: "unfulfilled",
        diagnostics: [{ code: "development-build-stale", impact: "blocking", target: "dist" }],
      })}\n`,
    );
    await rm(join(controlRoot, "resolution-readback.json"), { force: true });
    await writeFile(join(controlRoot, "publication"), "failed-build\n");
    await waitForResolutionReadback(controlRoot, (value) => value.outcome === "unfulfilled");
    expect(await readInstance(port)).toBe(firstInstance);

    const incoherent = {
      ...initial,
      buildIdentity: `sha256:${"4".repeat(64)}`,
      runtimeIdentity: `sha256:${"5".repeat(64)}`,
      stateRootIdentity: `sha256:${"6".repeat(64)}`,
    };
    await writeFile(
      join(controlRoot, "runtime.json"),
      `${JSON.stringify({
        outcome: "resolved",
        receipt: incoherent,
        context: { homeDir: developmentHome, projectReadModelPath },
      })}\n`,
    );
    await rm(join(controlRoot, "resolution-readback.json"), { force: true });
    await writeFile(join(controlRoot, "publication"), "incoherent-receipt\n");
    await waitForResolutionReadback(
      controlRoot,
      (value) => value.receipt?.buildIdentity === incoherent.buildIdentity,
    );
    expect(await readInstance(port)).toBe(firstInstance);

    const next = {
      ...initial,
      buildIdentity: `sha256:${"b".repeat(64)}`,
      runtimeIdentity: `sha256:${"c".repeat(64)}`,
      portalBuildId: "d".repeat(64),
    };
    await writeFile(
      join(controlRoot, "runtime.json"),
      `${JSON.stringify({
        outcome: "resolved",
        receipt: next,
        context: { homeDir: developmentHome, projectReadModelPath },
      })}\n`,
    );
    await writeFile(join(controlRoot, "transient-failures.txt"), "1\n");
    await writeFile(join(controlRoot, "publication"), "coherent-build\n");
    const secondInstance = await waitForInstanceChange(port, firstInstance);
    const health = developmentPortalHealthSchema.parse(
      await (await fetch(`http://127.0.0.1:${port}/healthz`)).json(),
    );
    expect(health.development).toMatchObject({
      runtimeIdentity: next.runtimeIdentity,
      stateRootIdentity: next.stateRootIdentity,
      portalBuildIdentity: next.portalBuildId,
    });
    expect(await readDevelopmentState(port)).toEqual({
      ...firstDevelopmentState,
      projectReadModel: updatedProjectReadModel,
    });

    await rm(join(controlRoot, "resolution-readback.json"), { force: true });
    await writeFile(join(controlRoot, "publication"), "repeated-event\n");
    await waitForResolutionReadback(
      controlRoot,
      (value) => value.receipt?.buildIdentity === next.buildIdentity,
    );
    expect(await readInstance(port)).toBe(secondInstance);
    expect(
      await Promise.all(Object.values(sentinels).map((path) => readFile(path, "utf8"))),
    ).toEqual(retainedState);
    expect(await readPublicState(publicHome)).toEqual(publicState);
    expect(await (await fetch(`http://127.0.0.1:${publicAddress.port}`)).text()).toBe(
      "public-portal",
    );

    const failedStart = {
      ...next,
      buildIdentity: `sha256:${"e".repeat(64)}`,
      runtimeIdentity: `sha256:${"f".repeat(64)}`,
      portalBuildId: "e".repeat(64),
    };
    await writeFile(
      join(controlRoot, "runtime.json"),
      `${JSON.stringify({
        outcome: "resolved",
        receipt: failedStart,
        context: { homeDir: developmentHome, projectReadModelPath },
      })}\n`,
    );
    await writeFile(join(controlRoot, "fail-start"), "fail\n");
    await writeFile(join(controlRoot, "publication"), "final-startup-failure\n");
    await waitForSupervisorExit(supervisor);
    expect(supervisor.exitCode).toBe(1);
    expect(stderr).toContain("Development Portal child failed before readiness");
    expect(
      stdout
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("Bearing Development Portal current: ")),
    ).toHaveLength(2);
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
    expect(await (await fetch(`http://127.0.0.1:${publicAddress.port}`)).text()).toBe(
      "public-portal",
    );
  } finally {
    await stopSupervisor(supervisor);
    await new Promise<void>((resolve, reject) =>
      publicListener.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
}, 30_000);

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
  const controlled = await prepareControlledDevelopmentRuntime(publicHome);
  const port = await reservePort();
  const unrelated = createHttpServer((_request, response) => response.end("public-listener"));
  await new Promise<void>((resolve) => unrelated.listen(0, "127.0.0.1", resolve));
  const unrelatedAddress = unrelated.address();
  if (unrelatedAddress === null || typeof unrelatedAddress === "string") {
    throw new Error("Unrelated listener did not bind.");
  }
  try {
    const child = spawnSupervisor(projectRoot, publicHome, port, 0, controlled.controlRoot);
    child.stdin.end();
    try {
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
        runtimeIdentity: controlled.receipt.runtimeIdentity,
        stateRootIdentity: controlled.receipt.stateRootIdentity,
        portalBuildIdentity: controlled.receipt.portalBuildId,
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
  const controlled = await prepareControlledDevelopmentRuntime(publicHome);
  const port = await reservePort();
  const child = spawnSupervisor(projectRoot, publicHome, port, 5_000, controlled.controlRoot);
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
  const controlled = await prepareControlledDevelopmentRuntime(publicHome);
  const sentinel = createHttpServer((_request, response) => response.end("unknown-listener"));
  await new Promise<void>((resolve) => sentinel.listen(0, "127.0.0.1", resolve));
  const address = sentinel.address();
  if (address === null || typeof address === "string") throw new Error("Sentinel did not bind.");
  try {
    const result = await runSupervisorToExit(
      projectRoot,
      publicHome,
      address.port,
      controlled.controlRoot,
      true,
    );
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
