import type { RefinementCtx } from "zod";
import { expectedBearingType } from "../artifact-model";
import {
  mattNativeScopeLocator,
  mattNativeScopeSubject,
  mattNativeSubjectForObject,
} from "../providers/matt-skills-v1/native-subject";
import { mattObjectLocator, mattObjects } from "../providers/matt-skills-v1/projection";
import { mattSkillsV1ProviderObservationSchema } from "../providers/matt-skills-v1/schema";
import type { SourceBindingRole, SourceKind } from "./source-schema";

type Collection<T> =
  | Readonly<{ validity: "available"; items: readonly T[] }>
  | Readonly<{ validity: "partial"; items: readonly T[]; issues?: readonly unknown[] }>
  | Readonly<{ validity: "invalid"; issues?: readonly unknown[] }>;
type Singleton<T> =
  | Readonly<{ validity: "available"; value: T }>
  | Readonly<{ validity: "partial"; value: T; issues?: readonly unknown[] }>
  | Readonly<{ validity: "absent" | "invalid" }>;
type IdentifiedSource = Readonly<{ id: string; source: string }>;
type Guidance = IdentifiedSource &
  Readonly<{
    primary: Readonly<{ source: string }>;
    alternatives: readonly Readonly<{ source: string }>[];
  }>;
type SourceRecord = Readonly<{
  reference: string;
  kind: SourceKind;
  displayLocator: string;
  fragment?: string | undefined;
  binding?: Readonly<{ role: SourceBindingRole; identity: string }> | undefined;
}>;

export type SourceBindingConsistencySnapshot = Readonly<{
  summary: Singleton<IdentifiedSource>;
  roadmapIndex: Singleton<Readonly<{ source: string }>>;
  roadmaps: Collection<IdentifiedSource>;
  gates: Collection<IdentifiedSource>;
  efforts: Collection<IdentifiedSource>;
  authorities: Collection<IdentifiedSource>;
  assets: Collection<IdentifiedSource>;
  checks: Collection<IdentifiedSource>;
  reviews: Collection<IdentifiedSource>;
  audit: Singleton<IdentifiedSource>;
  guidance: Singleton<Guidance>;
  providerObservations: readonly unknown[];
  sources: readonly SourceRecord[];
}>;

type ExpectedBinding = Readonly<{
  kind: SourceKind;
  role: SourceBindingRole;
  identity: string;
  bearingType?: string | undefined;
  locator?: string | undefined;
  fragment?: string | undefined;
}>;

const trustedItems = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;
const trustedValue = <T>(singleton: Singleton<T>): T | undefined =>
  singleton.validity === "available" || singleton.validity === "partial"
    ? singleton.value
    : undefined;
const addIssue = (context: RefinementCtx, path: readonly (string | number)[]): void => {
  context.addIssue({
    code: "custom",
    path: [...path, "source"],
    message: "Primary Source provenance must match its role, object identity, and locator.",
  });
};

const validateBinding = (
  index: ReadonlyMap<string, SourceRecord>,
  source: string,
  expected: ExpectedBinding,
  path: readonly (string | number)[],
  context: RefinementCtx,
): void => {
  const record = index.get(source);
  const locatorMatches =
    expected.locator === undefined
      ? expected.bearingType === undefined ||
        expectedBearingType(record?.displayLocator ?? "") === expected.bearingType
      : record?.displayLocator === expected.locator;
  if (
    record === undefined ||
    record.kind !== expected.kind ||
    record.binding?.role !== expected.role ||
    record.binding.identity !== expected.identity ||
    !locatorMatches ||
    record.fragment !== expected.fragment
  ) {
    addIssue(context, path);
  }
};

const validateCanonicalCollection = (
  snapshot: SourceBindingConsistencySnapshot,
  index: ReadonlyMap<string, SourceRecord>,
  name: "roadmaps" | "gates" | "efforts" | "authorities" | "checks" | "reviews",
  role: SourceBindingRole,
  bearingType: string,
  context: RefinementCtx,
): void => {
  for (const [position, item] of trustedItems(snapshot[name]).entries()) {
    validateBinding(
      index,
      item.source,
      { kind: "canonical", role, identity: item.id, bearingType },
      [name, "items", position],
      context,
    );
  }
};

