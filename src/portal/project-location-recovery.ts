import type { NativeScopeInspectionIntent } from "../native-scope-inspection";
import type { ProjectOperationError } from "./project-contract";
import type { CoordinatedResult, ProjectOperationMode } from "./project-coordinator";
import type { AvailableProjectEntry } from "./project-entry";
import type { ProjectMaterializationResult } from "./project-materializer";
import type { EntryFailure } from "./project-service-contract";
import type { ProjectRepoView } from "./project-view";

export type CapturedProjectOperation =
  | Readonly<{ kind: "entry-failure"; result: EntryFailure }>
  | Readonly<{
      kind: "completed";
      entry: AvailableProjectEntry;
      result: ProjectMaterializationResult;
      repoView: ProjectRepoView;
    }>
  | Readonly<{
      kind: "failed";
      entry: AvailableProjectEntry;
      error: ProjectOperationError;
      repoView?: ProjectRepoView;
    }>;

type Execute = (
  entryId: string,
  mode: ProjectOperationMode,
  nativeScopeInspectionIntent: NativeScopeInspectionIntent,
) => Promise<CoordinatedResult<CapturedProjectOperation>>;

type Validation = Readonly<{
  due: boolean;
  cooldownRemainingMs: number;
  inFlight: boolean;
}>;

export const createProjectLocationRecovery = (options: {
  readonly execute: Execute;
  readonly status?: (entryId: string) => Validation;
}) => {
  const recoveries = new Map<
    string,
    Readonly<{
      generation: number;
      promise: Promise<CoordinatedResult<CapturedProjectOperation>>;
    }>
  >();
  const sequences = new Map<string, number>();
  const recentForces = new Map<
    string,
    Readonly<{
      sequence: number;
      capture: Extract<CapturedProjectOperation, Readonly<{ kind: "completed" }>>;
    }>
  >();
  const attemptedRoots = new Map<string, string>();

  const observeLocator = (entryId: string, repoRoot: string): void => {
    attemptedRoots.set(entryId, repoRoot);
  };
  const locatorChanged = (entryId: string, repoRoot: string): boolean =>
    attemptedRoots.get(entryId) !== undefined && attemptedRoots.get(entryId) !== repoRoot;
  const rootRequiringRecovery = (
    entryId: string,
    mode: ProjectOperationMode,
    repoRoot: string,
  ): string | undefined =>
    mode === "ensure-current" && locatorChanged(entryId, repoRoot) ? repoRoot : undefined;
  const validation = (entryId: string, repoRoot?: string): Validation => {
    const base = options.status?.(entryId) ?? {
      due: true,
      cooldownRemainingMs: 0,
      inFlight: false,
    };
    return repoRoot !== undefined && locatorChanged(entryId, repoRoot)
      ? { ...base, due: true, cooldownRemainingMs: 0 }
      : base;
  };

  const checkpoint = (entryId: string): number => sequences.get(entryId) ?? 0;
  const advance = (entryId: string): number => {
    const sequence = checkpoint(entryId) + 1;
    sequences.set(entryId, sequence);
    return sequence;
  };
  const record = (entryId: string, capture: CapturedProjectOperation): CapturedProjectOperation => {
    const sequence = advance(entryId);
    if (capture.kind === "completed" && capture.result.mode === "force") {
      recentForces.set(entryId, { sequence, capture });
    }
    return capture;
  };
  const recover = (
    entryId: string,
    repoRoot: string,
    afterSequence: number,
    nativeScopeInspectionIntent: NativeScopeInspectionIntent = { kind: "none" },
  ): Promise<CoordinatedResult<CapturedProjectOperation>> => {
    const recent = recentForces.get(entryId);
    if (
      nativeScopeInspectionIntent.kind === "none" &&
      recent !== undefined &&
      recent.sequence > afterSequence &&
      recent.sequence === checkpoint(entryId) &&
      recent.capture.entry.repoRoot === repoRoot
    ) {
      return Promise.resolve({
        kind: "completed",
        value: recent.capture,
        executedMode: "force",
        joined: true,
      });
    }
    const key = `${entryId}\0${repoRoot}\0${JSON.stringify(nativeScopeInspectionIntent)}`;
    const existing = recoveries.get(key);
    if (existing !== undefined && existing.generation > afterSequence) return existing.promise;
    const generation = advance(entryId);
    const running = options
      .execute(entryId, "ensure-current", nativeScopeInspectionIntent)
      .then((settled) => {
        if (
          settled.kind === "completed" &&
          settled.value.kind === "completed" &&
          settled.value.entry.repoRoot === repoRoot &&
          settled.value.result.mode === "force"
        ) {
          return settled;
        }
        return options.execute(entryId, "force", nativeScopeInspectionIntent);
      });
    let promise: Promise<CoordinatedResult<CapturedProjectOperation>>;
    const settle = <Value>(continuation: () => Value): Value => {
      if (recoveries.get(key)?.promise === promise) recoveries.delete(key);
      return continuation();
    };
    promise = running.then(
      (value) => settle(() => value),
      (error: unknown) =>
        settle(() => {
          throw error;
        }),
    );
    recoveries.set(key, { generation, promise });
    return promise;
  };
  return { checkpoint, observeLocator, record, recover, rootRequiringRecovery, validation };
};
