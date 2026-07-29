import { lstat, readdir } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { fingerprintInputRecords, normalizeLocator } from "../../fingerprint";
import {
  type MarkdownDocument,
  type MarkdownSection,
  parseMarkdownDocument,
  queryMarkdownDocumentTitle,
  queryMarkdownField,
  queryMarkdownInlineCodes,
  queryMarkdownLinks,
  queryMarkdownList,
  queryMarkdownPreamble,
  queryMarkdownSection,
  queryMarkdownTable,
} from "../../markdown-document";
import {
  type CapturedProviderDocuments,
  createProviderScopeCapture,
  type ProviderDiagnostic,
} from "../../native-work-provider";
import {
  isRepositoryPathBoundaryError,
  readContainedFile,
  resolveContainedPath,
  resolveRepositoryRoot,
} from "../../path-boundary";
import {
  MATT_SKILLS_V1_PROVIDER_ID,
  type MattSkillsV1Provider,
  type MattSkillsV1ScopeCapture,
} from "./capture";
import { retainTrustedLocalProjection } from "./local-markdown-trust";
import type {
  MattBlockedByRelation,
  MattContent,
  MattDeliveryTicket,
  MattIncomingIssue,
  MattMap,
  MattNativeEvidence,
  MattObjectReference,
  MattParentChildRelation,
  MattRawFacet,
  MattScopeProjection,
  MattSourceAnchor,
  MattSpec,
  MattWayfinderTicket,
} from "./model";

const DEFAULT_MAXIMUM_FILE_BYTES = 1024 * 1024;
const REQUIRED_TRIAGE_ROLES = [
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
] as const;
const WAYFINDER_SUBTYPES = new Set(["research", "prototype", "grilling", "task"]);
const SPEC_SECTIONS = [
  ["problem", "Problem Statement"],
  ["solution", "Solution"],
  ["user-stories", "User Stories"],
  ["implementation", "Implementation Decisions"],
  ["testing", "Testing Decisions"],
  ["out-of-scope", "Out of Scope"],
  ["further-notes", "Further Notes"],
] as const;

type FileStamp = Readonly<{
  dev: string;
  ino: string;
  mode: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}>;

type MarkdownInput = Readonly<{
  locator: string;
  bytes: Buffer;
  source: string;
  document: MarkdownDocument;
}>;

type CapturedFile = MarkdownInput &
  Readonly<{
    stamp: FileStamp;
  }>;

type CaptureDiagnostic = ProviderDiagnostic;

type TriageSemanticRole = (typeof REQUIRED_TRIAGE_ROLES)[number] | "bug" | "enhancement";

type TriageVocabulary = Readonly<{
  semanticToNative: ReadonlyMap<TriageSemanticRole, string>;
  nativeToSemantic: ReadonlyMap<string, TriageSemanticRole>;
  complete: boolean;
}>;

type IssueRole = "wayfinder" | "delivery" | "incoming" | "ambiguous";

type DecodedIssue = Readonly<{
  file: CapturedFile;
  shortReference: string;
  role: IssueRole;
  wayfinder?: MattWayfinderTicket;
  delivery?: MattDeliveryTicket;
  incoming?: MattIncomingIssue;
  blockerReferences: readonly string[];
}>;

export type LocalMarkdownCaptureEvent =
  | Readonly<{ kind: "scope-enumerated"; locator: string }>
  | Readonly<{ kind: "content-read"; locator: string }>
  | Readonly<{ kind: "metadata-verified"; locator: string }>;

export type LocalMarkdownMattProviderOptions = Readonly<{
  repoRoot: string;
  contractLocator: string;
  triageLocator?: string;
  maximumFileBytes?: number;
  clock?: () => Date;
  capturedDocuments?: CapturedProviderDocuments;
  onCaptureEvent?: (event: LocalMarkdownCaptureEvent) => void | Promise<void>;
}>;

const objectReference = (locator: string): MattObjectReference => locator as MattObjectReference;

const isExternalAnchorTarget = (target: string): boolean =>
  target.startsWith("//") || URL.canParse(target);

const isRequiredTriageRole = (
  value: TriageSemanticRole,
): value is (typeof REQUIRED_TRIAGE_ROLES)[number] =>
  REQUIRED_TRIAGE_ROLES.some((role) => role === value);

const isSystemError = (error: unknown): error is Error & Readonly<{ code: string }> =>
  error instanceof Error && "code" in error && typeof error.code === "string";

const utf8Compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const stampFor = async (target: string): Promise<FileStamp> => {
  const metadata = await lstat(target, { bigint: true });
  return {
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: String(metadata.mode),
    size: String(metadata.size),
    mtimeNs: String(metadata.mtimeNs),
    ctimeNs: String(metadata.ctimeNs),
  };
};

const sameStamp = (left: FileStamp, right: FileStamp): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

const diagnostic = (
  code: string,
  diagnosticClass: CaptureDiagnostic["class"],
  target: string,
  message: string,
  impact: CaptureDiagnostic["impact"] = "blocking",
): CaptureDiagnostic => ({
  code,
  class: diagnosticClass,
  impact,
  target,
  message,
});

const captureWithoutProjection = (
  input: Readonly<{
    binding: Parameters<MattSkillsV1Provider["capture"]>[0];
    generation: Parameters<MattSkillsV1Provider["capture"]>[1];
    capturedAt: string;
    state: "absent" | "invalid";
    freshness: "current" | "undetermined";
    completion: "incomplete" | "undetermined";
    diagnostics: readonly CaptureDiagnostic[];
  }>,
): MattSkillsV1ScopeCapture =>
  createProviderScopeCapture({
    provider: MATT_SKILLS_V1_PROVIDER_ID,
    binding: input.binding,
    generation: input.generation,
    state: input.state,
    freshness: {
      assessment: input.freshness,
      capturedAt: input.capturedAt,
      evidence: [{ kind: "local-scope", value: input.binding.nativeScope }],
    },
    coverage: {
      assessment: input.state === "absent" ? "complete" : "incomplete",
      dimensions: [
        {
          key: input.state === "absent" ? "root-existence" : "scope-safety",
          state: input.state === "absent" ? "covered" : "gap",
        },
      ],
    },
    completion: input.completion,
    diagnostics: input.diagnostics,
  });

const requiredSection = (
  document: MarkdownDocument,
  title: string,
  target: string,
  diagnostics: CaptureDiagnostic[],
): MarkdownSection | undefined => {
  const result = queryMarkdownSection(document, { title });
  if (result.state === "found") return result.value;
  diagnostics.push(
    diagnostic(
      "matt.local.decode.required-section",
      "format",
      target,
      `Required Matt section is ${result.state}: ${title}.`,
    ),
  );
  return undefined;
};

const sectionListItems = (
  document: MarkdownDocument,
  section: MarkdownSection | undefined,
  target: string,
  diagnostics: CaptureDiagnostic[],
  required: boolean,
): readonly string[] => {
  if (section === undefined) return [];
  const result = queryMarkdownList(document, { within: section });
  if (result.state === "found") return result.value.items.map((item) => item.text);
  if (result.state === "absent" && !required) {
    return section.markdown.length === 0 ? [] : [section.markdown];
  }
  diagnostics.push(
    diagnostic(
      "matt.local.decode.list",
      "format",
      target,
      `Matt list structure is ${result.state}.`,
    ),
  );
  return [];
};

