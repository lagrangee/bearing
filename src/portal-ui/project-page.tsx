import type { MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { AssetsPage } from "./assets-page";
import { AuditPage } from "./audit-page";
import { Icons } from "./icons";
import { OverviewPage } from "./overview-page";
import { Action, EmptyState, LoadingState } from "./primitives";
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
  onNavigate,
  roadmapId,
  section,
}: {
  readonly entryId: string;
  readonly onNavigate: (href: string) => void;
  readonly roadmapId?: string | undefined;
  readonly section: ProjectSection;
}) {
  const activation = useProjectActivation(entryId);
  const narrow = useNarrowViewport();
  const [navOpen, setNavOpen] = useState(false);
  const [capturedSelection, setCapturedSelection] =
    useState<CapturedProjectInspectorSelection | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const view = activation.view;
  const snapshot = snapshotFor(view);
  const inspectorContext = {
    entryId,
    roadmapId,
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
  const inspect = (next: ProjectInspectorSelection, trigger: HTMLButtonElement) => {
    inspectorTriggerRef.current = trigger;
    setCapturedSelection(captureProjectInspectorSelection(next, inspectorContext));
  };
  const openRoadmap = (href: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onNavigate(href);
  };
  const runSync = () => {
    if (activation.state.kind === "failed") activation.retry();
    else activation.forceSync();
  };

  useEffect(() => {
    if (capturedSelection !== null && selection === null) {
      const trigger = inspectorTriggerRef.current;
      setCapturedSelection(null);
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
        if (inspectorTriggerRef.current === trigger) inspectorTriggerRef.current = null;
      });
    }
  }, [capturedSelection, selection]);

  let content: ReactNode;
  if (snapshot !== undefined) {
    content =
      section === "overview" ? (
        <OverviewPage
          entryId={entryId}
          onInspect={inspect}
          onOpenRoadmap={openRoadmap}
          snapshot={snapshot}
        />
      ) : section === "roadmaps" ? (
        <RoadmapsPage
          entryId={entryId}
          onInspect={inspect}
          onNavigate={onNavigate}
          roadmapId={roadmapId}
          snapshot={snapshot}
        />
      ) : section === "assets" ? (
        <AssetsPage onInspect={inspect} snapshot={snapshot} />
      ) : (
        <AuditPage onInspect={inspect} snapshot={snapshot} />
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
        onNavigate={(_next, href) => onNavigate(href)}
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
          onClose={() => setCapturedSelection(null)}
          returnFocusRef={inspectorTriggerRef}
          selection={selection}
        />
      )}
    </div>
  );
}
