import type { z } from "zod";
import type {
  ArtifactAnalysis,
  AssetAvailability,
  BearingNode,
  CanonicalReference,
} from "./artifact-model";
import { expectedBearingType } from "./artifact-model";
import { type ParsedAsset, parseAssetRegistry } from "./asset-records";
import { type PlanningAuditBodyResult, parsePlanningAuditBody } from "./audit-body";
import { analyzeDecodedBearingArtifact } from "./bearing-record-analysis";
import { parseExactSections, parsePlainText, parseUnorderedList } from "./bearing-record-sections";
import { parseMarkdownEnvelope } from "./markdown-document";
import type { SourceBinding, SourceRecord } from "./project-snapshot/contract";
import { createSourceRecord } from "./project-snapshot/source-records";
import { mattNativeScopeKey } from "./providers/matt-skills-v1/native-subject";
import { bearingSchema } from "./schema-definitions";
import type { SyncInputGeneration } from "./sync-input-generation";
import { deriveTopologyDiagnostics } from "./topology-diagnostics";
import type { StructuralDiagnostic } from "./types";

export type BearingArtifact = z.infer<typeof bearingSchema>;
export type BearingRecordType = BearingArtifact["Type"];

export type DecodedBearingRecordContent =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "sections"; values: Readonly<Record<string, string | readonly string[]>> }>
  | Readonly<{
      kind: "asset-registry";
      assets: readonly ParsedAsset[];
      invalidEntries: readonly Readonly<{ key: string; title: string }>[];
    }>
  | Readonly<{ kind: "planning-audit"; result: PlanningAuditBodyResult }>;

type DecodedRecordBase = Readonly<{
  locator: string;
  type: BearingRecordType;
  source: SourceRecord;
  diagnostics: readonly StructuralDiagnostic[];
  analysis: ArtifactAnalysis;
  content: DecodedBearingRecordContent;
  data?: BearingArtifact;
  displayTitle: string;
}>;

export type DecodedBearingRecord =
  | (DecodedRecordBase & Readonly<{ trust: "available" }>)
  | (DecodedRecordBase & Readonly<{ trust: "partial" }>)
  | (DecodedRecordBase & Readonly<{ trust: "invalid" }>);

export type BearingRecordDecoderMetrics = Readonly<{
  capturedInputCount: number;
  bearingRecordCount: number;
  decodeCount: number;
}>;

export type DecodedBearingRecordGeneration = Readonly<{
  fingerprint: string;
  records: readonly DecodedBearingRecord[];
  diagnostics: readonly StructuralDiagnostic[];
  metrics: BearingRecordDecoderMetrics;
}>;

const emptyAnalysis = (diagnostics: readonly StructuralDiagnostic[]): ArtifactAnalysis => ({
  nodes: [],
  references: [],
  planningCitations: [],
  authorityBaselines: [],
  assetAvailability: [],
  roadmaps: [],
  gates: [],
  efforts: [],
  diagnostics,
});

const DEFAULT_DISPLAY_TITLE: Readonly<Record<BearingRecordType, string>> = {
  "project-summary": "Project Summary",
  "project-brief": "Project Brief",
  "roadmap-index": "Roadmap Index",
  roadmap: "Roadmap",
  "milestone-gate": "Milestone Gate",
  effort: "Effort",
  authority: "Authority",
  "asset-registry": "Asset Registry",
  "planning-review": "Planning Review",
  "planning-audit": "Audit",
};

const displayTitleFor = (type: BearingRecordType, value: unknown): string => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_DISPLAY_TITLE[type];
  }
  const title = Reflect.get(value, "Title");
  return typeof title === "string" && parsePlainText(title) !== undefined
    ? title
    : DEFAULT_DISPLAY_TITLE[type];
};

const normalizeCitations = (citations: readonly { Asset: string; Note: string }[] | undefined) =>
  citations?.map((citation) => ({ Asset: citation.Asset, Note: citation.Note }));

const normalizeResolution = (
  resolution:
    | Readonly<{
        "Accepted decision": string;
        "Accepted at"?: string | null | undefined;
        Rationale: string;
        "Changed references": readonly string[];
      }>
    | undefined,
) =>
  resolution === undefined
    ? undefined
    : {
        "Accepted decision": resolution["Accepted decision"],
        ...(resolution["Accepted at"] === undefined
          ? {}
          : { "Accepted at": resolution["Accepted at"] }),
        Rationale: resolution.Rationale,
        "Changed references": [...resolution["Changed references"]],
      };

