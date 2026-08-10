import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { findProjectRows, ProjectDataRecoveryError } from "./project-contract";

type ProjectFindResult = Readonly<{
  subject: Readonly<{ kind: string; id: string }>;
  subjectType: string;
  title: string;
  parentPath: readonly string[];
  excerpt: string;
  href: string;
}>;

const resultId = (index: number): string => `project-find-result-${index}`;

const resultSummary = (result: ProjectFindResult): string =>
  `${result.subjectType}: ${result.title}. ${result.excerpt}`;

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
        <span className="project-find-result-parent">{result.parentPath.join(" / ")}</span>
        <span className="project-find-result-excerpt">{result.excerpt}</span>
        <span className="sr-only">{resultSummary(result)}</span>
      </a>
    </div>
  );
}

export function ProjectFindDialog({
  entryId,
  initialQuery,
  onClose,
  onNavigate,
  onQueryChange,
  returnFocusRef,
}: {
  readonly entryId: string;
  readonly initialQuery: string;
  readonly onClose: () => void;
  readonly onNavigate: (href: string) => void;
  readonly onQueryChange: (query: string) => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<readonly ProjectFindResult[]>([]);
  const [scopeState, setScopeState] = useState<
    Awaited<ReturnType<typeof findProjectRows>>["scopeState"]
  >({ state: "available" });
  const [indexError, setIndexError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    if (query.trim().length === 0) {
      setResults([]);
      setIndexError(undefined);
      return () => controller.abort();
    }
    void findProjectRows(entryId, query, controller.signal)
      .then((result) => {
        setResults(result.results);
        setScopeState(result.scopeState);
        setIndexError(undefined);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResults([]);
        setIndexError(
          error instanceof ProjectDataRecoveryError
            ? error.recovery === "explicit-rebuild"
              ? "Project data needs an explicit rebuild before Find can run."
              : "Find needs a compatible Bearing runtime."
            : "Find is unavailable. Use the Agent Surface to inspect project diagnostics.",
        );
      });
    return () => controller.abort();
  }, [entryId, query]);

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
            onQueryChange(event.target.value);
          }}
        />
        <p className="project-find-status" role="status" aria-live="polite">
          {indexError !== undefined
            ? indexError
            : query.trim().length === 0
              ? "Search is limited to Bearing-managed project content."
              : scopeState.state === "available"
                ? `${results.length} result${results.length === 1 ? "" : "s"}`
                : `${results.length} result${results.length === 1 ? "" : "s"}. ${scopeState.impact}`}
        </p>
        {query.trim().length === 0 || scopeState.state === "available" ? null : (
          <div className="project-find-scope-state">
            <strong>{scopeState.cause}</strong>
            <p>{scopeState.impact}</p>
            <p>{scopeState.nextStep}</p>
          </div>
        )}
        {query.trim().length === 0 || indexError !== undefined ? null : results.length === 0 ? (
          <p className="project-find-empty">
            No matches in Bearing-managed scope. Try another title, phrase, or internal ID.
          </p>
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
