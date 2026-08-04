import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PortalCatalogEnvelope } from "../src/portal-catalog-wire";
import { CatalogContent } from "../src/portal-ui/catalog-content";

const renderCatalog = (catalog: PortalCatalogEnvelope): string =>
  renderToStaticMarkup(
    createElement(CatalogContent, {
      state: { kind: "loaded", catalog },
      onRefresh: () => {},
    }),
  );

const session = { csrfToken: "catalog-content-test-token" };

test("renders a scoped degraded diagnostic without hiding trusted entries", () => {
  const markup = renderCatalog({
    version: 1,
    state: "degraded",
    entries: [
      {
        entryId: "entry-bearing",
        displayName: "Bearing",
        repoRoot: "/tmp/bearing",
        availability: "available",
      },
    ],
    diagnostic: {
      code: "catalog-current-invalid",
      message: "Project Catalog is degraded; only previously trusted entries are shown.",
    },
    session,
  });

  expect(markup).toContain("Catalog is degraded");
  expect(markup).toContain("Bearing");
  expect(markup).toContain("Registered projects");
  expect(markup).toContain('href="/projects/entry-bearing"');
  expect(markup).not.toContain("Try again");
});

test("keeps an unusable Catalog on the typed maintenance surface", () => {
  const markup = renderCatalog({
    version: 1,
    state: "failed",
    entries: [],
    diagnostic: {
      code: "catalog-unusable",
      message: "No trustworthy Project Catalog is available.",
    },
    session,
  });

  expect(markup).toContain("Catalog is unavailable");
  expect(markup).toContain("Try again");
  expect(markup).not.toContain("Registered projects");
});
