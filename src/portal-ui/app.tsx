import { useSyncExternalStore } from "react";
import { CatalogPage } from "./catalog";
import { ProjectPage } from "./project-page";
import { parsePortalRoute } from "./project-route";

const NAVIGATION_EVENT = "bearing:navigate";
const currentPathname = () => window.location.pathname;
const subscribeToPathname = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATION_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATION_EVENT, listener);
  };
};

export function App() {
  const pathname = useSyncExternalStore(subscribeToPathname, currentPathname, currentPathname);
  const route = parsePortalRoute(pathname);
  if (route.kind === "catalog") return <CatalogPage />;
  return (
    <ProjectPage
      key={route.entryId}
      entryId={route.entryId}
      roadmapId={route.roadmapId}
      section={route.section}
      onNavigate={(href) => {
        window.history.pushState({}, "", href);
        window.dispatchEvent(new Event(NAVIGATION_EVENT));
      }}
    />
  );
}
