import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL =
  "com.lagrangee.bearing.development-portal";

export const developmentPortalLaunchAgentPaths = (homeDir) => ({
  launchAgentsDirectory: join(homeDir, "Library", "LaunchAgents"),
  logDirectory: join(homeDir, "Library", "Logs", "Bearing"),
  plistPath: join(
    homeDir,
    "Library",
    "LaunchAgents",
    `${DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL}.plist`,
  ),
});

export const developmentPortalLaunchAgentDefinition = ({
  homeDir,
  nodeExecutable,
  repositoryRoot,
}) => {
  const paths = developmentPortalLaunchAgentPaths(homeDir);
  return {
    Label: DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL,
    ProgramArguments: [
      nodeExecutable,
      join(repositoryRoot, "dist", "cli.js"),
      "development",
      "portal",
      "--repo",
      repositoryRoot,
    ],
    WorkingDirectory: repositoryRoot,
    EnvironmentVariables: { HOME: homeDir },
    RunAtLoad: true,
    KeepAlive: true,
    ProcessType: "Background",
    ThrottleInterval: 10,
    StandardOutPath: join(paths.logDirectory, "development-portal.log"),
    StandardErrorPath: join(paths.logDirectory, "development-portal.error.log"),
  };
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const launchctl = (args) =>
  spawnSync("/bin/launchctl", args, {
    encoding: "utf8",
  });

const requireSuccess = (result, operation) => {
  if (result.status === 0) return result;
  const detail = (
    result.stderr ||
    result.stdout ||
    result.error?.message ||
    "unknown error"
  ).trim();
  throw new Error(`${operation} failed: ${detail}`);
};

const developmentRuntimeReceipt = ({ nodeExecutable, repositoryRoot }) => {
  const result = requireSuccess(
    spawnSync(
      nodeExecutable,
      [
        join(repositoryRoot, "dist", "cli.js"),
        "runtime",
        "inspect",
        "--repo",
        repositoryRoot,
      ],
      { encoding: "utf8" },
    ),
    "Development Runtime inspect",
  );
  let body;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    throw new Error("Development Runtime inspect returned invalid JSON.");
  }
  const receipt = body?.outcome === "resolved" ? body.context?.receipt : undefined;
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.channel !== "development" ||
    typeof receipt.runtimeIdentity !== "string" ||
    typeof receipt.stateRootIdentity !== "string" ||
    typeof receipt.portalBuildId !== "string"
  ) {
    throw new Error("Development Runtime inspect did not return a coherent receipt.");
  }
  return receipt;
};

const expectedDevelopmentPortalHealth = (receipt) => ({
  schemaVersion: receipt.schemaVersion,
  channel: receipt.channel,
  runtimeIdentity: receipt.runtimeIdentity,
  stateRootIdentity: receipt.stateRootIdentity,
  portalBuildIdentity: receipt.portalBuildId,
});

export const isExpectedDevelopmentPortalHealth = (health, expected) =>
  health?.state === "ready" &&
  health.development?.schemaVersion === expected.schemaVersion &&
  health.development.channel === expected.channel &&
  health.development.runtimeIdentity === expected.runtimeIdentity &&
  health.development.stateRootIdentity === expected.stateRootIdentity &&
  health.development.portalBuildIdentity === expected.portalBuildIdentity;

const assertSupportedHost = () => {
  if (platform() !== "darwin") {
    throw new Error("The Development Portal LaunchAgent is supported only on macOS.");
  }
  if (typeof process.getuid !== "function") {
    throw new Error("The current macOS user identity is unavailable.");
  }
};

const currentUserInputs = () => {
  assertSupportedHost();
  return {
    homeDir: homedir(),
    uid: process.getuid(),
  };
};

const installInputs = async () => {
  const userInputs = currentUserInputs();
  const repositoryRoot = await realpath(projectRoot);
  const nodeExecutable = await realpath(process.execPath);
  await access(join(repositoryRoot, "dist", "cli.js"));
  return {
    ...userInputs,
    nodeExecutable,
    repositoryRoot,
    expectedHealth: expectedDevelopmentPortalHealth(
      developmentRuntimeReceipt({ nodeExecutable, repositoryRoot }),
    ),
  };
};

const serviceTarget = (uid) =>
  `gui/${uid}/${DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL}`;

const domainTarget = (uid) => `gui/${uid}`;