const fieldValue = (
  file: CapturedFile,
  label: string,
  diagnostics?: CaptureDiagnostic[],
): string | undefined => {
  const preamble = queryMarkdownPreamble(file.document);
  if (preamble.state !== "found") {
    if (preamble.state === "ambiguous") {
      diagnostics?.push(
        diagnostic(
          "matt.local.decode.preamble-ambiguous",
          "format",
          file.locator,
          "Matt document preamble is ambiguous.",
        ),
      );
    }
    return undefined;
  }
  const field = queryMarkdownField(file.document, { label, within: preamble.value });
  if (field.state === "found") return field.value.value;
  if (field.state === "ambiguous") {
    diagnostics?.push(
      diagnostic(
        "matt.local.decode.field-ambiguous",
        "format",
        file.locator,
        `Matt field is ambiguous: ${label}.`,
      ),
    );
  }
  return undefined;
};

const titleFor = (file: CapturedFile, diagnostics: CaptureDiagnostic[]): string | undefined => {
  const title = queryMarkdownDocumentTitle(file.document);
  if (title.state === "found") return title.value.title;
  diagnostics.push(
    diagnostic(
      "matt.local.decode.title",
      "format",
      file.locator,
      `Matt document title is ${title.state}.`,
    ),
  );
  return undefined;
};

const anchorsFor = (file: CapturedFile): readonly MattSourceAnchor[] =>
  queryMarkdownLinks(file.document).map((link) => ({
    kind: isExternalAnchorTarget(link.target) ? "external" : "source",
    target: link.target,
  }));

const rawFacetsFor = (
  file: CapturedFile,
  extra: readonly MattRawFacet[] = [],
): readonly MattRawFacet[] => [
  { key: "mode", values: [file.stamp.mode] },
  { key: "size", values: [file.stamp.size] },
  { key: "markdown", values: [file.source] },
  ...extra,
];

const nativeEvidenceFor = (
  file: CapturedFile,
  extra: readonly MattRawFacet[] = [],
): MattNativeEvidence => ({
  kind: "local",
  identity: { locator: file.locator },
  sourceAnchors: anchorsFor(file),
  rawFacets: rawFacetsFor(file, extra),
});

const contentSection = (
  file: CapturedFile,
  title: string,
  role: MattContent["role"],
): MattContent | undefined => {
  const result = queryMarkdownSection(file.document, { title });
  if (result.state !== "found" || result.value.markdown.length === 0) return undefined;
  return {
    role,
    body: result.value.markdown,
    ...(role === "answer"
      ? {
          sourceAnchor: {
            kind: "answer" as const,
            target: `${file.locator}#answer`,
          },
        }
      : {}),
  };
};

const supplementaryContent = (file: CapturedFile): readonly MattContent[] => {
  const roles = [
    ["Comments", "ordinary-comment"],
    ["Agent Brief", "agent-brief"],
    ["Triage Notes", "triage-note"],
  ] as const;
  const content = roles.flatMap(([title, role]) => {
    const item = contentSection(file, title, role);
    return item === undefined ? [] : [item];
  });
  for (const link of queryMarkdownLinks(file.document)) {
    content.push({
      role: "source-anchor",
      body: link.label,
      sourceAnchor: {
        kind: isExternalAnchorTarget(link.target) ? "external" : "source",
        target: link.target,
      },
    });
  }
  return content;
};

type LocalContractLayout = Readonly<{
  specFilename: "spec.md" | "PRD.md";
}>;

const parseContract = (
  file: MarkdownInput,
  diagnostics: CaptureDiagnostic[],
): LocalContractLayout | undefined => {
  const title = queryMarkdownDocumentTitle(file.document);
  const conventions = queryMarkdownSection(file.document, { title: "Conventions" });
  const wayfinding = queryMarkdownSection(file.document, { title: "Wayfinding operations" });
  if (
    title.state !== "found" ||
    title.value.title !== "Issue tracker: Local Markdown" ||
    conventions.state !== "found" ||
    wayfinding.state !== "found"
  ) {
    diagnostics.push(
      diagnostic(
        "matt.local.contract.unsupported",
        "contract",
        file.locator,
        "Confirmed contract does not expose the supported Local Markdown headings.",
      ),
    );
    return undefined;
  }
  const conventionList = queryMarkdownList(file.document, { within: conventions.value });
  const wayfindingList = queryMarkdownList(file.document, { within: wayfinding.value });
  const conventionCodes = queryMarkdownInlineCodes(file.document, {
    within: conventions.value,
  });
  const conventionItems =
    conventionList.state === "found" ? conventionList.value.items.map((item) => item.text) : [];
  const wayfindingItems =
    wayfindingList.state === "found" ? wayfindingList.value.items.map((item) => item.text) : [];
  const specTemplates = [
    ".scratch/<feature-slug>/spec.md",
    ".scratch/<feature-slug>/PRD.md",
  ].filter((template) => conventionCodes.includes(template));
  const supported =
    specTemplates.length === 1 &&
    conventionItems.some((item) =>
      item.includes(".scratch/<feature-slug>/issues/<NN>-<slug>.md"),
    ) &&
    conventionItems.some((item) => item.includes("triage-labels.md")) &&
    wayfindingItems.some((item) => item.includes(".scratch/<effort>/map.md")) &&
    wayfindingItems.some((item) => item.includes(".scratch/<effort>/issues/NN-<slug>.md"));
  if (!supported) {
    diagnostics.push(
      diagnostic(
        "matt.local.contract.unsupported",
        "contract",
        file.locator,
        "Confirmed contract does not describe the supported bounded Local layout.",
      ),
    );
  }
  if (!supported) return undefined;
  return {
    specFilename: specTemplates[0]?.endsWith("/spec.md") ? "spec.md" : "PRD.md",
  };
};

