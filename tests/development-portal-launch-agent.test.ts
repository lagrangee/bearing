import { expect, test } from "bun:test";
import {
  DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL,
  developmentPortalLaunchAgentDefinition,
  developmentPortalLaunchAgentPaths,
  isExpectedDevelopmentPortalHealth,
} from "../scripts/development-portal-launch-agent.mjs";

test("the Development Portal LaunchAgent is source-only", () => {
  const definition = developmentPortalLaunchAgentDefinition({
    homeDir: "/Users/example",
    nodeExecutable: "/opt/node/bin/node",
    repositoryRoot: "/Users/example/Projects/bearing",
  });

  expect(DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL).toBe("com.lagrangee.bearing.development-portal");
  expect(definition).toMatchObject({
    Label: DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL,
    ProgramArguments: [
      "/opt/node/bin/node",
      "/Users/example/Projects/bearing/dist/cli.js",
      "development",
      "portal",
      "--repo",
      "/Users/example/Projects/bearing",
    ],
    WorkingDirectory: "/Users/example/Projects/bearing",
    EnvironmentVariables: { HOME: "/Users/example" },
    RunAtLoad: true,
    KeepAlive: true,
    ProcessType: "Background",
    ThrottleInterval: 10,
  });
  expect(JSON.stringify(definition)).not.toContain("4178");
  expect(JSON.stringify(definition)).not.toContain(".bearing/bin/bearing");
});

test("the Development Portal LaunchAgent uses user-owned paths", () => {
  expect(developmentPortalLaunchAgentPaths("/Users/example")).toEqual({
    launchAgentsDirectory: "/Users/example/Library/LaunchAgents",
    logDirectory: "/Users/example/Library/Logs/Bearing",
    plistPath: "/Users/example/Library/LaunchAgents/com.lagrangee.bearing.development-portal.plist",
  });
});

test("the Development Portal LaunchAgent rejects health from another runtime", () => {
  const expected = {
    schemaVersion: 1,
    channel: "development",
    runtimeIdentity: `sha256:${"1".repeat(64)}`,
    stateRootIdentity: `sha256:${"2".repeat(64)}`,
    portalBuildIdentity: "3".repeat(64),
  } as const;
  const health = {
    state: "ready",
    development: expected,
  };

  expect(isExpectedDevelopmentPortalHealth(health, expected)).toBe(true);
  expect(
    isExpectedDevelopmentPortalHealth(
      {
        ...health,
        development: {
          ...expected,
          runtimeIdentity: `sha256:${"4".repeat(64)}`,
        },
      },
      expected,
    ),
  ).toBe(false);
  expect(
    isExpectedDevelopmentPortalHealth(
      {
        ...health,
        development: {
          ...expected,
          stateRootIdentity: `sha256:${"5".repeat(64)}`,
        },
      },
      expected,
    ),
  ).toBe(false);
  expect(
    isExpectedDevelopmentPortalHealth(
      {
        ...health,
        development: {
          ...expected,
          portalBuildIdentity: "6".repeat(64),
        },
      },
      expected,
    ),
  ).toBe(false);
});