const isLoaded = (uid) => launchctl(["print", serviceTarget(uid)]).status === 0;

const bootoutIfLoaded = (uid) => {
  if (!isLoaded(uid)) return;
  requireSuccess(
    launchctl(["bootout", serviceTarget(uid)]),
    "Development Portal LaunchAgent bootout",
  );
};

const writeLaunchAgent = async (definition, plistPath) => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "bearing-development-portal-launch-agent-"),
  );
  const jsonPath = join(temporaryRoot, "launch-agent.json");
  const generatedPath = join(
    dirname(plistPath),
    `.${DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL}.plist`,
  );
  try {
    await writeFile(jsonPath, `${JSON.stringify(definition, null, 2)}\n`);
    requireSuccess(
      spawnSync(
        "/usr/bin/plutil",
        ["-convert", "xml1", "-o", generatedPath, jsonPath],
        { encoding: "utf8" },
      ),
      "LaunchAgent plist generation",
    );
    requireSuccess(
      spawnSync("/usr/bin/plutil", ["-lint", generatedPath], {
        encoding: "utf8",
      }),
      "LaunchAgent plist validation",
    );
    await rename(generatedPath, plistPath);
  } finally {
    await rm(generatedPath, { force: true });
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

const waitForDevelopmentPortal = async (expectedHealth) => {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:4188/healthz", {
        signal: AbortSignal.timeout(1_000),
      });
      const body = await response.json();
      if (response.ok && isExpectedDevelopmentPortalHealth(body, expectedHealth)) return body;
      lastError = new Error(
        response.ok
          ? "Development Portal health does not match the current Runtime receipt."
          : `Unexpected health response: ${response.status}`,
      );
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(
    `Development Portal did not become healthy on 4188: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
};

const install = async () => {
  const inputs = await installInputs();
  const paths = developmentPortalLaunchAgentPaths(inputs.homeDir);
  await Promise.all([
    mkdir(paths.launchAgentsDirectory, { recursive: true }),
    mkdir(paths.logDirectory, { recursive: true }),
  ]);
  await writeLaunchAgent(developmentPortalLaunchAgentDefinition(inputs), paths.plistPath);
  bootoutIfLoaded(inputs.uid);
  requireSuccess(
    launchctl(["bootstrap", domainTarget(inputs.uid), paths.plistPath]),
    "Development Portal LaunchAgent bootstrap",
  );
  requireSuccess(
    launchctl(["enable", serviceTarget(inputs.uid)]),
    "Development Portal LaunchAgent enable",
  );
  requireSuccess(
    launchctl(["kickstart", "-k", serviceTarget(inputs.uid)]),
    "Development Portal LaunchAgent kickstart",
  );
  const health = await waitForDevelopmentPortal(inputs.expectedHealth);
  process.stdout.write(
    `${JSON.stringify(
      {
        outcome: "installed",
        label: DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL,
        plistPath: paths.plistPath,
        health,
      },
      null,
      2,
    )}\n`,
  );
};

const status = async () => {
  const inputs = currentUserInputs();
  const result = launchctl(["print", serviceTarget(inputs.uid)]);
  if (result.status !== 0) {
    process.stdout.write(
      `${JSON.stringify(
        { outcome: "not-loaded", label: DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
    return;
  }
  let health = null;
  try {
    const runtimeInputs = await installInputs();
    health = await waitForDevelopmentPortal(runtimeInputs.expectedHealth);
  } catch {
    // launchctl state remains useful when the child has not reached health.
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        outcome: health === null ? "loaded-unhealthy" : "current",
        label: DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL,
        health,
        launchctl: result.stdout.trim(),
      },
      null,
      2,
    )}\n`,
  );
  if (health === null) process.exitCode = 1;
};

const uninstall = async () => {
  const inputs = currentUserInputs();
  const paths = developmentPortalLaunchAgentPaths(inputs.homeDir);
  bootoutIfLoaded(inputs.uid);
  await unlink(paths.plistPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  process.stdout.write(
    `${JSON.stringify(
      { outcome: "uninstalled", label: DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL },
      null,
      2,
    )}\n`,
  );
};

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const command = process.argv[2];
  if (command === "install") await install();
  else if (command === "status") await status();
  else if (command === "uninstall") await uninstall();
  else {
    process.stderr.write(
      "Usage: node scripts/development-portal-launch-agent.mjs <install|status|uninstall>\n",
    );
    process.exitCode = 1;
  }
}
