import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import type { CapturedProviderDocuments } from "./native-work-provider";
import {
  decodeMattProviderConfiguration,
  type MattProviderConfiguration,
  providerConfigurationFor,
} from "./provider-configuration";
import { validateMattSkillsV1Contract } from "./providers/matt-skills-v1";
import type {
  MattSkillsV1Provider,
  MattSkillsV1ProviderObservation,
  MattSkillsV1WorkBinding,
} from "./providers/matt-skills-v1/capture";
import { createGitHubMattProvider } from "./providers/matt-skills-v1/github";
import {
  decodeGitHubMattNativeScope,
  githubMattNativeScopeIdentity,
} from "./providers/matt-skills-v1/github-native-scope";
import { createLocalMarkdownMattProvider } from "./providers/matt-skills-v1/local-markdown";
import type { SyncInputGeneration } from "./sync-input-generation";
import type { StructuralDiagnostic } from "./types";

export type ProviderObservationAcquisition = Readonly<{
  observations: readonly MattSkillsV1ProviderObservation[];
  diagnostics: readonly StructuralDiagnostic[];
  acquisitionCount: number;
}>;

export type MattProviderFactoryInput = Readonly<{
  driver: "local-markdown" | "github-issues";
  configuration: MattProviderConfiguration;
  repoRoot: string;
  capturedDocuments: CapturedProviderDocuments;
}>;

export type MattProviderFactory = (input: MattProviderFactoryInput) => MattSkillsV1Provider;
export type ProviderBindingConflict = Readonly<{
  binding: MattSkillsV1WorkBinding;
  effortIds: readonly string[];
  diagnostic: StructuralDiagnostic;
}>;

export const defaultMattProviderFactory: MattProviderFactory = (input) =>
  input.driver === "local-markdown"
    ? createLocalMarkdownMattProvider({
        repoRoot: input.repoRoot,
        contractLocator: input.configuration.contractLocator,
        capturedDocuments: input.capturedDocuments,
      })
    : createGitHubMattProvider({
        repoRoot: input.repoRoot,
        contractLocator: input.configuration.contractLocator,
        capturedDocuments: input.capturedDocuments,
      });

const diagnostic = (code: string, target: string, message: string): StructuralDiagnostic => ({
  code,
  impact: "blocking",
  target,
  message,
});

const parseConfiguration = (
  generation: SyncInputGeneration,
): Readonly<
  | { configuration: MattProviderConfiguration; diagnostics: readonly StructuralDiagnostic[] }
  | { configuration?: never; diagnostics: readonly StructuralDiagnostic[] }
> => {
  const record = generation.records.find(
    (candidate) => candidate.locator === ".bearing/provider.json",
  );
  if (record === undefined) {
    return {
      diagnostics: [
        diagnostic(
          "missing-provider-configuration",
          ".bearing/provider.json",
          "Bearing Provider Configuration is unavailable.",
        ),
      ],
    };
  }
  try {
    const parsed = decodeMattProviderConfiguration(record.source);
    if (parsed === undefined) throw new TypeError("Invalid Provider Configuration.");
    return { configuration: providerConfigurationFor(parsed), diagnostics: [] };
  } catch {
    return {
      diagnostics: [
        diagnostic(
          "invalid-provider-configuration",
          ".bearing/provider.json",
          "Bearing Provider Configuration does not match its package-owned schema.",
        ),
      ],
    };
  }
};

export type MattProviderResolution =
  | Readonly<{
      state: "available";
      provider: MattSkillsV1Provider;
      configuration: MattProviderConfiguration;
    }>
  | Readonly<{
      state: "unavailable";
      diagnostics: readonly StructuralDiagnostic[];
    }>;

export const resolveMattProvider = (
  generation: SyncInputGeneration,
  providerFactory: MattProviderFactory = defaultMattProviderFactory,
): MattProviderResolution => {
  const parsed = parseConfiguration(generation);
  if (parsed.configuration === undefined) {
    return { state: "unavailable", diagnostics: parsed.diagnostics };
  }
  const contract = generation.records.find(
    (record) => record.locator === parsed.configuration.contractLocator,
  );
  const validation =
    contract === undefined
      ? { state: "unsupported" as const }
      : validateMattSkillsV1Contract(contract.source);
  if (validation.state !== "supported") {
    return {
      state: "unavailable",
      diagnostics: [
        diagnostic(
          "unsupported-provider-contract",
          parsed.configuration.contractLocator,
          "Confirmed Matt provider contract is unavailable or unsupported.",
        ),
      ],
    };
  }
  const capturedDocuments = new Map(
    generation.records.map((record) => [record.locator, record] as const),
  );
  return {
    state: "available",
    configuration: parsed.configuration,
    provider: providerFactory({
      driver: validation.driver,
      configuration: parsed.configuration,
      repoRoot: generation.root,
      capturedDocuments,
    }),
  };
};

