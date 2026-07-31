import { execFile } from "node:child_process";
import { posix } from "node:path";
import { promisify } from "node:util";
import {
  createNativeScopeDiscoveryObservation,
  NATIVE_SCOPE_DISCOVERY_PROVIDER,
  type NativeScopeDiscoveryProvider,
} from "./native-scope-discovery";
import {
  decodeMattProviderConfiguration,
  providerConfigurationFor,
} from "./provider-configuration";
import { validateMattSkillsV1Contract } from "./providers/matt-skills-v1";
import {
  discoverGitHubMattScopes,
  discoverLocalMattScopes,
} from "./providers/matt-skills-v1/discovery";
import {
  createGhCliGitHubReadTransport,
  externalPullRequestsEnabled,
  parseTriageVocabulary,
} from "./providers/matt-skills-v1/github";
import type { SyncInputGeneration } from "./sync-input-generation";

const executeFile = promisify(execFile);

const unsupported = (target: string, message: string) =>
  createNativeScopeDiscoveryObservation({
    provider: NATIVE_SCOPE_DISCOVERY_PROVIDER,
    state: "unsupported",
    freshness: "undetermined",
    coverage: "incomplete",
    scopes: [],
    diagnostics: [
      {
        code: "matt.discovery.unsupported",
        class: "contract",
        impact: "blocking",
        target,
        message,
      },
    ],
  });

const repositoryFor = async (repoRoot: string): Promise<string | undefined> => {
  try {
    const environment = { ...process.env };
    delete environment["GH_REPO"];
    delete environment["GH_HOST"];
    const result = await executeFile(
      "gh",
      [
        "repo",
        "view",
        "--json",
        "nameWithOwner,url",
        "--jq",
        'select(.url | startswith("https://github.com/")) | .nameWithOwner',
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: environment,
        timeout: 5_000,
      },
    );
    const coordinate = result.stdout.trim();
    return coordinate.length === 0 ? undefined : coordinate;
  } catch {
    return undefined;
  }
};

export type NativeScopeDiscoveryProviderFactory = (
  generation: SyncInputGeneration,
) => NativeScopeDiscoveryProvider;

export const defaultNativeScopeDiscoveryProvider: NativeScopeDiscoveryProviderFactory = (
  generation,
) => ({
  id: NATIVE_SCOPE_DISCOVERY_PROVIDER,
  async discover() {
    const providerRecord = generation.records.find(
      (record) => record.locator === ".bearing/provider.json",
    );
    if (providerRecord === undefined) {
      return unsupported(
        ".bearing/provider.json",
        "Bearing Provider Configuration is unavailable for Native Scope Discovery.",
      );
    }
    const decoded = decodeMattProviderConfiguration(providerRecord.source);
    if (decoded === undefined) {
      return unsupported(
        ".bearing/provider.json",
        "Bearing Provider Configuration cannot select a discovery driver.",
      );
    }
    const configuration = providerConfigurationFor(decoded);
    const contract = generation.records.find(
      (record) => record.locator === configuration.contractLocator,
    );
    if (contract === undefined) {
      return unsupported(
        configuration.contractLocator,
        "The confirmed Matt provider contract is unavailable for Native Scope Discovery.",
      );
    }
    const validation = validateMattSkillsV1Contract(contract.source);
    if (validation.state !== "supported") {
      return unsupported(
        configuration.contractLocator,
        "The confirmed Matt provider contract does not expose a supported discovery driver.",
      );
    }
    const triageLocator = posix.join(
      posix.dirname(configuration.contractLocator),
      "triage-labels.md",
    );
    if (validation.driver === "local-markdown") {
      return discoverLocalMattScopes({
        repoRoot: generation.root,
        contractLocator: configuration.contractLocator,
        triageLocator,
      });
    }
    const repository = await repositoryFor(generation.root);
    if (repository === undefined) {
      return unsupported(
        configuration.contractLocator,
        "The confirmed GitHub contract has no same-checkout github.com origin identity.",
      );
    }
    const triage = generation.records.find((record) => record.locator === triageLocator);
    if (triage === undefined) {
      return unsupported(
        triageLocator,
        "The confirmed GitHub triage vocabulary is unavailable for discovery admission.",
      );
    }
    const vocabularyDiagnostics: Parameters<typeof parseTriageVocabulary>[2] = [];
    const vocabulary = parseTriageVocabulary(triage.source, triageLocator, vocabularyDiagnostics);
    if (vocabulary === undefined || !vocabulary.complete) {
      return createNativeScopeDiscoveryObservation({
        provider: NATIVE_SCOPE_DISCOVERY_PROVIDER,
        state: "invalid",
        freshness: "undetermined",
        coverage: "incomplete",
        scopes: [],
        diagnostics: vocabularyDiagnostics,
      });
    }
    return discoverGitHubMattScopes({
      repository,
      transport: createGhCliGitHubReadTransport(),
      mappedTriageLabels: [...vocabulary.semanticToNative.values()],
      pullRequests: externalPullRequestsEnabled(contract.source) ? "enabled" : "disabled",
    });
  },
});