const parseTriageVocabulary = (
  file: MarkdownInput,
  diagnostics: CaptureDiagnostic[],
): TriageVocabulary | undefined => {
  const table = queryMarkdownTable(file.document);
  if (table.state !== "found") {
    diagnostics.push(
      diagnostic(
        "matt.local.mapping.ambiguous",
        "mapping",
        file.locator,
        `Triage vocabulary table is ${table.state}.`,
      ),
    );
    return undefined;
  }
  const semanticColumn = table.value.columns.findIndex(
    (column) => column === "Label in mattpocock/skills" || column === "Semantic role",
  );
  const nativeColumn = table.value.columns.indexOf("Label in our tracker");
  if (semanticColumn === -1 || nativeColumn === -1) {
    diagnostics.push(
      diagnostic(
        "matt.local.mapping.ambiguous",
        "mapping",
        file.locator,
        "Triage vocabulary is missing a semantic or tracker-value column.",
      ),
    );
    return undefined;
  }

  const semanticToNative = new Map<TriageSemanticRole, string>();
  const nativeToSemantic = new Map<string, TriageSemanticRole>();
  let ambiguous = false;
  for (const row of table.value.rows) {
    const semantic = row[semanticColumn];
    const native = row[nativeColumn];
    if (
      semantic === undefined ||
      native === undefined ||
      !(
        REQUIRED_TRIAGE_ROLES.includes(semantic as (typeof REQUIRED_TRIAGE_ROLES)[number]) ||
        semantic === "bug" ||
        semantic === "enhancement"
      )
    ) {
      continue;
    }
    if (semanticToNative.has(semantic as TriageSemanticRole) || nativeToSemantic.has(native)) {
      ambiguous = true;
      continue;
    }
    semanticToNative.set(semantic as TriageSemanticRole, native);
    nativeToSemantic.set(native, semantic as TriageSemanticRole);
  }
  if (REQUIRED_TRIAGE_ROLES.some((role) => !semanticToNative.has(role))) ambiguous = true;
  if (ambiguous) {
    diagnostics.push(
      diagnostic(
        "matt.local.mapping.ambiguous",
        "mapping",
        file.locator,
        "Triage vocabulary contains missing, duplicate or conflicting mappings.",
      ),
    );
  }
  return { semanticToNative, nativeToSemantic, complete: !ambiguous };
};

const issueRole = (file: CapturedFile): IssueRole => {
  const preamble = queryMarkdownPreamble(file.document);
  if (preamble.state !== "found") return "ambiguous";
  const type = queryMarkdownField(file.document, { label: "Type", within: preamble.value });
  const status = queryMarkdownField(file.document, { label: "Status", within: preamble.value });
  const question = queryMarkdownSection(file.document, { title: "Question" });
  const whatToBuild = queryMarkdownField(file.document, {
    label: "What to build",
    within: preamble.value,
  });
  const blockedBy = queryMarkdownField(file.document, {
    label: "Blocked by",
    within: preamble.value,
  });
  const list = queryMarkdownList(file.document, { within: preamble.value });
  const hasAcceptanceChecklist =
    list.state === "found" &&
    list.value.items.length > 0 &&
    list.value.items.every((item) => item.checked !== undefined);
  const hasWayfinderSignal = type.state !== "absent" || question.state !== "absent";
  const hasDeliverySignal = whatToBuild.state !== "absent";
  if (
    (hasWayfinderSignal && hasDeliverySignal) ||
    type.state === "ambiguous" ||
    status.state === "ambiguous" ||
    question.state === "ambiguous" ||
    whatToBuild.state === "ambiguous" ||
    blockedBy.state === "ambiguous" ||
    (hasDeliverySignal && (status.state !== "found" || !hasAcceptanceChecklist))
  ) {
    return "ambiguous";
  }
  if (
    type.state === "found" &&
    WAYFINDER_SUBTYPES.has(type.value.value) &&
    (status.state === "found" || status.state === "absent") &&
    question.state === "found"
  ) {
    return "wayfinder";
  }
  if (hasWayfinderSignal) return "ambiguous";
  if (whatToBuild.state === "found" && status.state === "found" && hasAcceptanceChecklist) {
    return "delivery";
  }
  return "incoming";
};

const splitBlockerReferences = (value: string | undefined): readonly string[] =>
  value === undefined
    ? []
    : value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

const requiredEvidenceLocators = (
  file: CapturedFile,
  diagnostics: CaptureDiagnostic[],
): readonly string[] => {
  const locators = new Set<string>();
  for (const title of ["Answer", "Evidence"]) {
    const section = queryMarkdownSection(file.document, { title });
    if (section.state !== "found") continue;
    for (const link of queryMarkdownLinks(file.document, { within: section.value })) {
      if (isExternalAnchorTarget(link.target) || link.target.startsWith("#")) {
        continue;
      }
      const path = link.target.split("#")[0] ?? "";
      if (path.length === 0) continue;
      if (posix.isAbsolute(path)) {
        diagnostics.push(
          diagnostic(
            "matt.local.evidence.unsafe",
            "source",
            file.locator,
            `Required evidence link is not a safe repository-relative locator: ${link.target}.`,
          ),
        );
        continue;
      }
      try {
        locators.add(normalizeLocator(posix.join(posix.dirname(file.locator), path)));
      } catch {
        diagnostics.push(
          diagnostic(
            "matt.local.evidence.unsafe",
            "source",
            file.locator,
            `Required evidence link is not a safe repository-relative locator: ${link.target}.`,
          ),
        );
      }
    }
  }
  return [...locators].sort(utf8Compare);
};

const normalizedShortReference = (value: string): string => {
  const numeric = Number.parseInt(value, 10);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? String(numeric) : value;
};

const shortReferenceFor = (locator: string): string | undefined => {
  const name = posix.basename(locator);
  const separator = name.indexOf("-");
  if (separator <= 0) return undefined;
  const candidate = name.slice(0, separator);
  if ([...candidate].some((character) => character < "0" || character > "9")) return undefined;
  return normalizedShortReference(candidate);
};

const decodeWayfinder = (
  file: CapturedFile,
  capturedAt: string,
  diagnostics: CaptureDiagnostic[],
): MattWayfinderTicket | undefined => {
  const title = titleFor(file, diagnostics);
  const type = fieldValue(file, "Type", diagnostics);
  const status = fieldValue(file, "Status", diagnostics);
  const question = queryMarkdownSection(file.document, { title: "Question" });
  if (
    title === undefined ||
    type === undefined ||
    !WAYFINDER_SUBTYPES.has(type) ||
    question.state !== "found"
  ) {
    return undefined;
  }
  const claimant = fieldValue(file, "Claimed by", diagnostics);
  const answer = contentSection(file, "Answer", "answer");
  const resolved = status === "resolved";
  if (status !== undefined && status !== "claimed" && !resolved) {
    diagnostics.push(
      diagnostic(
        "matt.local.lifecycle.unknown",
        "format",
        file.locator,
        "Wayfinder Status must be claimed or resolved.",
      ),
    );
  }
  return {
    kind: "wayfinder-ticket",
    ref: objectReference(file.locator),
    title,
    subtype: type as MattWayfinderTicket["subtype"],
    question: question.value.markdown,
    claim:
      status === "claimed"
        ? {
            state: "claimed",
            ...(claimant === undefined ? {} : { claimant }),
          }
        : { state: "unclaimed" },
    answer:
      answer === undefined
        ? { availability: "unavailable", reason: "not-authored" }
        : {
            availability: "available",
            content: answer as MattContent & Readonly<{ role: "answer" }>,
          },
    comments: supplementaryContent(file),
    lifecycle: { state: "open" },
    trackerClosure: resolved
      ? {
          state: "closed",
          disposition: "completed",
          observedAt: capturedAt,
        }
      : { state: "open" },
    native: nativeEvidenceFor(file, [
      { key: "type", values: [type] },
      ...(status === undefined ? [] : [{ key: "status", values: [status] }]),
      ...(claimant === undefined ? [] : [{ key: "claimant", values: [claimant] }]),
    ]),
  };
};

