import {
  assessSelectedProviderObservationEvidence,
  type ProviderObservationSelection,
} from "../../provider-observation-contract";
import {
  mattNativeScopeSubject,
  mattNativeScopeTitle,
  mattNativeSubjectForObject,
  sameMattNativeBindingDefinition,
} from "./native-subject";
import type { MattObservationView, MattProjectedObject } from "./projection";
import { mattObjects } from "./projection";

type NativeSource = Readonly<{
  reference: string;
  binding?: Readonly<{ role: string; identity: string }> | undefined;
}>;

export type MattNativeScopeRecord = Readonly<{
  recordKind: "native-scope";
  id: string;
  title: string;
  source: string;
  observation: MattObservationView;
}>;

export type MattNativeObjectRecord = Readonly<{
  recordKind: "native-object";
  id: string;
  title: string;
  source: string;
  object: MattProjectedObject;
  observation: MattObservationView;
}>;

export type MattNativeRecord = MattNativeScopeRecord | MattNativeObjectRecord;

const nativeSourceReference = (
  sources: readonly NativeSource[],
  identity: string,
  roles: readonly string[],
): string | undefined =>
  sources.find(
    (source) =>
      source.binding !== undefined &&
      roles.includes(source.binding.role) &&
      source.binding.identity === identity,
  )?.reference;

export const mattNativeRecords = (
  observations: readonly MattObservationView[],
  sources: readonly NativeSource[],
): readonly MattNativeRecord[] =>
  observations.flatMap<MattNativeRecord>((observation): readonly MattNativeRecord[] => {
    const scope = mattNativeScopeSubject(observation);
    const objectRecords: readonly MattNativeObjectRecord[] = mattObjects(observation).flatMap(
      (object) => {
        const subject = mattNativeSubjectForObject(object);
        const source = nativeSourceReference(sources, subject.id, [object.kind]);
        return source === undefined
          ? []
          : [
              {
                recordKind: "native-object",
                id: subject.id,
                title: object.title,
                source,
                object,
                observation,
              },
            ];
      },
    );
    const scopeSource = nativeSourceReference(sources, scope.id, ["native-scope"]);
    return scopeSource === undefined
      ? objectRecords
      : [
          {
            recordKind: "native-scope" as const,
            id: scope.id,
            title: mattNativeScopeTitle(observation),
            source: scopeSource,
            observation,
          },
          ...objectRecords,
        ];
  });

export const assessMattNativeEvidence = (
  observation: MattObservationView,
  selections: readonly ProviderObservationSelection[],
) => {
  const selection = selections.find(
    (candidate) =>
      sameMattNativeBindingDefinition(candidate, observation.binding) &&
      candidate.observationId === observation.id,
  );
  return assessSelectedProviderObservationEvidence(observation, selection);
};

export const hasCompleteMattNativeEvidence = (
  observation: MattObservationView,
  selections: readonly ProviderObservationSelection[],
): boolean => assessMattNativeEvidence(observation, selections).frontierEvidence === "trustworthy";