const normalizeAsset = (asset: ParsedAsset): ParsedAsset => ({
  ID: asset.ID,
  Title: asset.Title,
  Kind: asset.Kind,
  Location: asset.Location,
  Owner: asset.Owner,
  Producer: {
    Kind: asset.Producer.Kind,
    Name: asset.Producer.Name,
    ...(asset.Producer.Reference === undefined ? {} : { Reference: asset.Producer.Reference }),
  },
  "Lifecycle source": asset["Lifecycle source"],
  ...(asset.Disposition === undefined ? {} : { Disposition: asset.Disposition }),
  ...(asset["Superseded by"] === undefined ? {} : { "Superseded by": asset["Superseded by"] }),
  ...(asset["Produced for"] === undefined ? {} : { "Produced for": asset["Produced for"] }),
  ...(asset["Registered at"] === undefined ? {} : { "Registered at": asset["Registered at"] }),
  ...(asset["Produced at"] === undefined ? {} : { "Produced at": asset["Produced at"] }),
  ...(asset["Superseded at"] === undefined ? {} : { "Superseded at": asset["Superseded at"] }),
  ...(asset["Archived at"] === undefined ? {} : { "Archived at": asset["Archived at"] }),
});

const normalizeBearingArtifact = (data: BearingArtifact): BearingArtifact => {
  switch (data.Type) {
    case "project-summary":
      return {
        Type: data.Type,
        ID: data.ID,
        Title: data.Title,
        ...(data["Updated at"] === undefined ? {} : { "Updated at": data["Updated at"] }),
        ...(data.Languages === undefined
          ? {}
          : {
              Languages: {
                ...(data.Languages.Purpose === undefined
                  ? {}
                  : { Purpose: data.Languages.Purpose }),
                ...(data.Languages["Current Design"] === undefined
                  ? {}
                  : { "Current Design": data.Languages["Current Design"] }),
              },
            }),
      };
    case "project-brief":
      return {
        Type: data.Type,
        ID: data.ID,
        "Generated at": data["Generated at"],
        ...(data.Languages === undefined
          ? {}
          : {
              Languages: {
                ...(data.Languages["Project Purpose"] === undefined
                  ? {}
                  : { "Project Purpose": data.Languages["Project Purpose"] }),
                ...(data.Languages["Current Stage"] === undefined
                  ? {}
                  : { "Current Stage": data.Languages["Current Stage"] }),
                ...(data.Languages["Material Achieved State"] === undefined
                  ? {}
                  : { "Material Achieved State": data.Languages["Material Achieved State"] }),
              },
            }),
      };
    case "roadmap-index":
      return { Type: data.Type, Roadmaps: [...data.Roadmaps] };
    case "roadmap":
      return {
        Type: data.Type,
        ID: data.ID,
        Title: data.Title,
        Status: data.Status,
        "Focused gate": data["Focused gate"],
        "Gate order": [...data["Gate order"]],
        ...(data["Started at"] === undefined ? {} : { "Started at": data["Started at"] }),
        ...(data["Completed at"] === undefined ? {} : { "Completed at": data["Completed at"] }),
        ...(data["Superseded at"] === undefined ? {} : { "Superseded at": data["Superseded at"] }),
        ...(data.Citations === undefined ? {} : { Citations: normalizeCitations(data.Citations) }),
      };
    case "milestone-gate":
      return {
        Type: data.Type,
        ID: data.ID,
        Title: data.Title,
        Roadmap: data.Roadmap,
        Status: data.Status,
        "Effort order": [...data["Effort order"]],
        ...(data["Planned at"] === undefined ? {} : { "Planned at": data["Planned at"] }),
        ...(data["Activated at"] === undefined ? {} : { "Activated at": data["Activated at"] }),
        ...(data["Superseded at"] === undefined ? {} : { "Superseded at": data["Superseded at"] }),
        ...(data.Passage === undefined
          ? {}
          : {
              Passage: {
                "Accepted decision": data.Passage["Accepted decision"],
                ...(data.Passage["Accepted at"] === undefined
                  ? {}
                  : { "Accepted at": data.Passage["Accepted at"] }),
                Rationale: data.Passage.Rationale,
                Evidence: [...data.Passage.Evidence],
                Exceptions: [...data.Passage.Exceptions],
              },
            }),
        ...(data.Citations === undefined ? {} : { Citations: normalizeCitations(data.Citations) }),
      };
    case "effort":
      return {
        Type: data.Type,
        ID: data.ID,
        Title: data.Title,
        Roadmap: data.Roadmap,
        "Target gate": data["Target gate"],
        Authorities: [...data.Authorities],
        Citations: normalizeCitations(data.Citations) ?? [],
        Lifecycle: data.Lifecycle,
        "Planned at": data["Planned at"],
        ...(data["Activated at"] === undefined ? {} : { "Activated at": data["Activated at"] }),
        ...(data.Conclusion === undefined
          ? {}
          : {
              Conclusion: {
                Disposition: data.Conclusion.Disposition,
                Rationale: data.Conclusion.Rationale,
                "Concluded at": data.Conclusion["Concluded at"],
                ...(data.Conclusion["Replacement effort"] === undefined
                  ? {}
                  : { "Replacement effort": data.Conclusion["Replacement effort"] }),
              },
            }),
        ...(data["Work binding"] === undefined
          ? {}
          : {
              "Work binding": {
                Provider: data["Work binding"].Provider,
                "Native scope": data["Work binding"]["Native scope"],
              },
            }),
      };
    case "authority":
      return {
        Type: data.Type,
        ID: data.ID,
        Title: data.Title,
        Baseline: [...data.Baseline],
        ...(data.Adoptions === undefined
          ? {}
          : {
              Adoptions: data.Adoptions.map((adoption) => ({
                Asset: adoption.Asset,
                Decision: adoption.Decision,
              })),
            }),
        ...(data.Citations === undefined ? {} : { Citations: normalizeCitations(data.Citations) }),
      };
    case "asset-registry":
      return { Type: data.Type, Assets: data.Assets.map(normalizeAsset) };
    case "planning-review":
      return {
        Type: data.Type,
        ID: data.ID,
        Title: data.Title,
        Status: data.Status,
        Question: data.Question,
        Scope: data.Scope,
        ...(data.Target === undefined ? {} : { Target: data.Target }),
        Inputs: [...data.Inputs],
        "Input fingerprint": data["Input fingerprint"],
        ...(data.Resolution === undefined
          ? {}
          : { Resolution: normalizeResolution(data.Resolution) }),
        ...(data.Citations === undefined ? {} : { Citations: normalizeCitations(data.Citations) }),
      };
    case "planning-audit":
      return {
        Type: data.Type,
        ID: data.ID,
        ...(data.Title === undefined ? {} : { Title: data.Title }),
        "Generated at": data["Generated at"],
        Inputs: [...data.Inputs],
        "Input fingerprint": data["Input fingerprint"],
        Coverage: data.Coverage,
        "Skipped targets": [...data["Skipped targets"]],
      };
  }
};

