import type { ProjectSnapshot } from "../project-snapshot/contract";
import type { ProjectView } from "./project-contract";

export const snapshotFor = (view: ProjectView | undefined): ProjectSnapshot | undefined => {
  if (view === undefined) return undefined;
  switch (view.cache.snapshot.state) {
    case "available":
    case "behind":
      return view.cache.snapshot.snapshot;
    case "missing":
    case "malformed":
    case "version-mismatch":
      return undefined;
  }
};

export const snapshotTitle = (snapshot: ProjectSnapshot | undefined): string | undefined => {
  if (snapshot?.summary.validity === "available" || snapshot?.summary.validity === "partial") {
    return snapshot.summary.value.title;
  }
  return undefined;
};

export const cacheStateCopy = (view: ProjectView): Readonly<{ title: string; detail: string }> => {
  switch (view.cache.snapshot.state) {
    case "available":
    case "behind":
      return { title: "Snapshot available", detail: "The cached project view is ready." };
    case "missing":
      return {
        title: "Project Snapshot is not materialized yet",
        detail: "Run Sync to build the first read-only project view.",
      };
    case "malformed":
      return {
        title: "Project Snapshot needs repair",
        detail: view.cache.snapshot.diagnostic.message,
      };
    case "version-mismatch":
      return {
        title: "Project Snapshot version is unsupported",
        detail: view.cache.snapshot.diagnostic.message,
      };
  }
};
