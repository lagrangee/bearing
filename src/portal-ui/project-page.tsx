import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RequestedPlanningLineageFilteredView,
  RequestedPlanningLineageSubject,
} from "../planning-lineage-route";
import { AssetsPage } from "./assets-page";
import { AuditPage } from "./audit-page";
import { Icons } from "./icons";
import { OverviewPage } from "./overview-page";
import { PlanningLineagePage } from "./planning-lineage-page";
import { Action, EmptyState, LoadingState } from "./primitives";
import {
  captureProjectCanvasReturn,
  projectCanvasFocusKey,
  restoreProjectCanvas,
} from "./project-canvas-history";
import { ProjectContextInspector, type ProjectInspectorSelection } from "./project-inspector";
import {
  type CapturedProjectInspectorSelection,
  captureProjectInspectorSelection,
  currentProjectInspectorSelection,
} from "./project-inspector-state";
import { ProjectNavigation, type ProjectSection } from "./project-navigation";
import { cacheStateCopy, snapshotFor, snapshotTitle } from "./project-page-read-model";
import { ProjectTopbar } from "./project-topbar";
import { RoadmapsPage } from "./roadmaps-page";
import { useNarrowViewport } from "./use-narrow";
import { useProjectActivation } from "./use-project-activation";

export function ProjectPage({
  entryId,
  filteredView,
  onNavigate,
  semanticAnchor,
  section,
  subject,
}: {
  readonly entryId: string;
  readonly filteredView?: RequestedPlanningLineageFilteredView | undefined;
  readonly onNavigate: (href: string) => void;
  readonly semanticAnchor?: string | undefined;
  readonly section: ProjectSection;
  readonly subject?: RequestedPlanningLineageSubject | undefined;
}) {
  const activation = useProjectActivation(entryId);
  const narrow = useNarrowViewport();
  const [navOpen, setNavOpen] = useState(false);
  const [capturedSelection, setCapturedSelection] =
    useState<CapturedProjectInspectorSelection | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const inspectorHistoryTokenRef = useRef<string | null>(null);
  const inspectorScrollRef = useRef(0);
  const view = activation.view;
  const snapshot = snapshotFor(view);
  const routeIdentity =
    section === "lineage" ? JSON.stringify({ subject, filteredView, semanticAnchor }) : section;
  const inspectorContext = {
    entryId,
    routeIdentity: section === "lineage" ? routeIdentity : undefined,
    section,
    snapshotFingerprint: snapshot?.basis.sitemapFingerprint,
  };
  const selection = currentProjectInspectorSelection(capturedSelection, inspectorContext);
  const projectLabel =
    view?.project.displayName ??
    (activation.state.kind === "unavailable"
      ? activation.state.project.displayName
      : "Loading project");
  const projectTitle = snapshotTitle(snapshot) ?? projectLabel;
  const overlayOpen = narrow && (navOpen || selection !== null);
  const currentFocusKey = (): string | undefined =>
    document.activeElement instanceof HTMLElement
      ? projectCanvasFocusKey(document.activeElement)
      : undefined;
  const navigateFromProject = (href: string, focusKey = currentFocusKey()) => {
    captureProjectCanvasReturn(entryId, section, focusKey);
    onNavigate(href);
  };
  const inspect = (next: ProjectInspectorSelection, trigger: HTMLButtonElement) => {
    const token = `inspector:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    inspectorTriggerRef.current = trigger;
    inspectorHistoryTokenRef.current = token;
    inspectorScrollRef.current = window.scrollY;
    window.history.pushState(
      {
        ...(typeof window.history.state === "object" && window.history.state !== null
          ? window.history.state
          : {}),
        bearingInspector: { entryId, token },
      },
      "",
      window.location.href,
    );
    setCapturedSelection(captureProjectInspectorSelection(next, inspectorContext));
  };
  const dismissInspector = useCallback(() => {
    const trigger = inspectorTriggerRef.current;
    setCapturedSelection(null);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: inspectorScrollRef.current });
      if (trigger?.isConnected) trigger.focus();
      if (inspectorTriggerRef.current === trigger) inspectorTriggerRef.current = null;
    });
  }, []);
  const closeInspector = () => {
    const marker =
      typeof window.history.state === "object" && window.history.state !== null
        ? (window.history.state as { bearingInspector?: { token?: string } }).bearingInspector
        : undefined;
    if (
      inspectorHistoryTokenRef.current !== null &&
      marker?.token === inspectorHistoryTokenRef.current
    ) {
      window.history.back();
      return;
    }
    dismissInspector();
  };
  const openInspectorDetail = (href: string) => {
    captureProjectCanvasReturn(
      entryId,
      section,
      projectCanvasFocusKey(inspectorTriggerRef.current),
    );
    const state =
      typeof window.history.state === "object" && window.history.state !== null
        ? { ...(window.history.state as Record<string, unknown>) }
        : {};
    delete state["bearingInspector"];
    window.history.replaceState(state, "", window.location.href);
    inspectorHistoryTokenRef.current = null;
    setCapturedSelection(null);
    onNavigate(href);
  };
  const openRoadmap = (href: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigateFromProject(href);
  };
  const runSync = () => {
    if (activation.state.kind === "failed") activation.retry();
    else activation.forceSync();
  };

  useEffect(() => {
    if (capturedSelection !== null && selection === null) {
      dismissInspector();
    }
  }, [capturedSelection, dismissInspector, selection]);

  useEffect(() => {
    const closeFromHistory = () => {
      if (capturedSelection !== null) {
        inspectorHistoryTokenRef.current = null;
        dismissInspector();
      }
    };
    window.addEventListener("popstate", closeFromHistory);
    return () => window.removeEventListener("popstate", closeFromHistory);
  }, [capturedSelection, dismissInspector]);

  useEffect(() => {
    if (snapshot === undefined) return undefined;
    void routeIdentity;
    return restoreProjectCanvas(entryId, section);
  }, [entryId, routeIdentity, section, snapshot]);

  let content: ReactNode;
  if (snapshot !== undefined) {
    content =
      section === "overview" ? (
        <OverviewPage
          entryId={entryId}
          onInspect={inspect}
          onNavigate={navigateFromProject}
          onOpenRoadmap={openRoadmap}
          snapshot={snapshot}
        />
      ) : section === "roadmaps" ? (
        <RoadmapsPage
          entryId={entryId}
          onInspect={inspect}
          onNavigate={navigateFromProject}
          snapshot={snapshot}
        />
      ) : section === "assets" ? (
        <AssetsPage
          entryId={entryId}
          onInspect={inspect}
          onNavigate={navigateFromProject}
          snapshot={snapshot}
        />
      ) : section === "audit" ? (
        <AuditPage entryId={entryId} onInspect={inspect} snapshot={snapshot} />
      ) : subject === undefined ? (
        <div className="page project-state-page">
          <EmptyState
            title="Planning Lineage route unavailable"
            detail="The requested subject identity is missing from this route."
          />
        </div>
      ) : (
        <PlanningLineagePage
          entryId={entryId}
          filteredView={filteredView}
          onInspect={inspect}
          onNavigate={navigateFromProject}
          requested={subject}
          semanticAnchor={semanticAnchor}
          snapshot={snapshot}
        />
      );
  } else if (activation.state.kind === "unavailable") {
    content = (
      <div className="page project-state-page">
        <EmptyState
          title="Project is unavailable"
          detail={activation.state.diagnostic.message}
          action={
            <a className="action action-quiet" href="/">
              Return to Project Catalog
            </a>
          }
        />
      </div>
    );
  } else if (view !== undefined) {
    const copy = cacheStateCopy(view);
    content = (
      <div className="page project-state-page">
        <EmptyState
          title={copy.title}
          detail={copy.detail}
          action={
            <Action tone="primary" data-project-activation-action="manual" onClick={runSync}>
              <Icons.refresh /> Sync project
            </Action>
          }
        />
      </div>
    );
  } else if (activation.state.kind === "failed") {
    content = (
      <div className="page project-state-page">
        <EmptyState
          title="Project could not be loaded"
          detail={activation.state.error.message}
          action={
            <Action data-project-activation-action="manual" onClick={activation.retry}>
              Retry
            </Action>
          }
        />
      </div>
    );
  } else {
    content = (
      <div className="page project-state-page">
        <LoadingState />
      </div>
    );
  }

  return (
    <div
      className={`portal-shell${navOpen ? " nav-open" : ""}${selection ? " has-inspector" : ""}`}
    >
      <ProjectTopbar
        attentionCount={snapshot?.attention.length}
        lastSyncedAt={view?.cache.receipt?.completedAt}
        menuRef={menuRef}
        navOpen={navOpen}
        onOpenNavigation={() => setNavOpen(true)}
        onSync={runSync}
        projectLabel={projectLabel}
        projectTitle={projectTitle}
        state={activation.state}
        suspended={overlayOpen}
      />
      <ProjectNavigation
        activeSection={section}
        basePath={`/projects/${encodeURIComponent(entryId)}`}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onNavigate={(_next, href) => navigateFromProject(href)}
        projectTitle={projectLabel}
        returnFocusRef={menuRef}
        suspended={narrow && selection !== null}
      />
      <main
        id="main-content"
        className="project-main"
        inert={overlayOpen}
        aria-hidden={overlayOpen}
      >
        <p className="mobile-truth-boundary">Read-only normalized snapshot</p>
        {activation.state.kind === "failed" && view !== undefined ? (
          <div className="operation-banner" role="alert">
            <span>
              {activation.state.error.message}
              {snapshot === undefined ? null : " Cached project content remains visible."}
            </span>
            <Action data-project-activation-action="manual" onClick={activation.retry}>
              Retry
            </Action>
          </div>
        ) : null}
        {content}
      </main>
      {selection === null ? null : (
        <ProjectContextInspector
          onClose={closeInspector}
          onOpenFullDetail={openInspectorDetail}
          returnFocusRef={inspectorTriggerRef}
          selection={selection}
        />
      )}
    </div>
  );
}
