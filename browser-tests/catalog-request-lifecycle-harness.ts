import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CatalogPage } from "../src/portal-ui/catalog";

type PendingRequest = Readonly<{
  signal: AbortSignal;
  resolve: (response: Response) => void;
}>;

type CatalogHarness = Readonly<{
  aborted(index: number): boolean;
  captureRefresh(refresh: (() => void) | undefined): void;
  count(): number;
  resolve(index: number, displayName: string): void;
  triggerRefresh(): void;
}>;

declare global {
  interface Window {
    readonly __catalogHarness: CatalogHarness;
  }
}

const requests: PendingRequest[] = [];
let refreshCatalog: (() => void) | undefined;
Object.defineProperty(window, "fetch", {
  value: (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) throw new Error("Catalog request must carry a signal.");
      requests.push({ signal, resolve });
    }),
});

Object.defineProperty(window, "__catalogHarness", {
  value: {
    aborted: (index: number) => requests[index]?.signal.aborted ?? false,
    captureRefresh: (refresh: (() => void) | undefined) => {
      refreshCatalog = refresh;
    },
    count: () => requests.length,
    resolve: (index: number, displayName: string) => {
      const request = requests[index];
      if (request === undefined) throw new Error(`No Catalog request at index ${index}.`);
      request.resolve(
        Response.json({
          version: 1,
          state: "ready",
          session: { csrfToken: "strict-mode-browser-session" },
          entries: [
            {
              entryId: `entry-${index}`,
              displayName,
              repoRoot: `/fixture/${index}`,
              availability: "available",
            },
          ],
        }),
      );
    },
    triggerRefresh: () => {
      if (refreshCatalog === undefined) throw new Error("Catalog refresh seam is unavailable.");
      refreshCatalog();
    },
  } satisfies CatalogHarness,
});

const root = document.getElementById("root");
if (root === null) throw new Error("StrictMode browser harness root is missing.");
createRoot(root).render(createElement(StrictMode, null, createElement(CatalogPage)));
