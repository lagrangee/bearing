import {
  type PlanningLineageSubject,
  planningLineageSubjectSchema,
} from "../src/planning-lineage-route";
import {
  type PortalProjectSection,
  portalProjectReadEnvelopeSchema,
  portalProjectSectionSchema,
} from "../src/portal-project-read-wire";
import { buildProjectFindIndex } from "../src/portal-ui/project-find-model";
import {
  compileProjectReadModel,
  type ProjectReadModelCandidate,
} from "../src/project-read-model/store";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { hasCompleteMattNativeEvidence } from "../src/providers/matt-skills-v1/native-read-model";
import { mattNativeScopeKey } from "../src/providers/matt-skills-v1/native-subject";

const sectionKinds: Readonly<Record<PortalProjectSection, ReadonlySet<string>>> = {
  overview: new Set([
    "project-summary",
    "project-brief",
    "roadmap",
    "gate",
    "effort",
    "alignment-check",
    "planning-review",
    "portal-projection-state",
    "portal-roadmap-index",
  ]),
  roadmaps: new Set([
    "project-summary",
    "roadmap",
    "gate",
    "portal-projection-state",
    "portal-roadmap-index",
  ]),
  assets: new Set([
    "project-summary",
    "roadmap",
    "gate",
    "effort",
    "asset",
    "authority",
    "alignment-check",
    "planning-review",
    "portal-reference-title",
    "portal-projection-state",
  ]),
  audit: new Set([
    "project-summary",
    "alignment-check",
    "planning-review",
    "portal-projection-state",
    "portal-audit",
  ]),
  lineage: new Set([
    "project-summary",
    "project-brief",
    "portal-projection-state",
    "portal-roadmap-index",
    "portal-audit",
  ]),
};

const candidateFor = (snapshot: ProjectSnapshot): ProjectReadModelCandidate =>
  compileProjectReadModel({
    snapshot,
    basisFingerprint: snapshot.basis.sitemapFingerprint,
    basisInputs: [],
    basisObservations: [],
    assetContentObservations: [],
  });