const invalidFrontmatter = (
  locator: string,
  reason: "malformed" | "missing",
): StructuralDiagnostic => ({
  code: reason === "malformed" ? "malformed-bearing-yaml" : "missing-bearing-frontmatter",
  impact: "blocking",
  target: locator,
  message:
    reason === "malformed"
      ? "Bearing frontmatter is not valid YAML."
      : "Bearing Record has no YAML frontmatter.",
});

const bodyDiagnostic = (locator: string, message: string): StructuralDiagnostic => ({
  code: "invalid-bearing-record-body",
  impact: "blocking",
  target: locator,
  message,
});

const EFFORT_WORK_BINDING_DIAGNOSTIC_CODES = new Set([
  "effort-work-binding-missing",
  "effort-work-binding-unparseable",
]);

const effortWorkBindingDiagnostic = (
  locator: string,
  reason: "missing" | "unparseable",
): StructuralDiagnostic => ({
  code: `effort-work-binding-${reason}`,
  impact: "blocking",
  target: locator,
  message:
    reason === "missing"
      ? "Canonical Effort requires exactly one Work Binding."
      : "Canonical Effort Work Binding does not match the supported provider contract.",
});

const exactSections = (
  locator: string,
  body: string,
  required: readonly string[],
): Readonly<{
  sections?: Readonly<Record<string, string>>;
  diagnostics: readonly StructuralDiagnostic[];
}> => {
  const parsed = parseExactSections(body, required);
  if (parsed.ok) return { sections: parsed.sections, diagnostics: [] };
  return parsed.reason === "missing"
    ? {
        diagnostics: parsed.titles.map((title) => ({
          code: "missing-required-section",
          impact: "blocking" as const,
          target: locator,
          message: `Bearing artifact is missing ## ${title}.`,
        })),
      }
    : {
        diagnostics: [
          bodyDiagnostic(locator, "Bearing Record required sections must appear exactly once."),
        ],
      };
};

