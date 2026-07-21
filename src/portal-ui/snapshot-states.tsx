export type SnapshotState =
  | "checking"
  | "refreshing"
  | "current"
  | "syncing"
  | "updated"
  | "missing"
  | "malformed"
  | "failed";

const snapshotStates = [
  "checking",
  "refreshing",
  "current",
  "syncing",
  "updated",
  "missing",
  "malformed",
  "failed",
] as const;

const snapshotLabels = {
  checking: "Checking",
  refreshing: "Refreshing view",
  current: "Up to date",
  syncing: "Syncing",
  updated: "Updated",
  missing: "Snapshot missing",
  malformed: "Snapshot malformed",
  failed: "Sync failed · retained cache",
} satisfies Readonly<Record<SnapshotState, string>>;

function SnapshotStateMark({ state }: { readonly state: SnapshotState }) {
  return <span className={`snapshot-state snapshot-${state}`}>{snapshotLabels[state]}</span>;
}

export function SnapshotStates() {
  return (
    <div className="snapshot-states">
      {snapshotStates.map((state) => (
        <SnapshotStateMark key={state} state={state} />
      ))}
    </div>
  );
}
