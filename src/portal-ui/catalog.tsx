import { useEffect, useRef, useState } from "react";
import { CatalogResponseError, readCatalog } from "./catalog-client";
import type { CatalogLoadState } from "./catalog-content";
import { CatalogContent } from "./catalog-content";
import { CatalogShell } from "./shell";

export function CatalogPage() {
  const [requestGeneration, setRequestGeneration] = useState(0);
  const [state, setState] = useState<CatalogLoadState>({ kind: "checking" });
  const activeRequest = useRef<Readonly<{
    controller: AbortController;
    generation: number;
  }> | null>(null);

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

  const refresh = () => {
    activeRequest.current?.controller.abort();
    activeRequest.current = null;
    setState({ kind: "checking" });
    setRequestGeneration((current) => current + 1);
  };

  return (
    <CatalogShell
      onRefresh={refresh}
      refreshing={state.kind === "checking"}
      title="Registered projects"
    >
      <div className="catalog-page">
        <CatalogContent state={state} onRefresh={refresh} />
      </div>
    </CatalogShell>
  );
}
