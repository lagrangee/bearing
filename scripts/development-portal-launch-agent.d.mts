export const DEVELOPMENT_PORTAL_LAUNCH_AGENT_LABEL: string;

export function developmentPortalLaunchAgentPaths(homeDir: string): Readonly<{
  launchAgentsDirectory: string;
  logDirectory: string;
  plistPath: string;
}>;

export function developmentPortalLaunchAgentDefinition(input: Readonly<{
  homeDir: string;
  nodeExecutable: string;
  repositoryRoot: string;
}>): Readonly<{
  Label: string;
  ProgramArguments: readonly string[];
  WorkingDirectory: string;
  EnvironmentVariables: Readonly<{ HOME: string }>;
  RunAtLoad: true;
  KeepAlive: true;
  ProcessType: "Background";
  ThrottleInterval: number;
  StandardOutPath: string;
  StandardErrorPath: string;
}>;

export function isExpectedDevelopmentPortalHealth(
  health: unknown,
  expected: Readonly<{
    schemaVersion: 1;
    channel: "development";
    runtimeIdentity: string;
    stateRootIdentity: string;
    portalBuildIdentity: string;
  }>,
): boolean;