const decodeDelivery = (
  file: CapturedFile,
  vocabulary: TriageVocabulary | undefined,
  capturedAt: string,
  diagnostics: CaptureDiagnostic[],
): MattDeliveryTicket | undefined => {
  const title = titleFor(file, diagnostics);
  const whatToBuild = fieldValue(file, "What to build", diagnostics);
  const status = fieldValue(file, "Status", diagnostics);
  const preamble = queryMarkdownPreamble(file.document);
  const acceptance =
    preamble.state === "found"
      ? queryMarkdownList(file.document, { within: preamble.value })
      : { state: "absent" as const };
  if (title === undefined || whatToBuild === undefined || acceptance.state !== "found") {
    return undefined;
  }
  const answer = contentSection(file, "Answer", "answer");
  const semanticStatus =
    status === undefined ? undefined : vocabulary?.nativeToSemantic.get(status);
  let lifecycle: MattDeliveryTicket["lifecycle"] = { state: "open" };
  let trackerClosure: MattDeliveryTicket["trackerClosure"] = { state: "open" };
  if (status === "resolved") {
    if (answer === undefined) {
      lifecycle = { state: "completion-unavailable", reason: "incomplete-writeback" };
      diagnostics.push(
        diagnostic(
          "matt.local.delivery.incomplete-writeback",
          "format",
          file.locator,
          "Resolved Delivery ticket has no Answer evidence.",
        ),
      );
    } else {
      lifecycle = {
        state: "completed",
        evidence: [answer.sourceAnchor?.target ?? `${file.locator}#answer`],
      };
    }
    trackerClosure = {
      state: "closed",
      disposition: "completed",
      observedAt: capturedAt,
    };
  } else if (semanticStatus === "wontfix") {
    lifecycle = { state: "completion-unavailable", reason: "source-contract-gap" };
    trackerClosure = {
      state: "closed",
      disposition: "wontfix",
      observedAt: capturedAt,
    };
  } else if (
    status === undefined ||
    (status !== "claimed" &&
      (semanticStatus === undefined || !isRequiredTriageRole(semanticStatus)))
  ) {
    diagnostics.push(
      diagnostic(
        "matt.local.lifecycle.unknown",
        "format",
        file.locator,
        "Delivery Status is missing or unsupported.",
      ),
    );
  }
  return {
    kind: "delivery-ticket",
    ref: objectReference(file.locator),
    title,
    whatToBuild,
    acceptanceCriteria: acceptance.value.items.map((item) => item.text),
    lifecycle,
    trackerClosure,
    comments: supplementaryContent(file),
    native: nativeEvidenceFor(file, [
      ...(status === undefined ? [] : [{ key: "status", values: [status] }]),
    ]),
  };
};

const decodeIncoming = (
  file: CapturedFile,
  vocabulary: TriageVocabulary | undefined,
  capturedAt: string,
  diagnostics: CaptureDiagnostic[],
): MattIncomingIssue | undefined => {
  const title = titleFor(file, diagnostics);
  if (title === undefined) return undefined;
  const nativeCategory = fieldValue(file, "Category", diagnostics);
  const nativeState = fieldValue(file, "Status", diagnostics);
  let category: MattIncomingIssue["classification"]["category"] = "unknown";
  let state: MattIncomingIssue["classification"]["state"] = "unknown";
  if ((nativeCategory === undefined) !== (nativeState === undefined)) {
    category = nativeCategory === undefined ? "unknown" : "ambiguous";
    state = nativeState === undefined ? "unknown" : "ambiguous";
    diagnostics.push(
      diagnostic(
        "matt.local.triage.incomplete",
        "mapping",
        file.locator,
        "Incoming issue has only one of Category and Status.",
      ),
    );
  } else if (nativeCategory !== undefined && nativeState !== undefined) {
    const mappedCategory = vocabulary?.nativeToSemantic.get(nativeCategory);
    const canonicalCategory =
      nativeCategory === "bug" || nativeCategory === "enhancement" ? nativeCategory : undefined;
    const categorySemantic =
      mappedCategory ??
      (canonicalCategory !== undefined &&
      vocabulary?.semanticToNative.has(canonicalCategory) !== true
        ? canonicalCategory
        : undefined);
    const stateSemantic = vocabulary?.nativeToSemantic.get(nativeState);
    category =
      categorySemantic === "bug" || categorySemantic === "enhancement"
        ? categorySemantic
        : "ambiguous";
    state =
      stateSemantic !== undefined && isRequiredTriageRole(stateSemantic)
        ? stateSemantic
        : "ambiguous";
    if (category === "ambiguous" || state === "ambiguous") {
      diagnostics.push(
        diagnostic(
          "matt.local.triage.unknown",
          "mapping",
          file.locator,
          "Incoming issue preserves unknown native Category or Status and cannot classify it.",
        ),
      );
    }
  }
  return {
    kind: "incoming-issue",
    ref: objectReference(file.locator),
    title,
    classification: {
      category,
      state,
      ...(nativeCategory === undefined ? {} : { nativeCategory }),
      ...(nativeState === undefined ? {} : { nativeState }),
    },
    content: supplementaryContent(file),
    lifecycle:
      state === "wontfix"
        ? {
            state: "closed",
            disposition: "wontfix",
            observedAt: capturedAt,
          }
        : { state: "open" },
    native: nativeEvidenceFor(file, [
      ...(nativeCategory === undefined ? [] : [{ key: "category", values: [nativeCategory] }]),
      ...(nativeState === undefined ? [] : [{ key: "status", values: [nativeState] }]),
    ]),
  };
};

const gistAfterLinkLabel = (text: string, label: string): string => {
  const suffix = text.startsWith(label) ? text.slice(label.length).trim() : text.trim();
  return suffix.startsWith("—") || suffix.startsWith("-") ? suffix.slice(1).trim() : suffix;
};

const optionalSectionList = (
  file: CapturedFile,
  title: string,
  diagnostics: CaptureDiagnostic[],
): readonly string[] => {
  const section = queryMarkdownSection(file.document, { title });
  return section.state === "found"
    ? sectionListItems(file.document, section.value, file.locator, diagnostics, false)
    : [];
};

const canonicalMapIssueLocator = (file: CapturedFile, target: string): string | undefined => {
  if (isExternalAnchorTarget(target) || target.startsWith("#")) return undefined;
  const path = target.split("#")[0] ?? "";
  if (path.length === 0 || posix.isAbsolute(path)) return undefined;
  try {
    const locator = normalizeLocator(posix.join(posix.dirname(file.locator), path));
    const issuesLocator = normalizeLocator(posix.join(posix.dirname(file.locator), "issues"));
    return posix.dirname(locator) === issuesLocator && locator.endsWith(".md")
      ? locator
      : undefined;
  } catch {
    return undefined;
  }
};

