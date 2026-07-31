import type { PlanningLineageSubject } from "../../planning-lineage-route";
import type { MattSkillsV1ProviderObservation } from "./capture";
import { decodeGitHubMattNativeScope, githubMattNativeScopeIdentity } from "./github-native-scope";
import type { MattObservationView, MattProjectedObject } from "./projection";
import { mattObjects } from "./projection";

export type MattNativeScopeBinding = Readonly<{
  provider: "matt-skills/v1";
  nativeScope: string;
}>;

export type MattNativeSubject = Extract<
  PlanningLineageSubject,
  { kind: "native-scope" | "native-subject" }
>;

export const mattNativeSubjectForObject = (object: MattProjectedObject): MattNativeSubject => ({
  kind: "native-subject",
  id: object.ref,
});

export const mattNativeScopeIdentity = (
  observation: Pick<MattSkillsV1ProviderObservation | MattObservationView, "binding">,
): string => {
  const github = decodeGitHubMattNativeScope(observation.binding.nativeScope);
  return github === undefined
    ? observation.binding.nativeScope
    : githubMattNativeScopeIdentity(github);
};

export const mattNativeScopeKey = (binding: MattNativeScopeBinding): string =>
  `${binding.provider}\0${mattNativeScopeIdentity({ binding })}`;

export const sameMattNativeScope = (
  left: MattNativeScopeBinding,
  right: MattNativeScopeBinding,
): boolean => mattNativeScopeKey(left) === mattNativeScopeKey(right);

export const sameMattNativeLocator = (
  left: MattNativeScopeBinding,
  right: MattNativeScopeBinding,
): boolean => {
  if (left.provider !== right.provider) return false;
  const leftGitHub = decodeGitHubMattNativeScope(left.nativeScope);
  const rightGitHub = decodeGitHubMattNativeScope(right.nativeScope);
  if (leftGitHub === undefined || rightGitHub === undefined) {
    return left.nativeScope === right.nativeScope;
  }
  return (
    leftGitHub.host === rightGitHub.host &&
    leftGitHub.repository.owner === rightGitHub.repository.owner &&
    leftGitHub.repository.name === rightGitHub.repository.name &&
    leftGitHub.root.objectKind === rightGitHub.root.objectKind &&
    leftGitHub.root.number === rightGitHub.root.number
  );
};

export const sameMattNativeBindingDefinition = (
  left: MattNativeScopeBinding,
  right: MattNativeScopeBinding,
): boolean => {
  if (!sameMattNativeScope(left, right)) return false;
  const leftGitHub = decodeGitHubMattNativeScope(left.nativeScope);
  const rightGitHub = decodeGitHubMattNativeScope(right.nativeScope);
  if (leftGitHub === undefined || rightGitHub === undefined) {
    return left.nativeScope === right.nativeScope;
  }
  return (
    leftGitHub.rootKind === rightGitHub.rootKind &&
    leftGitHub.root.objectKind === rightGitHub.root.objectKind
  );
};

export const mattNativeScopeTitle = (
  observation: Pick<MattSkillsV1ProviderObservation | MattObservationView, "binding">,
): string => {
  const github = decodeGitHubMattNativeScope(observation.binding.nativeScope);
  if (github === undefined) return observation.binding.nativeScope;
  const kind = github.root.objectKind === "issue" ? "issue" : "pull request";
  return `${github.repository.owner}/${github.repository.name} ${kind} #${github.root.number}`;
};

export const mattNativeScopeLocator = (
  observation: Pick<MattSkillsV1ProviderObservation | MattObservationView, "binding">,
): string => {
  const github = decodeGitHubMattNativeScope(observation.binding.nativeScope);
  if (github === undefined) return observation.binding.nativeScope;
  const route = github.root.objectKind === "issue" ? "issues" : "pulls";
  return `github/${github.repository.owner}/${github.repository.name}/${route}/${github.root.number}`;
};

export const mattNativeScopeSubject = (
  observation: Pick<MattSkillsV1ProviderObservation | MattObservationView, "binding">,
): MattNativeSubject => ({
  kind: "native-scope",
  id: mattNativeScopeIdentity(observation),
});

export const mattNativeObjectForSubject = (
  observations: readonly (MattSkillsV1ProviderObservation | MattObservationView)[],
  subject: MattNativeSubject,
): MattProjectedObject | undefined => {
  if (subject.kind === "native-scope") return undefined;
  return observations
    .flatMap((observation) => mattObjects(observation))
    .find((object) => {
      const identity = mattNativeSubjectForObject(object);
      return identity.kind === subject.kind && identity.id === subject.id;
    });
};

export const mattNativeObservationForSubject = (
  observations: readonly (MattSkillsV1ProviderObservation | MattObservationView)[],
  subject: MattNativeSubject,
): MattSkillsV1ProviderObservation | MattObservationView | undefined =>
  observations.find((observation) => {
    if (mattNativeScopeSubject(observation).id === subject.id && subject.kind === "native-scope") {
      return true;
    }
    return mattObjects(observation).some((object) => {
      const identity = mattNativeSubjectForObject(object);
      return identity.kind === subject.kind && identity.id === subject.id;
    });
  });