const decodePlainSections = (
  locator: string,
  body: string,
  plain: readonly string[],
  lists: readonly string[] = [],
  presenceOnly: readonly string[] = [],
): Readonly<{
  content: DecodedBearingRecordContent;
  diagnostics: readonly StructuralDiagnostic[];
}> => {
  const required = [...plain, ...lists, ...presenceOnly];
  const exact = exactSections(locator, body, required);
  if (exact.sections === undefined)
    return { content: { kind: "none" }, diagnostics: exact.diagnostics };
  const values: Record<string, string | readonly string[]> = {};
  for (const title of plain) {
    const value = parsePlainText(exact.sections[title] ?? "");
    if (value === undefined) {
      return {
        content: { kind: "none" },
        diagnostics: [
          bodyDiagnostic(locator, "Bearing Record prose must be normalized plain text."),
        ],
      };
    }
    values[title] = value;
  }
  for (const title of lists) {
    const value = parseUnorderedList(exact.sections[title] ?? "");
    if (value === undefined) {
      return {
        content: { kind: "none" },
        diagnostics: [
          bodyDiagnostic(locator, "Bearing Record list sections must use the exact list grammar."),
        ],
      };
    }
    values[title] = value;
  }
  return { content: { kind: "sections", values }, diagnostics: exact.diagnostics };
};

const decodeContent = (
  locator: string,
  type: BearingRecordType,
  value: unknown,
  body: string,
): Readonly<{
  content: DecodedBearingRecordContent;
  diagnostics: readonly StructuralDiagnostic[];
}> => {
  switch (type) {
    case "project-summary":
      return decodePlainSections(
        locator,
        body,
        ["Purpose", "Current Design"],
        ["Boundaries", "Future Candidates", "Material Revisions"],
      );
    case "project-brief":
      return decodePlainSections(locator, body, [
        "Project Purpose",
        "Current Stage",
        "Material Achieved State",
      ]);
    case "roadmap":
      return decodePlainSections(locator, body, ["Intent"]);
    case "milestone-gate":
      return decodePlainSections(locator, body, ["Intent"], ["Exit Criteria"]);
    case "effort":
      return decodePlainSections(locator, body, ["Intent"], [], ["Work"]);
    case "authority":
      return decodePlainSections(locator, body, ["Scope", "Current Baseline"]);
    case "asset-registry": {
      const registry = parseAssetRegistry(value);
      if (!registry.ok) return { content: { kind: "none" }, diagnostics: [] };
      return {
        content: {
          kind: "asset-registry",
          assets: registry.entries.flatMap((entry) =>
            entry.data === undefined ? [] : [normalizeAsset(entry.data)],
          ),
          invalidEntries: registry.entries.flatMap((entry) =>
            entry.data === undefined ? [{ key: entry.key, title: entry.title }] : [],
          ),
        },
        diagnostics: [],
      };
    }
    case "planning-audit": {
      const result = parsePlanningAuditBody(body);
      return {
        content: { kind: "planning-audit", result },
        diagnostics: result.ok
          ? result.value.invalidFindings.map(({ ordinal, fragment }) => ({
              code: "invalid-planning-audit-finding",
              impact: "non-blocking" as const,
              target: `${locator}#${fragment}`,
              message: `Planning Audit finding ${ordinal} does not match the exact finding structure.`,
            }))
          : [
              {
                code: "invalid-planning-audit-body",
                impact: "blocking",
                target: locator,
                message: "Planning Audit requires the exact Findings body structure.",
              },
            ],
      };
    }
    case "roadmap-index":
    case "planning-review":
      return { content: { kind: "none" }, diagnostics: [] };
  }
};