export const projectRowEnvelope = (input: {
  readonly snapshot: ProjectSnapshot;
  readonly section: PortalProjectSection;
  readonly entryId: string;
  readonly displayName?: string;
  readonly target?: PlanningLineageSubject | undefined;
}) => {
  const candidate = candidateFor(input.snapshot);
  const kinds = sectionKinds[input.section];
  const subjectReference = (subject: PlanningLineageSubject): string =>
    subject.kind === "native-scope" || subject.kind === "native-subject"
      ? `${subject.kind}:${subject.id}`
      : subject.id;
  const contexts = candidate.subjectContexts.map((row) => JSON.parse(row.payload));
  const target = input.target;
  const dossier =
    target === undefined
      ? undefined
      : contexts.find(
          (context) => context.identity.kind === target.kind && context.identity.id === target.id,
        );
  const references = new Set<string>(
    dossier === undefined
      ? []
      : [
          subjectReference(dossier.identity),
          ...dossier.parentPath.ancestors.map(subjectReference),
          ...dossier.relations.flatMap(
            (relation: { state: string; targets?: { subject?: PlanningLineageSubject }[] }) =>
              relation.state === "present"
                ? (relation.targets ?? []).flatMap((target) =>
                    target.subject === undefined ? [] : [subjectReference(target.subject)],
                  )
                : [],
          ),
        ],
  );
  const lineage =
    input.section === "lineage"
      ? contexts.filter((context) => references.has(subjectReference(context.identity)))
      : [];
  const nativeTargetState = (() => {
    if (
      input.section !== "lineage" ||
      target === undefined ||
      (target.kind !== "native-scope" && target.kind !== "native-subject") ||
      dossier !== undefined
    ) {
      return undefined;
    }
    if (target.kind === "native-subject") return "unavailable" as const;
    const bindingKey = `matt-skills/v1\0${target.id}`;
    const observations = new Map(
      [
        ...input.snapshot.providerObservations,
        ...input.snapshot.nativeScopeInspections.observations,
      ]
        .filter((observation) => mattNativeScopeKey(observation.binding) === bindingKey)
        .map((observation) => [mattNativeScopeKey(observation.binding), observation]),
    );
    const selections = [
      ...input.snapshot.providerObservationSelections,
      ...input.snapshot.nativeScopeInspections.selections,
    ].filter((selection) => mattNativeScopeKey(selection) === bindingKey);
    return observations.size > 0 &&
      [...observations.values()].every((observation) =>
        hasCompleteMattNativeEvidence(observation, selections),
      )
      ? ("covered-missing" as const)
      : ("unavailable" as const);
  })();
  const evidenceReferences = [...references].flatMap((reference) => [
    `portal-native-evidence:bound:${reference}`,
    `portal-native-evidence:detail:${reference}`,
    `portal-reference-title:${reference.replace(/^native-(?:scope|subject):/u, "")}`,
  ]);
  const objects = candidate.objects
    .filter(
      (row) =>
        kinds.has(row.kind) ||
        (input.section === "lineage" &&
          (references.has(row.reference) || evidenceReferences.includes(row.reference))),
    )
    .map((row) => ({ kind: row.kind, value: JSON.parse(row.payload) }));
  const attention =
    input.section === "overview" ? candidate.attention.map((row) => JSON.parse(row.payload)) : [];
  const sourceReferences = new Set<string>();
  const diagnosticReferences = new Set<string>();
  const collectReferences = (value: unknown, key?: string): void => {
    if (typeof value === "string") {
      if (/^source:[0-9a-f]{64}$/u.test(value)) sourceReferences.add(value);
      if (key === "diagnosticReference") diagnosticReferences.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) collectReferences(item);
    } else if (typeof value === "object" && value !== null) {
      for (const [childKey, child] of Object.entries(value)) collectReferences(child, childKey);
    }
  };
  if (input.section !== "audit") {
    collectReferences(objects);
    collectReferences(lineage);
    collectReferences(attention);
  }
  const diagnosticTargets = new Set([
    ...objects.map((object) => object.value.id),
    ...references,
    ...sourceReferences,
  ]);
  const diagnostics = candidate.diagnostics
    .map((row) => JSON.parse(row.payload))
    .filter(
      (diagnostic) =>
        (input.section === "overview" || input.section === "lineage") &&
        (diagnosticTargets.has(diagnostic.target) ||
          diagnosticReferences.has(diagnostic.reference)),
    );
  collectReferences(diagnostics);
  const sources = candidate.sources
    .map((row) => JSON.parse(row.payload))
    .filter((source) => sourceReferences.has(source.reference));
  return portalProjectReadEnvelopeSchema.parse({
    version: 1,
    state: "ready",
    project: {
      entryId: input.entryId,
      displayName: input.displayName ?? "Bearing fixture",
      availability: "available",
    },
    rows: {
      section: input.section,
      ...(input.section === "lineage" && input.target !== undefined
        ? { target: input.target }
        : {}),
      ...(nativeTargetState === undefined ? {} : { nativeTargetState }),
      objects,
      lineage,
      attentionCount: candidate.attention.length,
      attention,
      diagnostics,
      sources,
    },
    session: { csrfToken: "ticket-11-csrf" },
  });
};

export const projectSectionFromRequest = (url: string): PortalProjectSection =>
  portalProjectSectionSchema.parse(new URL(url).searchParams.get("section"));

export const projectTargetFromRequest = (url: string): PlanningLineageSubject | undefined => {
  const parameters = new URL(url).searchParams;
  const kind = parameters.get("targetKind");
  const id = parameters.get("targetId");
  return kind === null && id === null
    ? undefined
    : planningLineageSubjectSchema.parse({ kind, id });
};

export const projectFindEnvelope = (snapshot: ProjectSnapshot, entryId: string, query: string) => {
  const index = buildProjectFindIndex(snapshot, entryId);
  return {
    version: 1 as const,
    state: "ready" as const,
    results: index.search(query),
    scopeState: index.scopeState,
  };
};
