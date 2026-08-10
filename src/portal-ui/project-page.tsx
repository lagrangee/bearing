import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RequestedPlanningLineageFilteredView,
  RequestedPlanningLineageSubject,
} from "../planning-lineage-route";
import { mattNativeObservationForSubject } from "../providers/matt-skills-v1/native-subject";
import { AssetsPage } from "./assets-page";
import { AuditPage } from "./audit-page";
import { OverviewPage } from "./overview-page";
import { PlanningLineagePage } from "./planning-lineage-page";
import { Action, EmptyState, LoadingState } from "./primitives";
import {
  captureProjectCanvasReturn,
  projectCanvasFocusKey,
  restoreProjectCanvas,
} from "./project-canvas-history";
import { ProjectFindDialog } from "./project-find-dialog";
import { ProjectNavigation, type ProjectSection } from "./project-navigation";
import { projectTitle as titleForProject } from "./project-page-read-model";
import { ProjectTopbar } from "./project-topbar";
import { CopyDiagnosticReference, ProviderObservationStatus } from "./provider-observation-status";
import { RoadmapsPage } from "./roadmaps-page";
import { TechnicalDetails, type TechnicalDetailsSelection } from "./technical-details";
import {
  type CapturedTechnicalDetailsSelection,
  captureTechnicalDetailsSelection,
  currentTechnicalDetailsSelection,
} from "./technical-details-state";
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
  const activation = useProjectActivation(
    entryId,
    section,
    subject?.validity === "valid" ? subject.value : undefined,
  );
  const narrow = useNarrowViewport();
  const [navOpen, setNavOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [capturedSelection, setCapturedSelection] =
    useState<CapturedTechnicalDetailsSelection | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const findTriggerRef = useRef<HTMLButtonElement>(null);
  const technicalDetailsTriggerRef = useRef<HTMLElement | null>(null);
  const technicalDetailsHistoryTokenRef = useRef<string | null>(null);
  const technicalDetailsScrollRef = useRef(0);
  const providerActionTriggerRef = useRef<HTMLElement | null>(null);
  const providerActionRouteRef = useRef<string | null>(null);
  const providerStatusRef = useRef<HTMLDivElement>(null);
  const projectReadAttentionRef = useRef<HTMLDivElement>(null);
  const priorProviderStateRef = useRef(activation.providerApplication.state);
  const priorReadFailureRef = useRef(activation.readFailure);
  const view = activation.view;
  const snapshot = view?.data;
  const lineage = snapshot?.section === "lineage" ? snapshot : undefined;
  const requestedNativeSubject =
    subject?.validity === "valid" &&
    (subject.value.kind === "native-scope" || subject.value.kind === "native-subject")
      ? subject.value
      : undefined;
  const effortBinding =
    lineage === undefined || subject?.validity !== "valid" || subject.value.kind !== "effort"
      ? undefined
      : lineage.efforts.validity === "invalid"
        ? undefined
        : lineage.efforts.items.find((effort) => effort.id === subject.value.id)?.workBinding;
  const nativeObservation =
    lineage !== undefined && requestedNativeSubject !== undefined
      ? mattNativeObservationForSubject(lineage.providerObservations, requestedNativeSubject)
      : undefined;
  const providerBinding = effortBinding ?? nativeObservation?.binding;
  const nativeDetailPresent =
    lineage !== undefined &&
    requestedNativeSubject !== undefined &&
    lineage.lineage.subjects.some(
      (candidate) =>
        candidate.identity.kind === requestedNativeSubject.kind &&
        candidate.identity.id === requestedNativeSubject.id,
    );
  const providerBusy = activation.providerApplication.state === "running";
  const providerStructuralAttention =
    activation.providerApplication.state === "settled" &&
    activation.providerApplication.result.state === "attention" &&
    ["storage-recovery-required", "need-update", "removal-required"].includes(
      activation.providerApplication.result.condition,
    );
  const readStructuralAttention =
    activation.readFailure !== undefined &&
    ["project-data-needs-rebuild", "project-data-needs-update"].includes(
      activation.readFailure.code,
    );
  const structuralAttention = providerStructuralAttention || readStructuralAttention;
  const applyProviderObservation = (
    request: Parameters<typeof activation.applyProviderObservation>[0],
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null,
  ) => {
    providerActionTriggerRef.current = returnFocus;
    providerActionRouteRef.current = routeIdentity;
    activation.applyProviderObservation(request);
  };
  const observeCurrentSource = () => {
    if (providerBinding === undefined || requestedNativeSubject === undefined) return;
    applyProviderObservation(
      requestedNativeSubject.kind === "native-subject"
        ? {
            version: 1,
            action: "item-refresh",
            binding: providerBinding,
            subject: requestedNativeSubject.id,
          }
        : { version: 1, action: "source-load", binding: providerBinding },
    );
  };
  const loadEffortSource = () => {
    if (providerBinding === undefined) return;
    applyProviderObservation({
      version: 1,
      action: "source-load",
      binding: providerBinding,
    });
  };
  const routeIdentity =
    section === "lineage" ? JSON.stringify({ subject, filteredView, semanticAnchor }) : section;
  const providerAction =
    activation.providerApplication.state === "idle"
      ? undefined
      : activation.providerApplication.state === "running"
        ? activation.providerApplication.action
        : activation.providerApplication.result.action;
  const sourceProviderApplication =
    providerAction !== undefined &&
    providerAction !== "all-sources-refresh" &&
    providerActionRouteRef.current === routeIdentity
      ? activation.providerApplication
      : undefined;
  const technicalDetailsContext = {
    entryId,
    routeIdentity: section === "lineage" ? routeIdentity : undefined,
    section,
  };
  const selection = currentTechnicalDetailsSelection(capturedSelection, technicalDetailsContext);
  const projectLabel =
    view?.project.displayName ??
    (activation.state.kind === "unavailable"
      ? activation.state.project.displayName
      : "Loading project");
  const projectTitle = titleForProject(snapshot) ?? projectLabel;
  const overlayOpen = findOpen || (narrow && (navOpen || selection !== null));
  const currentFocusKey = (): string | undefined =>
    document.activeElement instanceof HTMLElement
      ? projectCanvasFocusKey(document.activeElement)
      : undefined;
  const navigateFromProject = (href: string, focusKey = currentFocusKey()) => {
    captureProjectCanvasReturn(entryId, section, focusKey);
    onNavigate(href);
  };
  const inspect = (next: TechnicalDetailsSelection, trigger: HTMLButtonElement) => {
    const token = `technical-details:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    technicalDetailsTriggerRef.current = trigger;
    technicalDetailsHistoryTokenRef.current = token;
    technicalDetailsScrollRef.current = window.scrollY;
    window.history.pushState(
      {
        ...(typeof window.history.state === "object" && window.history.state !== null
          ? window.history.state
          : {}),
        bearingTechnicalDetails: { entryId, token },
      },
      "",
      window.location.href,
    );
    setCapturedSelection(captureTechnicalDetailsSelection(next, technicalDetailsContext));
  };
  const dismissTechnicalDetails = useCallback(() => {
    const trigger = technicalDetailsTriggerRef.current;
    setCapturedSelection(null);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: technicalDetailsScrollRef.current });
      if (trigger?.isConnected) trigger.focus();
      if (technicalDetailsTriggerRef.current === trigger) technicalDetailsTriggerRef.current = null;
    });
  }, []);
  const closeTechnicalDetails = () => {
    const marker =
      typeof window.history.state === "object" && window.history.state !== null
        ? (window.history.state as { bearingTechnicalDetails?: { token?: string } })
            .bearingTechnicalDetails
        : undefined;
    if (
      technicalDetailsHistoryTokenRef.current !== null &&
      marker?.token === technicalDetailsHistoryTokenRef.current
    ) {
      window.history.back();
      return;
    }
    dismissTechnicalDetails();
  };
  const openRoadmap = (href: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigateFromProject(href);
  };
  const navigateFromFind = (href: string) => {
    const state =
      typeof window.history.state === "object" && window.history.state !== null
        ? { ...(window.history.state as Record<string, unknown>) }
        : {};
    window.history.replaceState(
      { ...state, bearingFind: { entryId, query: findQuery } },
      "",
      window.location.href,
    );
    setFindOpen(false);
    onNavigate(href);
  };

  useEffect(() => {
    const priorState = priorProviderStateRef.current;
    const nextState = activation.providerApplication.state;
    priorProviderStateRef.current = nextState;
    if (nextState === "running") return;
    if (priorState !== "running" || nextState !== "settled") return;
    const trigger = providerActionTriggerRef.current;
    const result = activation.providerApplication.result;
    if (result.state !== "attention" && trigger?.isConnected === true) {
      trigger.focus();
      return;
    }
    providerStatusRef.current?.focus();
  }, [activation.providerApplication]);

  useEffect(() => {
    const priorFailure = priorReadFailureRef.current;
    priorReadFailureRef.current = activation.readFailure;
    if (
      activation.readFailure !== undefined &&
      (priorFailure === undefined || priorFailure.code !== activation.readFailure.code)
    ) {
      projectReadAttentionRef.current?.focus();
    }
  }, [activation.readFailure]);

  useEffect(() => {
    if (capturedSelection !== null && selection === null) {
      dismissTechnicalDetails();
    }
  }, [capturedSelection, dismissTechnicalDetails, selection]);

  useEffect(() => {
    const closeFromHistory = () => {
      if (capturedSelection !== null) {
        technicalDetailsHistoryTokenRef.current = null;
        dismissTechnicalDetails();
      }
    };
    window.addEventListener("popstate", closeFromHistory);
    return () => window.removeEventListener("popstate", closeFromHistory);
  }, [capturedSelection, dismissTechnicalDetails]);

  useEffect(() => {
    void routeIdentity;
    const state =
      typeof window.history.state === "object" && window.history.state !== null
        ? { ...(window.history.state as Record<string, unknown>) }
        : {};
    const marker = (state as { bearingFind?: { entryId?: string; query?: string } }).bearingFind;
    if (marker?.entryId !== entryId || typeof marker.query !== "string") return;
    delete state["bearingFind"];
    window.history.replaceState(state, "", window.location.href);
    setFindQuery(marker.query);
    setFindOpen(true);
  }, [entryId, routeIdentity]);

  useEffect(() => {
    if (snapshot === undefined) return undefined;
    void routeIdentity;
    return restoreProjectCanvas(entryId, section);
  }, [entryId, routeIdentity, section, snapshot]);

  let content: ReactNode;
  if (snapshot !== undefined) {
    content =
      section === "overview" && snapshot.section === "overview" ? (
        <OverviewPage
          entryId={entryId}
          onNavigate={navigateFromProject}
          onOpenRoadmap={openRoadmap}
          snapshot={snapshot}
        />
      ) : section === "roadmaps" && snapshot.section === "roadmaps" ? (
        <RoadmapsPage entryId={entryId} onNavigate={navigateFromProject} snapshot={snapshot} />
      ) : section === "assets" && snapshot.section === "assets" ? (
        <AssetsPage entryId={entryId} onNavigate={navigateFromProject} snapshot={snapshot} />
      ) : section === "audit" && snapshot.section === "audit" ? (
        <AuditPage entryId={entryId} snapshot={snapshot} />
      ) : snapshot.section !== "lineage" ? (
        <div className="page project-state-page">
          <LoadingState />
        </div>
      ) : subject === undefined ? (
        <div className="page project-state-page">
          <EmptyState
            title="Planning Lineage route unavailable"
            detail="The requested subject identity is missing from this route."
          />
        </div>
      ) : requestedNativeSubject !== undefined &&
        providerBinding !== undefined &&
        !nativeDetailPresent ? (
        <div className="page project-state-page">
          <EmptyState
            title="Native detail is not in the current source"
            detail="Refresh only this exact source. This does not inspect other Work Bindings."
            action={
              <>
                {structuralAttention ? null : (
                  <Action disabled={providerBusy} onClick={observeCurrentSource}>
                    Refresh source
                  </Action>
                )}
                {sourceProviderApplication === undefined ? null : (
                  <ProviderObservationStatus
                    application={sourceProviderApplication}
                    placement="source"
                    statusRef={providerStatusRef}
                  />
                )}
              </>
            }
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
          observationBusy={providerBusy}
          observationObservedAt={nativeObservation?.observedAt}
          observationApplication={sourceProviderApplication}
          observationStatusRef={providerStatusRef}
          {...(providerBinding === undefined || structuralAttention
            ? {}
            : {
                observationActionLabel: "Refresh source" as const,
                onObserveSource:
                  requestedNativeSubject === undefined ? loadEffortSource : observeCurrentSource,
              })}
        />
      );
  } else if (activation.state.kind === "unavailable") {
    content = (
      <div className="page project-state-page">
        <EmptyState
          headingLevel={1}
          title="Project is unavailable"
          detail={activation.state.diagnostic.message}
          action={
            <>
              <CopyDiagnosticReference reference={activation.state.diagnostic.code} />
              <a className="action action-quiet" href="/">
                Return to Project Catalog
              </a>
            </>
          }
        />
      </div>
    );
  } else if (activation.state.kind === "failed") {
    const detail =
      activation.state.error.code === "project-data-needs-rebuild"
        ? "Project data storage requires explicit recovery. Use the Agent Surface to review the recovery action."
        : activation.state.error.code === "project-data-needs-update"
          ? "This project needs a compatible Bearing runtime. Use the Agent Surface to update Bearing."
          : "Use the Agent Surface to inspect the typed project diagnostic.";
    content = (
      <div className="page project-state-page">
        <EmptyState
          headingLevel={1}
          title="Project could not be loaded"
          detail={detail}
          action={<CopyDiagnosticReference reference={activation.state.error.code} />}
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
      className={`portal-shell${navOpen ? " nav-open" : ""}${selection ? " has-technical-details" : ""}`}
    >
      <ProjectTopbar
        attentionCount={snapshot?.attentionCount}
        findDisabled={snapshot === undefined}
        findRef={findTriggerRef}
        menuRef={menuRef}
        navOpen={navOpen}
        onOpenFind={() => setFindOpen(true)}
        onOpenNavigation={() => setNavOpen(true)}
        onRefreshAllSources={(returnFocus) =>
          applyProviderObservation(
            {
              version: 1,
              action: "all-sources-refresh",
              confirmation: "refresh-all-current-sources",
            },
            returnFocus,
          )
        }
        providerBusy={providerBusy}
        providerRefreshAvailable={snapshot !== undefined && !structuralAttention}
        projectLabel={projectLabel}
        projectTitle={projectTitle}
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
        suspended={narrow && (selection !== null || findOpen)}
      />
      <main
        id="main-content"
        className="project-main"
        inert={overlayOpen}
        aria-hidden={overlayOpen}
      >
        <ProviderObservationStatus
          application={activation.providerApplication}
          placement="project"
          statusRef={providerStatusRef}
        />
        {snapshot === undefined || activation.readFailure === undefined ? null : (
          <div
            ref={projectReadAttentionRef}
            className="provider-observation-status provider-observation-attention"
            role="alert"
            tabIndex={-1}
          >
            <strong>Project data could not be re-read.</strong>
            <span>
              {readStructuralAttention
                ? "Use the Agent Surface to resolve this structural Project data condition."
                : "The last valid Project data remains visible. Use the Agent Surface to inspect the read diagnostic."}
            </span>
            <CopyDiagnosticReference reference={activation.readFailure.code} />
          </div>
        )}
        {content}
      </main>
      {selection === null ? null : (
        <TechnicalDetails
          onClose={closeTechnicalDetails}
          returnFocusRef={technicalDetailsTriggerRef}
          selection={selection}
        />
      )}
      {findOpen && snapshot !== undefined ? (
        <ProjectFindDialog
          entryId={entryId}
          initialQuery={findQuery}
          onClose={() => setFindOpen(false)}
          onNavigate={navigateFromFind}
          onQueryChange={setFindQuery}
          returnFocusRef={findTriggerRef}
        />
      ) : null}
    </div>
  );
}
