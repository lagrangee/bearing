import { useEffect, useRef, useState } from "react";
import { assertNever } from "./assert-never";
import { CatalogResponseError, readCatalog } from "./catalog-client";
import type { CatalogLoadState } from "./catalog-content";
import { CatalogContent } from "./catalog-content";
import { EntryInspector } from "./catalog-entries";
import { CatalogShell } from "./shell";

function selectedEntry(state: CatalogLoadState, selectedId: string | null) {
  switch (state.kind) {
    case "checking":
    case "failed":
      return undefined;
    case "loaded":
      return state.catalog.entries.find((entry) => entry.entryId === selectedId);
    default:
      return assertNever(state);
  }
}

export function CatalogPage() {
  const [requestGeneration, setRequestGeneration] = useState(0);
  const [state, setState] = useState<CatalogLoadState>({ kind: "checking" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeRequest = useRef<Readonly<{
    controller: AbortController;
    generation: number;
  }> | null>(null);
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const request = { controller, generation: requestGeneration } as const;
    activeRequest.current = request;
    setState({ kind: "checking" });
    void readCatalog(controller.signal)
      .then((catalog) => {
        if (controller.signal.aborted || activeRequest.current !== request) return;
        setState({ kind: "loaded", catalog });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || activeRequest.current !== request) return;
        const message =
          error instanceof CatalogResponseError ? error.message : "Catalog could not be loaded.";
        setState({ kind: "failed", message });
      });
    return () => {
      controller.abort();
      if (activeRequest.current === request) activeRequest.current = null;
    };
  }, [requestGeneration]);

  const selected = selectedEntry(state, selectedId);
  const refresh = () => {
    activeRequest.current?.controller.abort();
    activeRequest.current = null;
    setState({ kind: "checking" });
    setRequestGeneration((current) => current + 1);
  };

  return (
    <CatalogShell
      inspector={
        selected ? (
          <EntryInspector
            entry={selected}
            onClose={() => setSelectedId(null)}
            returnFocusRef={selectionTrigger}
          />
        ) : undefined
      }
      onRefresh={refresh}
      refreshing={state.kind === "checking"}
      title="Registered projects"
    >
      <div className="catalog-page">
        <header className="catalog-header">
          <p className="eyebrow">Project catalog</p>
          <h1>Choose a project to orient</h1>
          <p>
            Only repositories explicitly registered through Bearing setup or reconcile appear here.
          </p>
        </header>
        <CatalogContent
          state={state}
          selectedId={selectedId}
          onRefresh={refresh}
          onSelect={(entry, trigger) => {
            selectionTrigger.current = trigger;
            setSelectedId(entry.entryId);
          }}
        />
      </div>
    </CatalogShell>
  );
}