const sourceBinding = (data: BearingArtifact | undefined): SourceBinding | undefined => {
  if (data === undefined || data.Type === "asset-registry") {
    return undefined;
  }
  if (data.Type === "roadmap-index") {
    return { role: "roadmap-index", identity: "roadmap-index:current" };
  }
  return { role: data.Type, identity: data.ID };
};

const decodeRecord = (
  record: SyncInputGeneration["records"][number],
  fingerprint: string,
): DecodedBearingRecord | undefined => {
  const expectedType = expectedBearingType(record.locator) as BearingRecordType | undefined;
  if (expectedType === undefined) return undefined;
  const frontmatter = parseMarkdownEnvelope(record.source);
  if (!frontmatter.ok) {
    const diagnostic = invalidFrontmatter(record.locator, frontmatter.reason);
    return {
      locator: record.locator,
      type: expectedType,
      trust: "invalid",
      source: createSourceRecord(fingerprint, { kind: "canonical", locator: record.locator }),
      diagnostics: [diagnostic],
      analysis: emptyAnalysis([diagnostic]),
      content: { kind: "none" },
      displayTitle: DEFAULT_DISPLAY_TITLE[expectedType],
    };
  }
  const decodedContent = decodeContent(
    record.locator,
    expectedType,
    frontmatter.data,
    frontmatter.body,
  );
  const schemaDiagnostics: StructuralDiagnostic[] = [];
  let data: BearingArtifact | undefined;
  if (expectedType === "asset-registry") {
    if (decodedContent.content.kind === "asset-registry") {
      if (decodedContent.content.invalidEntries.length === 0) {
        data = {
          Type: "asset-registry",
          Assets: [...decodedContent.content.assets],
        };
      }
    } else {
      schemaDiagnostics.push({
        code: "invalid-bearing-schema",
        impact: "blocking",
        target: record.locator,
        message: "Bearing frontmatter does not match its minimum schema.",
      });
    }
  } else {
    const parsed = bearingSchema.safeParse(frontmatter.data);
    if (!parsed.success) {
      const withoutWorkBinding = { ...frontmatter.data };
      delete withoutWorkBinding["Work binding"];
      const effortFallback =
        expectedType === "effort" && frontmatter.data["Type"] === "effort"
          ? bearingSchema.safeParse(withoutWorkBinding)
          : undefined;
      if (effortFallback?.success === true && effortFallback.data.Type === "effort") {
        data = normalizeBearingArtifact(effortFallback.data);
        schemaDiagnostics.push(effortWorkBindingDiagnostic(record.locator, "unparseable"));
      } else {
        schemaDiagnostics.push({
          code: "invalid-bearing-schema",
          impact: "blocking",
          target: record.locator,
          message: "Bearing frontmatter does not match its minimum schema.",
        });
      }
    } else if (parsed.data.Type !== expectedType) {
      schemaDiagnostics.push({
        code: "unexpected-bearing-type",
        impact: "blocking",
        target: record.locator,
        message: `Expected Type: ${expectedType}.`,
      });
    } else {
      data = normalizeBearingArtifact(parsed.data);
      if (data.Type === "effort" && data["Work binding"] === undefined) {
        schemaDiagnostics.push(effortWorkBindingDiagnostic(record.locator, "missing"));
      }
    }
  }
  const analyzed = analyzeDecodedBearingArtifact(record.locator, data, decodedContent.content);
  const diagnostics = [
    ...schemaDiagnostics,
    ...analyzed.diagnostics,
    ...decodedContent.diagnostics,
  ];
  const hasFatalBlockingDiagnostic = diagnostics.some(
    (diagnostic) =>
      diagnostic.impact === "blocking" &&
      !EFFORT_WORK_BINDING_DIAGNOSTIC_CODES.has(diagnostic.code),
  );
  const analysis =
    expectedType !== "asset-registry" && hasFatalBlockingDiagnostic
      ? {
          ...analyzed,
          nodes: [],
          references: [],
          planningCitations: [],
          authorityBaselines: [],
          assetAvailability: [],
          roadmaps: [],
          gates: [],
          efforts: [],
          diagnostics,
        }
      : { ...analyzed, diagnostics };
  const assetContent =
    decodedContent.content.kind === "asset-registry" ? decodedContent.content : undefined;
  const partialAsset =
    assetContent !== undefined &&
    assetContent.assets.length > 0 &&
    assetContent.invalidEntries.length > 0;
  const blocking = hasFatalBlockingDiagnostic;
  const trust =
    partialAsset || (!blocking && diagnostics.length > 0)
      ? "partial"
      : blocking
        ? "invalid"
        : "available";
  const trustedAnalysis =
    trust === "invalid"
      ? {
          ...analysis,
          nodes: [],
          references: [],
          planningCitations: [],
          authorityBaselines: [],
          assetAvailability: [],
          roadmaps: [],
          gates: [],
          efforts: [],
        }
      : analysis;
  const binding = sourceBinding(data);
  const source = createSourceRecord(fingerprint, {
    kind: "canonical",
    locator: record.locator,
    ...(binding === undefined ? {} : { binding }),
  });
  return {
    locator: record.locator,
    type: expectedType,
    trust,
    source,
    diagnostics,
    analysis: trustedAnalysis,
    content: decodedContent.content,
    displayTitle: displayTitleFor(expectedType, frontmatter.data),
    ...(data === undefined ? {} : { data }),
  };
};

