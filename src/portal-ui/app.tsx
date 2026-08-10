import { useSyncExternalStore } from "react";
import { CatalogPage } from "./catalog";
import { ProjectPage } from "./project-page";
import { parsePortalRoute } from "./project-route";

const NAVIGATION_EVENT = "bearing:navigate";
const currentLocation = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;
const subscribeToPathname = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATION_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATION_EVENT, listener);
  };
};

export function App() {
  const location = useSyncExternalStore(subscribeToPathname, currentLocation, currentLocation);
  const url = new URL(location, window.location.origin);
  const route = parsePortalRoute(url.pathname, url.search, url.hash);
  if (route.kind === "catalog") return <CatalogPage />;
  return (
    <ProjectPage
      key={route.entryId}
      entryId={route.entryId}
      filteredView={route.filteredView}
      semanticAnchor={route.semanticAnchor}
      section={route.section}
      subject={route.subject}
      onNavigate={(href) => {
        window.history.pushState({}, "", href);
        window.dispatchEvent(new Event(NAVIGATION_EVENT));
      }}
    />
  );
}
