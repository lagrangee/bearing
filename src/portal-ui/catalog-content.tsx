import type { PortalCatalogEntry, PortalCatalogEnvelope } from "../portal-catalog-wire";
import { assertNever } from "./assert-never";
import { CatalogList } from "./catalog-entries";
import { Action, EmptyState, LoadingState } from "./primitives";

export type CatalogLoadState =
  | { readonly kind: "checking" }
  | { readonly kind: "loaded"; readonly catalog: PortalCatalogEnvelope }
  | { readonly kind: "failed"; readonly message: string };

type CatalogContentProps = {
  readonly onRefresh: () => void;
  readonly onSelect: (entry: PortalCatalogEntry, trigger: HTMLButtonElement) => void;
  readonly selectedId: string | null;
  readonly state: CatalogLoadState;
};

function ReadyCatalog({
  catalog,
  onSelect,
  selectedId,
}: {
  readonly catalog: PortalCatalogEnvelope;
  readonly onSelect: (entry: PortalCatalogEntry, trigger: HTMLButtonElement) => void;
  readonly selectedId: string | null;
}) {
  if (catalog.entries.length === 0) {
    return (
      <EmptyState
        title="No registered projects"
        detail="Run Bearing reconcile in a repository to add it to this Catalog."
      />
    );
  }
  return (
    <section className="catalog-projects" aria-labelledby="registered-projects-title">
      <div className="section-heading">
        <h2 id="registered-projects-title">Registered projects</h2>
        <span>
          {catalog.entries.length} {catalog.entries.length === 1 ? "project" : "projects"}
        </span>
      </div>
      <CatalogList entries={catalog.entries} selectedId={selectedId} onSelect={onSelect} />
    </section>
  );
}

function DegradedDiagnostic({ message }: { readonly message: string }) {
  return (
    <section
      className="catalog-diagnostic"
      role="status"
      aria-labelledby="catalog-diagnostic-title"
    >
      <p className="eyebrow">Catalog recovery</p>
      <h2 id="catalog-diagnostic-title">Using last-known-good projects</h2>
      <p>{message}</p>
    </section>
  );
}

export function CatalogContent({ onRefresh, onSelect, selectedId, state }: CatalogContentProps) {
  switch (state.kind) {
    case "checking":
      return <LoadingState />;
    case "failed":
      return (
        <EmptyState
          title="Catalog is unavailable"
          detail={state.message}
          action={
            <Action tone="primary" onClick={onRefresh}>
              Try again
            </Action>
          }
        />
      );
    case "loaded":
      switch (state.catalog.state) {
        case "failed":
          return (
            <EmptyState
              title="Catalog needs repair"
              detail={
                state.catalog.diagnostic?.message ?? "No trustworthy Catalog document is available."
              }
              action={
                <Action tone="primary" onClick={onRefresh}>
                  Try again
                </Action>
              }
            />
          );
        case "ready":
          return (
            <ReadyCatalog catalog={state.catalog} selectedId={selectedId} onSelect={onSelect} />
          );
        case "degraded":
          return (
            <>
              <DegradedDiagnostic message={state.catalog.diagnostic.message} />
              <ReadyCatalog catalog={state.catalog} selectedId={selectedId} onSelect={onSelect} />
            </>
          );
        default:
          return assertNever(state.catalog);
      }
    default:
      return assertNever(state);
  }
}