const compareText = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const groupBy = <T, K>(values: readonly T[], keyFor: (value: T) => K): Map<K, T[]> => {
  const grouped = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const entries = grouped.get(key) ?? [];
    entries.push(value);
    grouped.set(key, entries);
  }
  return grouped;
};

const duplicateIdentityDiagnostics = (nodes: readonly BearingNode[]): StructuralDiagnostic[] => {
  const byId = groupBy(nodes, (node) => node.id);
  return [...byId.entries()].flatMap(([id, declarations]) =>
    declarations.length < 2
      ? []
      : declarations.map((node) => ({
          code: "duplicate-stable-id",
          impact: "blocking" as const,
          target: node.locator,
          message: `Stable ID ${id} is declared by multiple Bearing Records.`,
        })),
  );
};

const IDENTITY_PRESERVING_BODY_DIAGNOSTICS = new Set([
  "missing-required-section",
  "invalid-bearing-record-body",
  "invalid-planning-audit-body",
  "invalid-next-work-body",
  "invalid-next-work-alternatives",
]);

const declaredNodes = (records: readonly DecodedBearingRecord[]): readonly BearingNode[] =>
  records.flatMap((record) => {
    if (record.content.kind === "asset-registry") {
      if (record.trust === "invalid") return [];
      return record.content.assets.map((asset) => ({ id: asset.ID, locator: record.locator }));
    }
    const data = record.data;
    if (data === undefined || data.Type === "roadmap-index" || data.Type === "asset-registry") {
      return [];
    }
    if (
      record.diagnostics.some(
        (diagnostic) =>
          diagnostic.impact === "blocking" &&
          !IDENTITY_PRESERVING_BODY_DIAGNOSTICS.has(diagnostic.code),
      )
    ) {
      return [];
    }
    return [{ id: data.ID, locator: record.locator }];
  });

const singletonDiagnostics = (records: readonly DecodedBearingRecord[]): StructuralDiagnostic[] => {
  const singletons = new Set<BearingRecordType>([
    "project-summary",
    "project-brief",
    "roadmap-index",
    "asset-registry",
    "planning-audit",
  ]);
  return [
    ...groupBy(
      records.filter((record) => singletons.has(record.type)),
      (record) => record.type,
    ),
  ].flatMap(([type, declarations]) =>
    declarations.length < 2
      ? []
      : declarations.map((record) => ({
          code: "singleton-bearing-record-conflict",
          impact: "blocking" as const,
          target: record.locator,
          message: `Bearing Record type ${type} may have only one declaration.`,
        })),
  );
};

const effortWorkBindingConflictDiagnostics = (
  records: readonly DecodedBearingRecord[],
): StructuralDiagnostic[] => {
  const byBinding = groupBy(
    records.flatMap((record) => {
      const data = record.data;
      return data?.Type === "effort" && data["Work binding"] !== undefined
        ? [{ record, binding: data["Work binding"] }]
        : [];
    }),
    ({ binding }) =>
      mattNativeScopeKey({
        provider: binding.Provider,
        nativeScope: binding["Native scope"],
      }),
  );
  return [...byBinding.values()].flatMap((entries) =>
    entries.length < 2
      ? []
      : entries.map(({ record }) => ({
          code: "effort-work-binding-conflict",
          impact: "blocking" as const,
          target: record.locator,
          message:
            "Canonical Effort Work Binding conflicts with another Effort bound to the same stable provider-native identity.",
        })),
  );
};

