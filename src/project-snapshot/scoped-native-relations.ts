export type ScopedProjectionIssue = Readonly<{
  code: string;
  target: string;
  source?: string | undefined;
}>;

export type ScopedProjectionCollection = Readonly<{
  validity: "available" | "partial" | "invalid";
  issues?: readonly ScopedProjectionIssue[];
}>;

export type ScopedProjectionSource = Readonly<{
  reference: string;
  displayLocator: string;
}>;

export type ScopedEffortScope = Readonly<{
  source: string;
  nativeScope?: string | undefined;
}>;

export type ScopedProjectionAssessment = Readonly<{
  missingRelationCount: number;
  uncertain: boolean;
}>;

const sourceIndex = (sources: readonly ScopedProjectionSource[]): ReadonlyMap<string, string> =>
  new Map(sources.map((source) => [source.reference, source.displayLocator]));

const inside = (scope: string, locator: string | undefined): boolean =>
  locator !== undefined && (locator === scope || locator.startsWith(`${scope}/`));

const locatorsFor = (
  issue: ScopedProjectionIssue,
  sources: ReadonlyMap<string, string>,
): readonly string[] => {
  const source = sources.get(issue.source ?? "");
  return source === undefined ? [issue.target] : [issue.target, source];
};

const isScopedLocator = (locator: string): boolean => locator.includes("/");

export const isValueAttributedToEffort = (
  value: Readonly<{ target: string; source?: string | undefined }>,
  effort: ScopedEffortScope,
  sources: readonly ScopedProjectionSource[],
): boolean => {
  const index = sourceIndex(sources);
  const scope = effort.nativeScope;
  return (
    scope !== undefined &&
    (inside(scope, value.target) || inside(scope, index.get(value.source ?? "")))
  );
};

export const assessScopedProjectionIssues = (
  collection: ScopedProjectionCollection,
  efforts: readonly ScopedEffortScope[],
  sources: readonly ScopedProjectionSource[],
  options: Readonly<{ unscopableIsUncertain: boolean }>,
): ScopedProjectionAssessment => {
  if (collection.validity === "available" || efforts.length === 0) {
    return { missingRelationCount: 0, uncertain: false };
  }
  const index = sourceIndex(sources);
  const scopes = efforts.flatMap((effort) =>
    effort.nativeScope === undefined ? [] : [effort.nativeScope],
  );
  if (collection.issues === undefined) {
    return { missingRelationCount: 0, uncertain: true };
  }
  let missingRelationCount = 0;
  let hasUnscopableIssue = false;
  for (const issue of collection.issues) {
    const locators = locatorsFor(issue, index);
    if (scopes.some((scope) => locators.some((locator) => inside(scope, locator)))) {
      missingRelationCount += 1;
    } else if (!locators.some(isScopedLocator)) {
      hasUnscopableIssue = true;
    }
  }
  return {
    missingRelationCount,
    uncertain:
      missingRelationCount > 0 ||
      scopes.length !== efforts.length ||
      (options.unscopableIsUncertain && hasUnscopableIssue),
  };
};
