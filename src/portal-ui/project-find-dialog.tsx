import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import {
  buildProjectFindIndex,
  type ProjectFindIndex,
  type ProjectFindResult,
} from "./project-find-model";

const resultId = (index: number): string => `project-find-result-${index}`;

const resultSummary = (result: ProjectFindResult): string =>
  `${result.subjectType}: ${result.title}. Matched ${result.matchedField}. ${result.excerpt}`;

function ResultItem({
  active,
  index,
  onNavigate,
  result,
}: {
  readonly active: boolean;
  readonly index: number;
  readonly onNavigate: (result: ProjectFindResult) => void;
  readonly result: ProjectFindResult;
}) {
  return (
    <div>
      <a
        id={resultId(index)}
        className={`project-find-result${active ? " is-active" : ""}`}
        href={result.href}
        role="option"
        aria-selected={active}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          onNavigate(result);
        }}
      >
        <span className="project-find-result-heading">
          <span className="project-find-result-type">{result.subjectType}</span>
          <strong>{result.title}</strong>
        </span>
        <code>{result.subject.id}</code>
        <span className="project-find-result-parent">{result.parentPath.join(" / ")}</span>
        <span className="project-find-result-match">
          <b>{result.matchedField}</b>
          <span>{result.excerpt}</span>
        </span>
        {result.anchorAvailability === "unavailable" ? (
          <small className="project-find-result-unavailable">
            Target section unavailable in the current Snapshot; opening the subject route.
          </small>
        ) : null}
        <span className="sr-only">{resultSummary(result)}</span>
      </a>
    </div>
  );
}

export function ProjectFindDialog({
  entryId,
  onClose,
  onNavigate,
  returnFocusRef,
  snapshot,
}: {
  readonly entryId: string;
  readonly onClose: () => void;
  readonly onNavigate: (href: string) => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly snapshot: ProjectSnapshot;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const fingerprint = snapshot.basis.sitemapFingerprint;
  const snapshotForIndexRef = useRef(snapshot);
  snapshotForIndexRef.current = snapshot;
  const { index, indexError } = useMemo<{
    index: ProjectFindIndex | null;
    indexError: boolean;
  }>(() => {
    if (fingerprint.length === 0) return { index: null, indexError: true };
    try {
      return {
        index: buildProjectFindIndex(snapshotForIndexRef.current, entryId),
        indexError: false,
      };
    } catch {
      return { index: null, indexError: true };
    }
  }, [entryId, fingerprint]);
  const results = useMemo(() => (index === null ? [] : index.search(query)), [index, query]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      window.requestAnimationFrame(() => {
        if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
      });
    };
  }, [returnFocusRef]);

  const close = () => onClose();
  const openResult = (result: ProjectFindResult) => {
    onNavigate(result.href);
    close();
  };
  const moveActive = (delta: number) => {
    if (results.length === 0) return;
    setActiveIndex((current) => (current + delta + results.length) % results.length);
  };

  return (
    <div className="project-find-layer">
      <button
        className="project-find-backdrop"
        type="button"
        aria-label="Close Find"
        onClick={close}
      />
      <section
        className="project-find-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-find-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            moveActive(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveActive(-1);
          } else if (event.key === "Enter" && results[activeIndex] !== undefined) {
            event.preventDefault();
            openResult(results[activeIndex]);
          }
        }}
      >
        <div className="project-find-heading">
          <div>
            <span className="eyebrow">Project Find</span>
            <h2 id="project-find-title">Find in project</h2>
          </div>
          <button
            className="project-find-close"
            type="button"
            onClick={close}
            aria-label="Close Find"
          >
            ×
          </button>
        </div>
        <label className="project-find-input-label" htmlFor="project-find-input">
          Search identity, title, or semantic phrase
        </label>
        <input
          ref={inputRef}
          id="project-find-input"
          className="project-find-input"
          type="search"
          value={query}
          placeholder="Try a Gate ID, title, or phrase"
          autoComplete="off"
          aria-controls="project-find-results"
          aria-activedescendant={
            results[activeIndex] === undefined ? undefined : resultId(activeIndex)
          }
          onChange={(event) => {
            setActiveIndex(0);
            setQuery(event.target.value);
          }}
        />
        <p className="project-find-status" role="status" aria-live="polite">
          {indexError
            ? "Find is unavailable for this Snapshot. The project reading surface remains available."
            : query.trim().length === 0
              ? "Search is limited to typed Planning Lineage subjects in this project."
              : `${results.length} result${results.length === 1 ? "" : "s"}`}
        </p>
        {query.trim().length === 0 ? null : results.length === 0 ? (
          <p className="project-find-empty">No matching subject in this Snapshot.</p>
        ) : (
          <div
            id="project-find-results"
            className="project-find-results"
            role="listbox"
            aria-label="Find results"
          >
            {results.map((result, index) => (
              <ResultItem
                active={activeIndex === index}
                index={index}
                key={`${result.subject.kind}:${result.subject.id}`}
                onNavigate={openResult}
                result={result}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
