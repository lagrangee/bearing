import stableStringify from "safe-stable-stringify";
import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import { type FingerprintObservation, fingerprintInputRecords } from "./fingerprint";
import {
  type CapturedProviderDocuments,
  rebaseProviderScopeCaptureGeneration,
} from "./native-work-provider";
import {
  decodeMattProviderConfiguration,
  type MattProviderConfiguration,
  providerConfigurationFor,
} from "./provider-configuration";
import { validateMattSkillsV1Contract } from "./providers/matt-skills-v1";
import type {
  MattSkillsV1Provider,
  MattSkillsV1ScopeCapture,
  MattSkillsV1WorkBinding,
} from "./providers/matt-skills-v1/capture";
import { createGitHubMattProvider } from "./providers/matt-skills-v1/github";
import { createLocalMarkdownMattProvider } from "./providers/matt-skills-v1/local-markdown";
import type { SyncInputGeneration } from "./sync-input-generation";
import type { StructuralDiagnostic } from "./types";

export type ProviderCaptureGeneration = Readonly<{
  fingerprint: string;
  inputs: readonly string[];
  captures: readonly MattSkillsV1ScopeCapture[];
  diagnostics: readonly StructuralDiagnostic[];
  captureCount: number;
}>;

export type MattProviderFactoryInput = Readonly<{
  driver: "local-markdown" | "github-issues";
  configuration: MattProviderConfiguration;
  repoRoot: string;
  capturedDocuments: CapturedProviderDocuments;
}>;

export type MattProviderFactory = (input: MattProviderFactoryInput) => MattSkillsV1Provider;

const defaultProviderFactory: MattProviderFactory = (input) =>
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
    return {
      configuration: providerConfigurationFor(parsed),
      diagnostics: [],
    };
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

const boundScopes = (
  decoded: DecodedBearingRecordGeneration,
): readonly MattSkillsV1WorkBinding[] => {
  const bindings = new Map<string, MattSkillsV1WorkBinding>();
  for (const record of decoded.records) {
    const data = record.data;
    if (data?.Type !== "effort" || data["Work binding"] === undefined) continue;
    const binding: MattSkillsV1WorkBinding = {
      provider: data["Work binding"].Provider,
      nativeScope: data["Work binding"]["Native scope"],
    };
    bindings.set(`${binding.provider}\0${binding.nativeScope}`, binding);
  }
  return [...bindings.values()].sort((left, right) =>
    Buffer.compare(Buffer.from(left.nativeScope), Buffer.from(right.nativeScope)),
  );
};

const fingerprintCapture = (capture: MattSkillsV1ScopeCapture): string =>
  stableStringify(
    {
      provider: capture.provider,
      binding: capture.binding,
      state: capture.state,
      freshness: {
        assessment: capture.freshness.assessment,
        sourceRevision: capture.freshness.sourceRevision,
        evidence: capture.freshness.evidence,
      },
      coverage: capture.coverage,
      completion: capture.completion,
      diagnostics: capture.diagnostics,
      ...("projection" in capture ? { projection: capture.projection } : {}),
    },
    (key, value) => (key === "observedAt" ? undefined : value),
  ) ?? "";

export const captureProviderGeneration = async (
  generation: SyncInputGeneration,
  decoded: DecodedBearingRecordGeneration,
  providerFactory: MattProviderFactory = defaultProviderFactory,
): Promise<ProviderCaptureGeneration> => {
  const parsed = parseConfiguration(generation);
  if (parsed.configuration === undefined) {
    return {
      fingerprint: generation.fingerprint,
      inputs: generation.inputs,
      captures: [],
      diagnostics: parsed.diagnostics,
      captureCount: 0,
    };
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
      fingerprint: generation.fingerprint,
      inputs: generation.inputs,
      captures: [],
      diagnostics: [
        diagnostic(
          "unsupported-provider-contract",
          parsed.configuration.contractLocator,
          "Confirmed Matt provider contract is unavailable or unsupported.",
        ),
      ],
      captureCount: 0,
    };
  }
  const capturedDocuments = new Map(
    generation.records.map((record) => [record.locator, record] as const),
  );
  const provider = providerFactory({
    driver: validation.driver,
    configuration: parsed.configuration,
    repoRoot: generation.root,
    capturedDocuments,
  });
  const observedCaptures: MattSkillsV1ScopeCapture[] = [];
  for (const binding of boundScopes(decoded)) {
    observedCaptures.push(await provider.capture(binding, { fingerprint: generation.fingerprint }));
  }
  const observations: FingerprintObservation[] = observedCaptures.map((capture) => ({
    key: `provider-capture:${capture.provider}:${capture.binding.nativeScope}`,
    value: fingerprintCapture(capture),
  }));
  const final = fingerprintInputRecords(generation.records, [
    ...generation.observations,
    ...observations,
  ]);
  const captures = observedCaptures.map((capture) =>
    rebaseProviderScopeCaptureGeneration(capture, final.fingerprint),
  );
  return {
    fingerprint: final.fingerprint,
    inputs: final.inputs,
    captures,
    diagnostics: captures.flatMap((capture) =>
      capture.diagnostics.map((item) => ({
        code: item.code,
        impact: item.impact,
        target: item.target,
        message: item.message,
      })),
    ),
    captureCount: observedCaptures.length,
  };
};