const mapSectionEntries = (
  file: CapturedFile,
  title: string,
  issueByLocator: ReadonlyMap<string, DecodedIssue>,
  diagnostics: CaptureDiagnostic[],
): readonly Readonly<{
  issue?: DecodedIssue;
  index: number;
  label?: string;
  text: string;
}>[] => {
  const section = queryMarkdownSection(file.document, { title });
  if (section.state !== "found") return [];
  const list = queryMarkdownList(file.document, { within: section.value });
  if (list.state !== "found") {
    if (section.value.markdown.length > 0) {
      diagnostics.push(
        diagnostic(
          "matt.local.decode.list",
          "format",
          file.locator,
          `Map ${title} must contain one unambiguous list when non-empty.`,
        ),
      );
    }
    return [];
  }
  return list.value.items.map((item, index) => {
    const canonicalLinks = (item.links ?? []).flatMap((link) => {
      const locator = canonicalMapIssueLocator(file, link.target);
      return locator === undefined ? [] : [{ link, locator }];
    });
    if (canonicalLinks.length === 0) return { index, text: item.text };
    if (canonicalLinks.length > 1) {
      diagnostics.push(
        diagnostic(
          "matt.local.relation.ambiguous",
          "identity",
          file.locator,
          `Map ${title} item contains more than one canonical ticket link.`,
        ),
      );
      return { index, text: item.text };
    }
    const candidate = canonicalLinks[0];
    if (candidate === undefined) return { index, text: item.text };
    const issue = issueByLocator.get(candidate.locator);
    if (issue === undefined) {
      diagnostics.push(
        diagnostic(
          "matt.local.relation.broken",
          "identity",
          file.locator,
          `Map ${title} ticket link does not resolve to one Wayfinder ticket: ${
            candidate.link.target
          }.`,
        ),
      );
      return { index, text: item.text };
    }
    if (issue.wayfinder === undefined) return { index, text: item.text };
    return {
      issue,
      index,
      label: candidate.link.label,
      text: item.text,
    };
  });
};

const decodeMap = (
  file: CapturedFile,
  issueByLocator: ReadonlyMap<string, DecodedIssue>,
  diagnostics: CaptureDiagnostic[],
): MattMap | undefined => {
  const title = titleFor(file, diagnostics);
  const destination = requiredSection(file.document, "Destination", file.locator, diagnostics);
  if (title === undefined || destination === undefined) return undefined;
  const notes = optionalSectionList(file, "Notes", diagnostics);
  const fog = optionalSectionList(file, "Fog", diagnostics);
  const decisions: MattMap["decisions"][number][] = [];
  for (const entry of mapSectionEntries(file, "Decisions so far", issueByLocator, diagnostics)) {
    decisions.push({
      ...(entry.issue === undefined ? {} : { ticket: objectReference(entry.issue.file.locator) }),
      gist: entry.label === undefined ? entry.text : gistAfterLinkLabel(entry.text, entry.label),
      sourceAnchor: { kind: "decision", target: `${file.locator}#decision-${entry.index + 1}` },
    });
  }

  const outOfScope: MattMap["outOfScope"][number][] = [];
  for (const entry of mapSectionEntries(file, "Out of scope", issueByLocator, diagnostics)) {
    outOfScope.push({
      ...(entry.issue === undefined ? {} : { ticket: objectReference(entry.issue.file.locator) }),
      rationale:
        entry.label === undefined ? entry.text : gistAfterLinkLabel(entry.text, entry.label),
      sourceAnchor: {
        kind: "disposition",
        target: `${file.locator}#out-of-scope-${entry.index + 1}`,
      },
    });
  }
  const status = fieldValue(file, "Status", diagnostics);
  if (status !== "resolved" && status !== "active") {
    diagnostics.push(
      diagnostic(
        "matt.local.lifecycle.unknown",
        "format",
        file.locator,
        "Map Status must be active or resolved.",
      ),
    );
  }
  return {
    kind: "map",
    ref: objectReference(file.locator),
    title,
    destination: destination.markdown,
    notes,
    decisions,
    fog,
    outOfScope,
    lifecycle:
      status === "resolved"
        ? {
            state: "resolved",
            resolutionEvidence: decisions.map((decision) => decision.sourceAnchor),
          }
        : { state: "active" },
    native: nativeEvidenceFor(file, [
      ...(status === undefined ? [] : [{ key: "status", values: [status] }]),
    ]),
  };
};

const decodeSpec = (file: CapturedFile, diagnostics: CaptureDiagnostic[]): MattSpec | undefined => {
  const title = titleFor(file, diagnostics);
  const status = fieldValue(file, "Status", diagnostics);
  const sections: MattSpec["sections"][number][] = [];
  for (const [role, sectionTitle] of SPEC_SECTIONS) {
    const section = requiredSection(file.document, sectionTitle, file.locator, diagnostics);
    if (section !== undefined) {
      sections.push({ role, title: sectionTitle, body: section.markdown });
    }
  }
  if (title === undefined || sections.length !== SPEC_SECTIONS.length) return undefined;
  const lifecycle =
    status === "ready-for-agent" || status === "superseded" || status === "draft"
      ? status
      : "draft";
  if (status !== lifecycle) {
    diagnostics.push(
      diagnostic(
        "matt.local.lifecycle.unknown",
        "format",
        file.locator,
        "Spec Status must be draft, ready-for-agent or superseded.",
      ),
    );
  }
  return {
    kind: "spec",
    ref: objectReference(file.locator),
    title,
    sections,
    lifecycle: { state: lifecycle },
    native: nativeEvidenceFor(file, [
      ...(status === undefined ? [] : [{ key: "status", values: [status] }]),
    ]),
  };
};

const lifecycleWithMapEvidence = (
  ticket: MattWayfinderTicket,
  map: MattMap | undefined,
  diagnostics: CaptureDiagnostic[],
): MattWayfinderTicket => {
  if (ticket.trackerClosure.state !== "closed") return ticket;
  const decision = map?.decisions.find((entry) => entry.ticket === ticket.ref);
  if (decision !== undefined) {
    return {
      ...ticket,
      lifecycle: {
        state: "resolved-on-route",
        decisionSource: decision.sourceAnchor,
      },
    };
  }
  const disposition = map?.outOfScope.find((entry) => entry.ticket === ticket.ref);
  if (disposition !== undefined) {
    return {
      ...ticket,
      lifecycle: {
        state: "ruled-out-of-scope",
        dispositionSource: disposition.sourceAnchor,
      },
      trackerClosure: {
        ...ticket.trackerClosure,
        disposition: "wontfix",
      },
    };
  }
  diagnostics.push(
    diagnostic(
      "matt.local.relation.broken",
      "identity",
      ticket.native.kind === "local" ? ticket.native.identity.locator : String(ticket.ref),
      "Resolved Wayfinder ticket has no unique Map decision or out-of-scope pointer.",
    ),
  );
  return ticket;
};

const scopeCompletion = (projection: MattScopeProjection): "complete" | "incomplete" => {
  if (projection.map !== undefined && projection.map.lifecycle.state !== "resolved") {
    return "incomplete";
  }
  if (projection.map !== undefined && projection.map.fog.length > 0) {
    return "incomplete";
  }
  if (
    projection.spec !== undefined &&
    projection.spec.lifecycle.state !== "ready-for-agent" &&
    projection.spec.lifecycle.state !== "superseded"
  ) {
    return "incomplete";
  }
  if (projection.wayfinderTickets.some((ticket) => ticket.lifecycle.state === "open")) {
    return "incomplete";
  }
  if (projection.deliveryTickets.some((ticket) => ticket.lifecycle.state !== "completed")) {
    return "incomplete";
  }
  if (projection.incomingIssues.some((issue) => issue.classification.state !== "wontfix")) {
    return "incomplete";
  }
  return "complete";
};