const validateNativeSources = (
  snapshot: SourceBindingConsistencySnapshot,
  index: ReadonlyMap<string, SourceRecord>,
  context: RefinementCtx,
): void => {
  const sourcesByBinding = new Map<string, SourceRecord[]>();
  for (const source of snapshot.sources) {
    if (source.binding === undefined) continue;
    const key = `${source.binding.role}\0${source.binding.identity}`;
    const candidates = sourcesByBinding.get(key) ?? [];
    candidates.push(source);
    sourcesByBinding.set(key, candidates);
  }
  const validateNativeSource = (
    role: SourceBindingRole,
    identity: string,
    locator: string,
    path: readonly (string | number)[],
  ): void => {
    const candidates = sourcesByBinding.get(`${role}\0${identity}`) ?? [];
    if (candidates.length !== 1) {
      addIssue(context, path);
      return;
    }
    const source = candidates[0];
    if (source === undefined) {
      addIssue(context, path);
      return;
    }
    validateBinding(
      index,
      source.reference,
      { kind: "tracker", role, identity, locator },
      path,
      context,
    );
  };

  for (const [observationPosition, input] of snapshot.providerObservations.entries()) {
    const parsed = mattSkillsV1ProviderObservationSchema.safeParse(input);
    if (!parsed.success) continue;
    const observation = parsed.data;
    const scope = mattNativeScopeSubject(observation);
    validateNativeSource("native-scope", scope.id, mattNativeScopeLocator(observation), [
      "providerObservations",
      observationPosition,
      "binding",
    ]);
    for (const [objectPosition, object] of mattObjects(observation).entries()) {
      const subject = mattNativeSubjectForObject(object);
      validateNativeSource(object.kind, subject.id, mattObjectLocator(object), [
        "providerObservations",
        observationPosition,
        "projection",
        object.kind,
        objectPosition,
      ]);
    }
  }
};

export const validateSourceBindingConsistency = (
  snapshot: SourceBindingConsistencySnapshot,
  context: RefinementCtx,
): void => {
  const index = new Map(snapshot.sources.map((source) => [source.reference, source]));
  const summary = trustedValue(snapshot.summary);
  if (summary !== undefined) {
    validateBinding(
      index,
      summary.source,
      {
        kind: "canonical",
        role: "project-summary",
        identity: summary.id,
        bearingType: "project-summary",
      },
      ["summary", "value"],
      context,
    );
  }
  const roadmapIndex = trustedValue(snapshot.roadmapIndex);
  if (roadmapIndex !== undefined) {
    validateBinding(
      index,
      roadmapIndex.source,
      {
        kind: "canonical",
        role: "roadmap-index",
        identity: "roadmap-index:current",
        bearingType: "roadmap-index",
      },
      ["roadmapIndex", "value"],
      context,
    );
  }
  for (const [name, role, bearingType] of [
    ["roadmaps", "roadmap", "roadmap"],
    ["gates", "milestone-gate", "milestone-gate"],
    ["efforts", "effort", "effort"],
    ["authorities", "authority", "authority"],
    ["checks", "alignment-check", "alignment-check"],
    ["reviews", "planning-review", "planning-review"],
  ] as const) {
    validateCanonicalCollection(snapshot, index, name, role, bearingType, context);
  }
  for (const [position, asset] of trustedItems(snapshot.assets).entries()) {
    validateBinding(
      index,
      asset.source,
      {
        kind: "asset",
        role: "asset",
        identity: asset.id,
        bearingType: "asset-registry",
        fragment: asset.id,
      },
      ["assets", "items", position],
      context,
    );
  }
  const audit = trustedValue(snapshot.audit);
  if (audit !== undefined) {
    validateBinding(
      index,
      audit.source,
      {
        kind: "canonical",
        role: "planning-audit",
        identity: audit.id,
        bearingType: "planning-audit",
      },
      ["audit", "value"],
      context,
    );
  }
  validateNativeSources(snapshot, index, context);
  const guidance = trustedValue(snapshot.guidance);
  if (guidance === undefined) return;
  validateBinding(
    index,
    guidance.source,
    {
      kind: "canonical",
      role: "next-work-guidance",
      identity: guidance.id,
      bearingType: "next-work-guidance",
    },
    ["guidance", "value"],
    context,
  );
  const items = [guidance.primary, ...guidance.alternatives];
  for (const [position, item] of items.entries()) {
    const fragment = position === 0 ? "primary" : `alternative-${position}`;
    const path =
      position === 0
        ? (["guidance", "value", "primary"] as const)
        : (["guidance", "value", "alternatives", position - 1] as const);
    validateBinding(
      index,
      item.source,
      {
        kind: "canonical",
        role: "guidance-item",
        identity: `${guidance.id}#${fragment}`,
        bearingType: "next-work-guidance",
        fragment,
      },
      path,
      context,
    );
  }
};