const referenceDiagnostics = (
  nodes: readonly BearingNode[],
  references: readonly CanonicalReference[],
): StructuralDiagnostic[] => {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
  return references.flatMap((reference) => {
    const count = counts.get(reference.target) ?? 0;
    if (count === 1) return [];
    return [
      {
        code: count === 0 ? "broken-canonical-reference" : "ambiguous-canonical-reference",
        impact: "blocking" as const,
        target: reference.source,
        message:
          count === 0
            ? "Canonical Reference does not resolve."
            : "Canonical Reference is ambiguous.",
      },
    ];
  });
};

const authorityAvailabilityDiagnostics = (
  baselines: readonly CanonicalReference[],
  assets: readonly AssetAvailability[],
): StructuralDiagnostic[] => {
  const availability = groupBy(assets, (asset) => asset.id);
  return baselines.flatMap((baseline) => {
    const states = availability.get(baseline.target);
    if (states?.length !== 1 || states[0]?.available !== false) return [];
    return [
      {
        code: "authority-baseline-unavailable-asset",
        impact: "blocking" as const,
        target: baseline.source,
        message: `Authority baseline references a non-available Asset: ${baseline.target}.`,
      },
    ];
  });
};

export const decodeBearingRecordGeneration = (
  generation: Pick<SyncInputGeneration, "fingerprint" | "records">,
): DecodedBearingRecordGeneration => {
  const capturedRecords = generation.records;
  let decodeCount = 0;
  const records = capturedRecords.flatMap((record) => {
    if (expectedBearingType(record.locator) !== undefined) decodeCount += 1;
    const decoded = decodeRecord(record, generation.fingerprint);
    return decoded === undefined ? [] : [decoded];
  });
  const analyses = records.map((record) => record.analysis);
  const nodes = declaredNodes(records);
  const references = analyses.flatMap((analysis) => analysis.references);
  const diagnostics = [
    ...records.flatMap((record) => record.diagnostics),
    ...duplicateIdentityDiagnostics(nodes),
    ...singletonDiagnostics(records),
    ...effortWorkBindingConflictDiagnostics(records),
    ...referenceDiagnostics(nodes, references),
    ...authorityAvailabilityDiagnostics(
      analyses.flatMap((analysis) => analysis.authorityBaselines),
      analyses.flatMap((analysis) => analysis.assetAvailability),
    ),
    ...deriveTopologyDiagnostics(
      analyses.flatMap((analysis) => analysis.roadmaps),
      analyses.flatMap((analysis) => analysis.gates),
      analyses.flatMap((analysis) => analysis.efforts),
    ),
  ].sort((left, right) => {
    const target = compareText(left.target, right.target);
    if (target !== 0) return target;
    const code = compareText(left.code, right.code);
    return code !== 0 ? code : compareText(left.message, right.message);
  });
  return {
    fingerprint: generation.fingerprint,
    records,
    diagnostics,
    metrics: {
      capturedInputCount: capturedRecords.length,
      bearingRecordCount: records.length,
      decodeCount,
    },
  };
};

export const rebaseDecodedBearingRecordGeneration = (
  decoded: DecodedBearingRecordGeneration,
  fingerprint: string,
  capturedInputCount: number,
): DecodedBearingRecordGeneration => ({
  fingerprint,
  records: decoded.records.map((record) => ({
    ...record,
    source: createSourceRecord(fingerprint, {
      kind: record.source.kind,
      locator: record.source.displayLocator,
      ...(record.source.fragment === undefined ? {} : { fragment: record.source.fragment }),
      ...(record.source.binding === undefined ? {} : { binding: record.source.binding }),
    }),
  })),
  diagnostics: decoded.diagnostics,
  metrics: {
    capturedInputCount,
    bearingRecordCount: decoded.metrics.bearingRecordCount,
    decodeCount: decoded.metrics.decodeCount,
  },
});