const captureLocalScope = async (
  options: LocalMarkdownMattProviderOptions,
  binding: Parameters<MattSkillsV1Provider["capture"]>[0],
  generation: Parameters<MattSkillsV1Provider["capture"]>[1],
): Promise<MattSkillsV1ScopeCapture> => {
  const capturedAt = (options.clock ?? (() => new Date()))().toISOString();
  const diagnostics: CaptureDiagnostic[] = [];
  const maximumFileBytes = options.maximumFileBytes ?? DEFAULT_MAXIMUM_FILE_BYTES;
  let root: string;
  try {
    root = await resolveRepositoryRoot(options.repoRoot);
  } catch {
    return captureWithoutProjection({
      binding,
      generation,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      completion: "undetermined",
      diagnostics: [
        diagnostic(
          "matt.local.repository.unavailable",
          "source",
          options.repoRoot,
          "Local repository root is unavailable or not a directory.",
        ),
      ],
    });
  }
  let scopeLocator: string;
  let contractLocator: string;
  let triageLocator: string;
  try {
    scopeLocator = normalizeLocator(binding.nativeScope);
    contractLocator = normalizeLocator(options.contractLocator);
    triageLocator = normalizeLocator(
      options.triageLocator ?? posix.join(posix.dirname(contractLocator), "triage-labels.md"),
    );
  } catch {
    return captureWithoutProjection({
      binding,
      generation,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      completion: "undetermined",
      diagnostics: [
        diagnostic(
          "matt.local.scope.invalid",
          "identity",
          binding.nativeScope,
          "Local scope or contract locator is not a normalized repository-relative path.",
        ),
      ],
    });
  }

  const capturedFiles = new Map<string, CapturedFile>();
  const interpretationFiles = new Map<string, MarkdownInput>();
  const attemptedLocators = new Set<string>();
  const readTarget = async (
    locator: string,
    required: boolean,
  ): Promise<CapturedFile | undefined> => {
    if (attemptedLocators.has(locator)) return capturedFiles.get(locator);
    attemptedLocators.add(locator);
    const target = resolve(root, locator);
    try {
      const contained = await resolveContainedPath(root, target);
      const before = await stampFor(contained);
      if (BigInt(before.size) > BigInt(maximumFileBytes)) {
        diagnostics.push(
          diagnostic(
            "matt.local.input.too-large",
            "source",
            locator,
            `Local Markdown input exceeds ${maximumFileBytes} bytes.`,
          ),
        );
        return undefined;
      }
      const bytes = await readContainedFile(root, contained);
      await options.onCaptureEvent?.({ kind: "content-read", locator });
      if (bytes.length > maximumFileBytes) {
        diagnostics.push(
          diagnostic(
            "matt.local.input.too-large",
            "source",
            locator,
            `Local Markdown input exceeds ${maximumFileBytes} bytes.`,
          ),
        );
        return undefined;
      }
      let source: string;
      try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        diagnostics.push(
          diagnostic(
            "matt.local.input.encoding",
            "format",
            locator,
            "Local Markdown input is not valid UTF-8.",
          ),
        );
        return undefined;
      }
      const file = {
        locator,
        bytes,
        source,
        document: parseMarkdownDocument(source),
        stamp: before,
      };
      capturedFiles.set(locator, file);
      return file;
    } catch (error) {
      if (
        !required &&
        isSystemError(error) &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      ) {
        return undefined;
      }
      if (!isSystemError(error) && !isRepositoryPathBoundaryError(error)) throw error;
      diagnostics.push(
        diagnostic(
          "matt.local.input.unsafe",
          "source",
          locator,
          "Local Markdown input failed containment, symlink, file-type or identity safety.",
        ),
      );
      return undefined;
    }
  };

  const interpretationTarget = async (locator: string): Promise<MarkdownInput | undefined> => {
    if (options.capturedDocuments === undefined) return readTarget(locator, true);
    const captured = options.capturedDocuments.get(locator);
    if (captured === undefined) {
      diagnostics.push(
        diagnostic(
          "matt.local.input.unavailable",
          "source",
          locator,
          "Generation-captured interpretation input is unavailable.",
        ),
      );
      return undefined;
    }
    if (captured.bytes.length > maximumFileBytes) {
      diagnostics.push(
        diagnostic(
          "matt.local.input.too-large",
          "source",
          locator,
          `Local Markdown input exceeds ${maximumFileBytes} bytes.`,
        ),
      );
      return undefined;
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(captured.bytes);
    } catch {
      diagnostics.push(
        diagnostic(
          "matt.local.input.encoding",
          "format",
          locator,
          "Local Markdown input is not valid UTF-8.",
        ),
      );
      return undefined;
    }
    const file = {
      locator,
      bytes: captured.bytes,
      source,
      document: parseMarkdownDocument(source),
    };
    interpretationFiles.set(locator, file);
    return file;
  };

  const contractFile = await interpretationTarget(contractLocator);
  const contractLayout =
    contractFile === undefined ? undefined : parseContract(contractFile, diagnostics);
  if (contractLayout === undefined) {
    return captureWithoutProjection({
      binding,
      generation,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      completion: "undetermined",
      diagnostics,
    });
  }
  const triageFile = await interpretationTarget(triageLocator);
  const vocabulary =
    triageFile === undefined ? undefined : parseTriageVocabulary(triageFile, diagnostics);

  let scopeStamp: FileStamp;
  try {
    const scopePath = await resolveContainedPath(root, resolve(root, scopeLocator));
    const metadata = await lstat(scopePath);
    if (!metadata.isDirectory()) {
      return captureWithoutProjection({
        binding,
        generation,
        capturedAt,
        state: "invalid",
        freshness: "undetermined",
        completion: "undetermined",
        diagnostics: [
          ...diagnostics,
          diagnostic(
            "matt.local.scope.invalid",
            "identity",
            scopeLocator,
            "Local scope is not a directory.",
          ),
        ],
      });
    }
    scopeStamp = await stampFor(scopePath);
  } catch (error) {
    if (isSystemError(error) && error.code === "ENOENT") {
      const configurationInvalid =
        vocabulary === undefined ||
        diagnostics.some(
          (item) =>
            item.class === "contract" ||
            item.class === "mapping" ||
            item.code.startsWith("matt.local.input."),
        );
      return captureWithoutProjection({
        binding,
        generation,
        capturedAt,
        state: configurationInvalid ? "invalid" : "absent",
        freshness: configurationInvalid ? "undetermined" : "current",
        completion: configurationInvalid ? "undetermined" : "incomplete",
        diagnostics,
      });
    }
    if (!isSystemError(error) && !isRepositoryPathBoundaryError(error)) throw error;
    return captureWithoutProjection({
      binding,
      generation,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      completion: "undetermined",
      diagnostics: [
        ...diagnostics,
        diagnostic(
          "matt.local.scope.invalid",
          "identity",
          scopeLocator,
          "Local scope failed repository containment, symlink or file-type validation.",
        ),
      ],
    });
  }

  const mapLocator = normalizeLocator(posix.join(scopeLocator, "map.md"));
  const specLocator = normalizeLocator(posix.join(scopeLocator, contractLayout.specFilename));
  const issuesLocator = normalizeLocator(posix.join(scopeLocator, "issues"));
  const slotPresence = async (locator: string): Promise<string> => {
    try {
      const metadata = await lstat(resolve(root, locator), { bigint: true });
      return [
        metadata.isFile() ? "file" : metadata.isDirectory() ? "directory" : "other",
        metadata.isSymbolicLink() ? "symlink" : "direct",
        String(metadata.dev),
        String(metadata.ino),
      ].join(":");
    } catch (error) {
      if (isSystemError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
        return "missing";
      }
      if (isSystemError(error)) return `blocked:${error.code}`;
      throw error;
    }
  };
  const initialSingletonSlots = new Map([
    [mapLocator, await slotPresence(mapLocator)],
    [specLocator, await slotPresence(specLocator)],
  ]);
  const initialIssuesSlot = await slotPresence(issuesLocator);
  let issueLocators: string[] = [];
  let initialIssueEntries: readonly string[] = [];
  try {
    const issuesPath = await resolveContainedPath(root, resolve(root, issuesLocator));
    const metadata = await lstat(issuesPath);
    if (!metadata.isDirectory()) {
      diagnostics.push(
        diagnostic(
          "matt.local.input.unsafe",
          "source",
          issuesLocator,
          "Contract-defined issues slot is not a directory.",
        ),
      );
    } else {
      const entries = (await readdir(issuesPath, { withFileTypes: true })).sort((left, right) =>
        utf8Compare(left.name, right.name),
      );
      initialIssueEntries = entries.map((entry) => `${entry.name}:${entry.isFile()}`);
      issueLocators = entries
        .filter((entry) => entry.name.endsWith(".md"))
        .map((entry) => normalizeLocator(posix.join(issuesLocator, entry.name)));
    }
  } catch (error) {
    if (!(isSystemError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR"))) {
      if (!isSystemError(error) && !isRepositoryPathBoundaryError(error)) throw error;
      diagnostics.push(
        diagnostic(
          "matt.local.input.unsafe",
          "source",
          issuesLocator,
          "Contract-defined issues slot failed containment or file-type validation.",
        ),
      );
    }
  }
  await options.onCaptureEvent?.({ kind: "scope-enumerated", locator: scopeLocator });

  const mapFile = await readTarget(mapLocator, false);
  const specFile = await readTarget(specLocator, false);
  const issueFiles: CapturedFile[] = [];
  for (const locator of issueLocators) {
    const file = await readTarget(locator, true);
    if (file !== undefined) issueFiles.push(file);
  }
  const evidenceLocators = new Set<string>();
  for (const file of issueFiles) {
    for (const locator of requiredEvidenceLocators(file, diagnostics)) {
      evidenceLocators.add(locator);
    }
  }
  for (const locator of [...evidenceLocators].sort(utf8Compare)) {
    if (capturedFiles.has(locator)) continue;
    const evidence = await readTarget(locator, true);
    if (evidence === undefined) {
      diagnostics.push(
        diagnostic(
          "matt.local.evidence.unavailable",
          "source",
          locator,
          "Required single-hop Local evidence could not be acquired safely.",
        ),
      );
    }
  }

  const decodedIssues: DecodedIssue[] = [];
  const byShortReference = new Map<string, DecodedIssue[]>();
  for (const file of issueFiles) {
    const shortReference = shortReferenceFor(file.locator);
    if (shortReference === undefined) {
      diagnostics.push(
        diagnostic(
          "matt.local.identity.invalid-reference",
          "identity",
          file.locator,
          "Issue filename does not contain one canonical numeric short reference.",
        ),
      );
      continue;
    }
    const role = issueRole(file);
    if (role === "ambiguous") {
      diagnostics.push(
        diagnostic(
          "matt.local.role.ambiguous",
          "format",
          file.locator,
          "Issue contains partial or conflicting Wayfinder and Delivery role evidence.",
        ),
      );
    }
    const wayfinder =
      role === "wayfinder" ? decodeWayfinder(file, capturedAt, diagnostics) : undefined;
    const delivery =
      role === "delivery" ? decodeDelivery(file, vocabulary, capturedAt, diagnostics) : undefined;
    const incoming =
      role === "incoming" ? decodeIncoming(file, vocabulary, capturedAt, diagnostics) : undefined;
    const decoded: DecodedIssue = {
      file,
      shortReference,
      role,
      blockerReferences: splitBlockerReferences(fieldValue(file, "Blocked by", diagnostics)).map(
        normalizedShortReference,
      ),
      ...(wayfinder === undefined ? {} : { wayfinder }),
      ...(delivery === undefined ? {} : { delivery }),
      ...(incoming === undefined ? {} : { incoming }),
    };
    decodedIssues.push(decoded);
    const matches = byShortReference.get(shortReference) ?? [];
    matches.push(decoded);
    byShortReference.set(shortReference, matches);
  }
  for (const [shortReference, matches] of byShortReference) {
    if (matches.length > 1) {
      diagnostics.push(
        diagnostic(
          "matt.local.identity.duplicate-reference",
          "identity",
          scopeLocator,
          `Short reference ${shortReference} resolves to more than one issue.`,
        ),
      );
    }
  }

  const issueByLocator = new Map(decodedIssues.map((issue) => [issue.file.locator, issue]));
  const mapProjection =
    mapFile === undefined ? undefined : decodeMap(mapFile, issueByLocator, diagnostics);
  const specProjection = specFile === undefined ? undefined : decodeSpec(specFile, diagnostics);
  const wayfinderTickets = decodedIssues.flatMap((issue) =>
    issue.wayfinder === undefined ? [] : [issue.wayfinder],
  );
  const deliveryTickets = decodedIssues.flatMap((issue) =>
    issue.delivery === undefined ? [] : [issue.delivery],
  );
  const incomingIssues = decodedIssues.flatMap((issue) =>
    issue.incoming === undefined ? [] : [issue.incoming],
  );

  const parentChild: MattParentChildRelation[] = [];
  if (mapProjection !== undefined) {
    for (const ticket of wayfinderTickets) {
      parentChild.push({
        parent: mapProjection.ref,
        child: ticket.ref,
        evidence: "matt-contract",
      });
    }
  } else if (wayfinderTickets.length > 0) {
    diagnostics.push(
      diagnostic(
        "matt.local.relation.broken",
        "identity",
        scopeLocator,
        "Wayfinder tickets exist without the optional singleton Map required for parent evidence.",
      ),
    );
  }
  if (specProjection !== undefined) {
    for (const ticket of deliveryTickets) {
      parentChild.push({
        parent: specProjection.ref,
        child: ticket.ref,
        evidence: "matt-contract",
      });
    }
  } else if (deliveryTickets.length > 0) {
    diagnostics.push(
      diagnostic(
        "matt.local.relation.broken",
        "identity",
        scopeLocator,
        "Delivery tickets exist without the optional singleton Spec required for parent evidence.",
      ),
    );
  }

  const blockedBy: MattBlockedByRelation[] = [];
  for (const issue of decodedIssues) {
    const blocked = issue.wayfinder?.ref ?? issue.delivery?.ref;
    if (blocked === undefined && issue.blockerReferences.length > 0) {
      diagnostics.push(
        diagnostic(
          "matt.local.relation.broken",
          "identity",
          issue.file.locator,
          "Only Wayfinder and Delivery tickets may carry Blocked by relations.",
        ),
      );
      continue;
    }
    for (const blockerReference of issue.blockerReferences) {
      const matches = byShortReference.get(blockerReference) ?? [];
      const blocker = matches.length === 1 ? matches[0] : undefined;
      const blockerRef = blocker?.wayfinder?.ref ?? blocker?.delivery?.ref;
      if (blocked === undefined || blockerRef === undefined) {
        diagnostics.push(
          diagnostic(
            "matt.local.relation.broken",
            "identity",
            issue.file.locator,
            `Blocked by reference does not uniquely resolve to a ticket: ${blockerReference}.`,
          ),
        );
        continue;
      }
      blockedBy.push({ blocked, blocker: blockerRef, evidence: "matt-contract" });
    }
  }

  const resolvedWayfinder = wayfinderTickets.map((ticket) =>
    lifecycleWithMapEvidence(ticket, mapProjection, diagnostics),
  );

  let concurrentMutation = false;
  let issuesMembershipChanged = false;
  const unstableLocators = new Set<string>();
  try {
    const currentIssuesSlot = await slotPresence(issuesLocator);
    if (currentIssuesSlot !== initialIssuesSlot) {
      concurrentMutation = true;
      issuesMembershipChanged = true;
    } else if (currentIssuesSlot !== "missing") {
      const issuesPath = await resolveContainedPath(root, resolve(root, issuesLocator));
      const currentEntries = (await readdir(issuesPath, { withFileTypes: true }))
        .sort((left, right) => utf8Compare(left.name, right.name))
        .map((entry) => `${entry.name}:${entry.isFile()}`);
      if (JSON.stringify(currentEntries) !== JSON.stringify(initialIssueEntries)) {
        concurrentMutation = true;
        issuesMembershipChanged = true;
      }
    }
  } catch (error) {
    if (!(isSystemError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR"))) {
      if (!isSystemError(error)) throw error;
    }
    concurrentMutation = true;
    issuesMembershipChanged = true;
  }
  try {
    const currentScopePath = await resolveContainedPath(root, resolve(root, scopeLocator));
    if (!sameStamp(scopeStamp, await stampFor(currentScopePath))) concurrentMutation = true;
  } catch (error) {
    if (!isSystemError(error) && !isRepositoryPathBoundaryError(error)) throw error;
    concurrentMutation = true;
  }
  for (const [locator, initial] of initialSingletonSlots) {
    try {
      if ((await slotPresence(locator)) !== initial) {
        concurrentMutation = true;
        unstableLocators.add(locator);
      }
    } catch (error) {
      if (!isSystemError(error)) throw error;
      concurrentMutation = true;
      unstableLocators.add(locator);
    }
  }
  for (const file of capturedFiles.values()) {
    try {
      const current = await stampFor(resolve(root, file.locator));
      if (!sameStamp(file.stamp, current)) {
        concurrentMutation = true;
        unstableLocators.add(file.locator);
      }
      await options.onCaptureEvent?.({ kind: "metadata-verified", locator: file.locator });
    } catch (error) {
      if (!isSystemError(error)) throw error;
      concurrentMutation = true;
      unstableLocators.add(file.locator);
    }
  }
  if (concurrentMutation) {
    diagnostics.push(
      diagnostic(
        "matt.local.concurrent-mutation",
        "concurrency",
        scopeLocator,
        "Local scope changed during capture; the trusted subset is retained without retry.",
      ),
    );
  }

  const observedProjection: MattScopeProjection = {
    ...(mapProjection === undefined ? {} : { map: mapProjection }),
    ...(specProjection === undefined ? {} : { spec: specProjection }),
    wayfinderTickets: resolvedWayfinder,
    deliveryTickets,
    incomingIssues,
    graph: { parentChild, blockedBy },
  };
  const unstableIssueLocators = new Set(
    issueFiles.filter((file) => unstableLocators.has(file.locator)).map((file) => file.locator),
  );
  for (const file of issueFiles) {
    const requiredEvidence = requiredEvidenceLocators(file, []);
    if (requiredEvidence.some((locator) => unstableLocators.has(locator))) {
      unstableIssueLocators.add(file.locator);
    }
  }
  const vocabularyUnstable = unstableLocators.has(triageLocator);
  const projection = retainTrustedLocalProjection({
    observed: observedProjection,
    rawWayfinderTickets: wayfinderTickets,
    map: mapProjection,
    spec: specProjection,
    concurrentMutation,
    issuesMembershipChanged,
    unstableLocators,
    unstableIssueLocators,
    contractLocator,
    triageLocator,
    mapLocator,
    specLocator,
  });
  const blocking = diagnostics.some((item) => item.impact === "blocking");
  const state = blocking ? "partial" : "available";
  const freshness = concurrentMutation ? "undetermined" : "current";
  const sourceRevision = fingerprintInputRecords(
    [...interpretationFiles.values(), ...capturedFiles.values()].map((file) => ({
      locator: file.locator,
      bytes: file.bytes,
    })),
  ).fingerprint;
  const completion =
    state === "available" && freshness === "current" ? scopeCompletion(projection) : "undetermined";

  return createProviderScopeCapture({
    provider: MATT_SKILLS_V1_PROVIDER_ID,
    binding,
    generation,
    state,
    freshness: {
      assessment: freshness,
      capturedAt,
      sourceRevision,
      sourceObservedAt: capturedAt,
      evidence: [
        { kind: "local-scope", value: scopeLocator },
        { kind: "content-read-count", value: String(capturedFiles.size) },
        { kind: "metadata-verification", value: concurrentMutation ? "changed" : "stable" },
      ],
    },
    coverage: {
      assessment: blocking ? "incomplete" : "complete",
      dimensions: [
        { key: "contract", state: "covered" },
        {
          key: "vocabulary",
          state: vocabulary?.complete === true && !vocabularyUnstable ? "covered" : "gap",
        },
        {
          key: "scope-membership",
          state: concurrentMutation ? "gap" : "covered",
        },
        {
          key: "roles-and-relations",
          state: blocking ? "gap" : "covered",
        },
      ],
    },
    completion,
    diagnostics,
    projection,
  });
};

export const createLocalMarkdownMattProvider = (
  options: LocalMarkdownMattProviderOptions,
): MattSkillsV1Provider => ({
  id: MATT_SKILLS_V1_PROVIDER_ID,
  capture: (binding, generation) => captureLocalScope(options, binding, generation),
});
