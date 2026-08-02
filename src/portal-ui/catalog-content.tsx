import type { PortalCatalogEnvelope } from "../portal-catalog-wire";
import { assertNever } from "./assert-never";
import { CatalogList } from "./catalog-entries";
import { Action, EmptyState, LoadingState } from "./primitives";

export type CatalogLoadState =
  | { readonly kind: "checking" }
  | { readonly kind: "loaded"; readonly catalog: PortalCatalogEnvelope }
  | { readonly kind: "failed"; readonly message: string };

type CatalogContentProps = {
  readonly onRefresh: () => void;
  readonly state: CatalogLoadState;
};

function ReadyCatalog({ catalog }: { readonly catalog: PortalCatalogEnvelope }) {
  if (catalog.entries.length === 0) {
    return (
      <EmptyState
        title="No registered projects"
        detail="Run Bearing reconcile in a repository to add it to this Catalog."
      />
    );
  }
  return (
    <section className="catalog-projects" aria-label="Registered projects">
      <div className="section-heading">
        <span>
          {catalog.entries.length} {catalog.entries.length === 1 ? "project" : "projects"}
        </span>
      </div>
      <CatalogList entries={catalog.entries} />
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

export function CatalogContent({ onRefresh, state }: CatalogContentProps) {
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
          return <ReadyCatalog catalog={state.catalog} />;
        case "degraded":
          return (
            <>
              <DegradedDiagnostic message={state.catalog.diagnostic.message} />
              <ReadyCatalog catalog={state.catalog} />
            </>
          );
        default:
          return assertNever(state.catalog);
      }
    default:
      return assertNever(state);
  }
}
