export type ManagedAttentionDiagnostic = Readonly<{
  target: string;
  source?: string | undefined;
}>;

export type ManagedAttentionSource = Readonly<{
  reference: string;
  kind: "canonical" | "tracker" | "asset" | "evidence";
  binding?: Readonly<{ role: string }> | undefined;
}>;

export const targetWithinNativeScope = (target: string, nativeScope: string): boolean =>
  target === nativeScope ||
  target.startsWith(`${nativeScope}/`) ||
  target.startsWith(`${nativeScope}#`);

export const isManagedAttentionDiagnostic = (
  diagnostic: ManagedAttentionDiagnostic,
  sources: readonly ManagedAttentionSource[],
  managedTargets: readonly string[],
): boolean => {
  const source =
    diagnostic.source === undefined
      ? undefined
      : sources.find((candidate) => candidate.reference === diagnostic.source);
  if (source?.binding?.role === "next-work-guidance") return false;
  return (
    source?.kind === "canonical" ||
    managedTargets.some((target) => targetWithinNativeScope(diagnostic.target, target))
  );
};
