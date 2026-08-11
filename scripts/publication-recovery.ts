export type Observed<T> =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "available"; value: T }>
  | Readonly<{ kind: "unverifiable"; reason: string }>;

export type FrozenPublicationAsset = Readonly<{
  path: string;
  name: string;
  size: number;
  sha256: string;
}>;

export type FrozenPublication = Readonly<{
  packageName: string;
  version: string;
  sourceCommit: string;
  artifactPath: string;
  npmShasum: string;
  npmIntegrity: string;
  releaseTag: string;
  releaseTitle: string;
  releaseNotesPath: string;
  releaseNotes: string;
  releaseAssets: readonly FrozenPublicationAsset[];
}>;

export type PublicationObservation = Readonly<{
  package:
    | Readonly<{ kind: "absent" }>
    | Readonly<{ kind: "present" }>
    | Readonly<{ kind: "unverifiable"; reason: string }>;
  npmVersion: Observed<
    Readonly<{
      name: string;
      version: string;
      shasum: string;
      integrity: string;
      latest: string;
      provenanceUrl?: string;
      provenancePredicateType?: string;
    }>
  >;
  tag: Observed<Readonly<{ tag: string; targetCommit: string }>>;
  release: Observed<
    Readonly<{
      tag: string;
      title: string;
      notes: string;
      draft: boolean;
      prerelease: boolean;
      assets: readonly Readonly<{ name: string; size: number; sha256: string }>[];
    }>
  >;
}>;

export interface PublicationSurfaces {
  inspect(): Promise<PublicationObservation>;
  publishNpm(candidate: FrozenPublication, authority: "bootstrap" | "trusted"): Promise<void>;
  smokeInstalledPackage(candidate: FrozenPublication): Promise<void>;
  createTag(candidate: FrozenPublication): Promise<void>;
  createRelease(candidate: FrozenPublication): Promise<void>;
}

type ClassifiedState = "absent" | "exact" | "conflicting" | "unverifiable";

const sameAssets = (
  observed: readonly Readonly<{ name: string; size: number; sha256: string }>[],
  expected: readonly FrozenPublicationAsset[],
): boolean => {
  const left = [...observed].sort((a, b) => a.name.localeCompare(b.name));
  const right = [...expected].sort((a, b) => a.name.localeCompare(b.name));
  return (
    left.length === right.length &&
    left.every(
      (asset, index) =>
        asset.name === right[index]?.name &&
        asset.size === right[index]?.size &&
        asset.sha256 === right[index]?.sha256,
    )
  );
};

const classify = (
  candidate: FrozenPublication,
  observation: PublicationObservation,
): Readonly<{
  package: "absent" | "present" | "unverifiable";
  npmVersion: ClassifiedState;
  tag: ClassifiedState;
  release: ClassifiedState;
}> => ({
  package: observation.package.kind,
  npmVersion:
    observation.npmVersion.kind !== "available"
      ? observation.npmVersion.kind
      : observation.npmVersion.value.name === candidate.packageName &&
          observation.npmVersion.value.version === candidate.version &&
          observation.npmVersion.value.shasum === candidate.npmShasum &&
          observation.npmVersion.value.integrity === candidate.npmIntegrity &&
          observation.npmVersion.value.latest === candidate.version &&
          observation.npmVersion.value.provenanceUrl ===
            `https://registry.npmjs.org/-/npm/v1/attestations/${candidate.packageName.replace("/", "%2f")}@${candidate.version}` &&
          observation.npmVersion.value.provenancePredicateType === "https://slsa.dev/provenance/v1"
        ? "exact"
        : "conflicting",
  tag:
    observation.tag.kind !== "available"
      ? observation.tag.kind
      : observation.tag.value.tag === candidate.releaseTag &&
          observation.tag.value.targetCommit === candidate.sourceCommit
        ? "exact"
        : "conflicting",
  release:
    observation.release.kind !== "available"
      ? observation.release.kind
      : observation.release.value.tag === candidate.releaseTag &&
          observation.release.value.title === candidate.releaseTitle &&
          observation.release.value.notes === candidate.releaseNotes &&
          observation.release.value.draft === false &&
          observation.release.value.prerelease === false &&
          sameAssets(observation.release.value.assets, candidate.releaseAssets)
        ? "exact"
        : "conflicting",
});

const inspectPrefix = async (
  candidate: FrozenPublication,
  surfaces: PublicationSurfaces,
): Promise<ReturnType<typeof classify>> => {
  const state = classify(candidate, await surfaces.inspect());
  if (
    state.package === "unverifiable" ||
    state.npmVersion === "unverifiable" ||
    state.tag === "unverifiable" ||
    state.release === "unverifiable"
  ) {
    throw new Error("publication state is unverifiable");
  }
  if (state.npmVersion === "conflicting") throw new Error("npm version conflicts with Candidate");
  if (state.tag === "conflicting") throw new Error("Git tag conflicts with Candidate");
  if (state.release === "conflicting") throw new Error("GitHub Release conflicts with Candidate");
  const prefix = `${state.package}:${state.npmVersion}:${state.tag}:${state.release}`;
  if (
    ![
      "absent:absent:absent:absent",
      "present:absent:absent:absent",
      "present:exact:absent:absent",
      "present:exact:exact:absent",
      "present:exact:exact:exact",
    ].includes(prefix)
  ) {
    throw new Error(`publication state is not an exact monotonic prefix: ${prefix}`);
  }
  return state;
};

export const recoverFrozenPublication = async (
  candidate: FrozenPublication,
  surfaces: PublicationSurfaces,
): Promise<Readonly<{ state: "published" }>> => {
  let state = await inspectPrefix(candidate, surfaces);
  if (state.npmVersion === "absent") {
    if (state.package === "absent") {
      throw new Error("bootstrap step is required for an absent package");
    }
    await surfaces.publishNpm(candidate, "trusted");
    state = await inspectPrefix(candidate, surfaces);
    if (state.npmVersion !== "exact") {
      throw new Error("npm version postcondition is not exact");
    }
  }

  await surfaces.smokeInstalledPackage(candidate);

  state = await inspectPrefix(candidate, surfaces);
  if (state.npmVersion !== "exact") throw new Error("npm version is not exact before tag");
  if (state.tag === "absent") {
    await surfaces.createTag(candidate);
    state = await inspectPrefix(candidate, surfaces);
    if (state.tag !== "exact") throw new Error("Git tag postcondition is not exact");
  }

  state = await inspectPrefix(candidate, surfaces);
  if (state.release === "absent") {
    await surfaces.createRelease(candidate);
  }

  state = await inspectPrefix(candidate, surfaces);
  if (state.npmVersion !== "exact" || state.tag !== "exact" || state.release !== "exact") {
    throw new Error("publication postcondition is not exact");
  }
  return { state: "published" };
};

export const bootstrapFrozenPackage = async (
  candidate: FrozenPublication,
  surfaces: PublicationSurfaces,
): Promise<Readonly<{ state: "bootstrapped" }>> => {
  let state = await inspectPrefix(candidate, surfaces);
  if (state.package !== "absent" || state.npmVersion !== "absent") {
    throw new Error("bootstrap package is not absent");
  }
  await surfaces.publishNpm(candidate, "bootstrap");
  state = await inspectPrefix(candidate, surfaces);
  if (
    state.package !== "present" ||
    state.npmVersion !== "exact" ||
    state.tag !== "absent" ||
    state.release !== "absent"
  ) {
    throw new Error("bootstrap npm postcondition is not an exact publication prefix");
  }
  return { state: "bootstrapped" };
};
