import type { ProjectOperationError, ProjectView } from "./project-contract";
import type { ProjectOperationMode } from "./project-coordinator";
import type { ProjectEntryResult } from "./project-entry";

export type EntryFailure = Exclude<ProjectEntryResult, Readonly<{ kind: "available" }>>;

export type ProjectValidation = Readonly<{
  due: boolean;
  cooldownRemainingMs: number;
  inFlight: boolean;
}>;

export type ProjectReadServiceResult =
  | EntryFailure
  | Readonly<{ kind: "ready"; view: ProjectView; validation: ProjectValidation }>
  | Readonly<{ kind: "read-failed"; error: ProjectOperationError }>;

type Completed = Readonly<{
  kind: "completed";
  reconciliation?: "applied" | "no-op";
  snapshotDisposition: "reused" | "materialized";
  view: ProjectView;
  validation: ProjectValidation;
}>;

export type ProjectSyncServiceResult =
  | EntryFailure
  | (Completed &
      Readonly<{
        mode: "ensure-current";
        outcome: "checked" | "materialized" | "synced";
      }>)
  | (Completed & Readonly<{ mode: "force"; outcome: "applied" | "no-op" }>)
  | Readonly<{
      kind: "cooldown";
      mode: "ensure-current";
      outcome: "cooldown";
      view: ProjectView;
      validation: ProjectValidation;
    }>
  | Readonly<{
      kind: "failed";
      mode: ProjectOperationMode;
      outcome: "failed";
      error: ProjectOperationError;
      validation: ProjectValidation;
      view?: ProjectView;
      viewDisposition?: "discard";
    }>;
