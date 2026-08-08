import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RequestedPlanningLineageFilteredView,
  RequestedPlanningLineageSubject,
} from "../planning-lineage-route";
import {
  mattNativeObservationForSubject,
  mattNativeScopeSubject,
} from "../providers/matt-skills-v1/native-subject";
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
  const view = activation.view;
  const snapshot = view?.data;
  const lineage = snapshot?.section === "lineage" ? snapshot : undefined;
  const requestedNativeInspectionSubject =
    subject?.validity === "valid" &&
    (subject.value.kind === "native-scope" || subject.value.kind === "native-subject")
      ? subject.value
      : undefined;
  const effortInspectionBinding =
    lineage === undefined || subject?.validity !== "valid" || subject.value.kind !== "effort"
      ? undefined
      : lineage.efforts.validity === "invalid"
        ? undefined
        : lineage.efforts.items.find((effort) => effort.id === subject.value.id)?.workBinding;
  const inspectionSubject =
    requestedNativeInspectionSubject ??
    (effortInspectionBinding === undefined
      ? undefined
      : {
          kind: "native-scope" as const,
          id: mattNativeScopeSubject({ binding: effortInspectionBinding }).id,
        });
  const inspectionSubjectKey =
    inspectionSubject === undefined
      ? undefined
      : `${inspectionSubject.kind}:${inspectionSubject.id}`;
  const inspectionStateForSubject =
    inspectionSubjectKey !== undefined && activation.inspection.subjectKey === inspectionSubjectKey
      ? activation.inspection.state
      : "idle";
  const inspectionAttemptedForSubject =
    inspectionSubjectKey !== undefined && activation.inspection.subjectKey === inspectionSubjectKey;
  const inspectionTarget =
    lineage !== undefined && requestedNativeInspectionSubject !== undefined
      ? mattNativeObservationForSubject(
          [...lineage.providerObservations, ...lineage.nativeScopeInspections.observations],
          requestedNativeInspectionSubject,
        )
      : undefined;
  const inspectionTargetAvailable =
    requestedNativeInspectionSubject !== undefined && inspectionTarget !== undefined;
  const inspectionTargetBinding = effortInspectionBinding ?? inspectionTarget?.binding;
  const inspectionSelection =
    lineage === undefined || inspectionTarget === undefined
      ? undefined
      : lineage.nativeScopeInspections.selections.find(
          (selection) =>
            selection.provider === inspectionTarget.binding.provider &&
            selection.nativeScope === inspectionTarget.binding.nativeScope,
        );
  const inspectionLatestFailure =
    inspectionSelection?.latestAttempt?.outcome === "failed"
      ? inspectionSelection.latestAttempt
      : undefined;
  const inspectionDetailPresent =
    lineage !== undefined &&
    requestedNativeInspectionSubject !== undefined &&
    lineage.lineage.subjects.some(
      (candidate) =>
        candidate.identity.kind === requestedNativeInspectionSubject.kind &&
        candidate.identity.id === requestedNativeInspectionSubject.id,
    );
  const routeIdentity =
    section === "lineage" ? JSON.stringify({ subject, filteredView, semanticAnchor }) : section;
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
  const runSync = () => {
    if (activation.state.kind === "failed") activation.retry();
    else activation.forceSync();
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

  useEffect(() => {
    if (
      requestedNativeInspectionSubject === undefined ||
      inspectionTargetBinding === undefined ||
      inspectionDetailPresent ||
      inspectionSelection !== undefined ||
      inspectionStateForSubject !== "idle" ||
      inspectionAttemptedForSubject
    ) {
      return;
    }
    activation.inspectNativeScope(requestedNativeInspectionSubject, inspectionTargetBinding, false);
  }, [
    activation,
    inspectionDetailPresent,
    inspectionSelection,
    inspectionAttemptedForSubject,
    inspectionStateForSubject,
    requestedNativeInspectionSubject,
    inspectionTargetBinding,
  ]);

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
      ) : inspectionTargetAvailable &&
        !inspectionDetailPresent &&
        inspectionStateForSubject === "running" ? (
        <div className="page project-state-page">
          <LoadingState
            title="Inspecting native scope"
            detail="Acquiring this target's full native detail. No other bound scope is inspected."
          />
        </div>
      ) : inspectionTargetAvailable &&
        !inspectionDetailPresent &&
        (inspectionStateForSubject === "failed" || inspectionLatestFailure !== undefined) ? (
        <div className="page project-state-page">
          <EmptyState
            title="Native scope detail unavailable"
            detail={`The latest targeted inspection failed. Detail freshness is ${
              inspectionSelection?.effectiveFreshness ?? "undetermined"
            }; the managed scope summary remains available.`}
            action={
              inspectionSubject === undefined ? undefined : (
                <Action
                  onClick={() =>
                    activation.inspectNativeScope(inspectionSubject, inspectionTarget.binding, true)
                  }
                >
                  Retry details
                </Action>
              )
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
          inspectionOperation={{
            state: inspectionStateForSubject,
            ...(inspectionAttemptedForSubject && inspectionSubjectKey !== undefined
              ? { subjectKey: inspectionSubjectKey }
              : {}),
          }}
          {...(inspectionTargetBinding === undefined
            ? {}
            : {
                onRefreshDetails: (nextSubject: {
                  kind: "native-scope" | "native-subject";
                  id: string;
                }) => activation.inspectNativeScope(nextSubject, inspectionTargetBinding, true),
              })}
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
  } else if (activation.state.kind === "failed") {
    const detail =
      activation.state.error.code === "project-data-needs-rebuild"
        ? "Use the Agent Surface to rebuild project data, then retry."
        : activation.state.error.code === "project-data-needs-update"
          ? "Install a compatible Bearing runtime, then retry."
          : "Use Retry to read this project again.";
    content = (
      <div className="page project-state-page">
        <EmptyState title="Project could not be loaded" detail={detail} />
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
        suspended={narrow && (selection !== null || findOpen)}
      />
      <main
        id="main-content"
        className="project-main"
        inert={overlayOpen}
        aria-hidden={overlayOpen}
      >
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