const providerBindingEntries = (
  decoded: DecodedBearingRecordGeneration,
): ReadonlyMap<
  string,
  Readonly<{ binding: MattSkillsV1WorkBinding; effortIds: readonly string[] }>
> => {
  const bindings = new Map<string, { binding: MattSkillsV1WorkBinding; effortIds: string[] }>();
  for (const record of decoded.records) {
    const data = record.data;
    if (data?.Type !== "effort" || data["Work binding"] === undefined) continue;
    const binding: MattSkillsV1WorkBinding = {
      provider: data["Work binding"].Provider,
      nativeScope: data["Work binding"]["Native scope"],
    };
    const githubScope = decodeGitHubMattNativeScope(binding.nativeScope);
    const nativeIdentity =
      githubScope === undefined ? binding.nativeScope : githubMattNativeScopeIdentity(githubScope);
    const key = `${binding.provider}\0${nativeIdentity}`;
    const entry = bindings.get(key) ?? { binding, effortIds: [] };
    if (
      Buffer.compare(
        Buffer.from(binding.nativeScope, "utf8"),
        Buffer.from(entry.binding.nativeScope, "utf8"),
      ) < 0
    ) {
      entry.binding = binding;
    }
    entry.effortIds.push(data.ID);
    bindings.set(key, entry);
  }
  return new Map(
    [...bindings.entries()].map(([key, entry]) => [
      key,
      {
        binding: entry.binding,
        effortIds: [...entry.effortIds].sort((left, right) =>
          Buffer.compare(Buffer.from(left), Buffer.from(right)),
        ),
      },
    ]),
  );
};

export const boundProviderScopes = (
  decoded: DecodedBearingRecordGeneration,
): readonly MattSkillsV1WorkBinding[] =>
  [...providerBindingEntries(decoded).values()]
    .map((entry) => entry.binding)
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left.nativeScope), Buffer.from(right.nativeScope)),
    );

export const providerBindingConflicts = (
  decoded: DecodedBearingRecordGeneration,
): readonly ProviderBindingConflict[] =>
  [...providerBindingEntries(decoded).values()]
    .filter((entry) => entry.effortIds.length > 1)
    .map((entry) => ({
      binding: entry.binding,
      effortIds: entry.effortIds,
      diagnostic: diagnostic(
        "provider-binding-conflict",
        entry.binding.nativeScope,
        `Provider-native scope is bound to multiple Efforts (${entry.effortIds.join(
          ", ",
        )}); completion and readiness are unavailable until an explicit rebind resolves the conflict.`,
      ),
    }))
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left.binding.nativeScope), Buffer.from(right.binding.nativeScope)),
    );

export const acquireProviderObservations = async (
  generation: SyncInputGeneration,
  decoded: DecodedBearingRecordGeneration,
  providerFactory: MattProviderFactory = defaultMattProviderFactory,
): Promise<ProviderObservationAcquisition> => {
  const bindings = boundProviderScopes(decoded);
  if (bindings.length === 0) {
    return { observations: [], diagnostics: [], acquisitionCount: 0 };
  }
  const resolution = resolveMattProvider(generation, providerFactory);
  if (resolution.state === "unavailable") {
    return {
      observations: [],
      diagnostics: resolution.diagnostics,
      acquisitionCount: 0,
    };
  }
  const observations: MattSkillsV1ProviderObservation[] = [];
  for (const binding of bindings) {
    observations.push(await resolution.provider.capture(binding));
  }
  return {
    observations,
    diagnostics: observations.flatMap((observation) =>
      observation.diagnostics.map((item) => ({
        code: item.code,
        impact: item.impact,
        target: item.target,
        message: item.message,
      })),
    ),
    acquisitionCount: observations.length,
  };
};
